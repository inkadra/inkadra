import * as Y from 'yjs';

/**
 * Why a collaborator's update is refused before it reaches the board, or null. Read from the
 * decoded update and the board's clocks only, in one pass over the update. Each case is one no
 * Yjs client writes, and one that would break the board for everyone: an update the lazy decoder
 * can't read as applyUpdate does; a struct or a deletion of no length (applied, the board can no
 * longer be encoded, so it is never stored again); a struct naming a clock of its own client at
 * or after its own (applyUpdate can fail halfway through, after changing the board); and new
 * structs or deletions under the board's own client id, which only the server writes (taking them
 * would collide with its next write). Edit rights already allow any change to a board's content;
 * this only keeps one update from wedging the board (SECURITY.md, decision 0139).
 */
export function malformedUpdate(board: Y.Doc, update: Uint8Array): string | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return 'undecodable';
  }
  const own = board.clientID;
  const ownState = Y.getState(board.store, own);
  for (const s of decoded.structs) {
    if (s.length <= 0) return 'empty struct';
    if (s.id.client === own && s.id.clock + s.length > ownState) return 'server client id';
    if (!(s instanceof Y.Item)) continue;
    for (const ref of [s.origin, s.rightOrigin, s.parent instanceof Y.ID ? s.parent : null])
      if (ref && ref.client === s.id.client && ref.clock >= s.id.clock) return 'self reference';
  }
  for (const [client, ranges] of decoded.ds.clients)
    for (const { clock, len } of ranges) {
      if (len <= 0) return 'empty deletion';
      if (client === own && clock + len > ownState) return 'server client id';
    }
  return null;
}

/** Whether a connection may still write once an await is over: anything may have changed. */
export function stillWritable(state: {
  readOnly: boolean;
  /** The socket's readyState: 2 (closing) and 3 (closed) end it. */
  socketState: number;
  documentDestroyed: boolean;
}) {
  return !state.readOnly && state.socketState < 2 && !state.documentDestroyed;
}
