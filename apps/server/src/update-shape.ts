import * as Y from 'yjs';

/**
 * Why a collaborator's update is refused before it reaches the board, or null. Read from the
 * decoded update and the board's clocks only, in one pass over the update. Each case is one no
 * Yjs client writes, and one that would break the board for everyone: an update the lazy decoder
 * can't read as applyUpdate does; a struct or a deletion of no length (applied, the board can no
 * longer be encoded, so it is never stored again); a struct naming a clock of its own client at
 * or after its own, past the safe integers, or overlapping held clocks after a collected one
 * (applyUpdate can fail halfway through, after changing the board); deletions out of order (the
 * stored board would no longer load); a subdocument whose guid is not a string (the board can no
 * longer be encoded); and new structs or deletions under the board's own client id, which only the
 * server writes (taking them would collide with its next write). Edit rights already allow any change to a board's content;
 * this only keeps one update from wedging the board (SECURITY.md, decision 0139).
 */
export function malformedUpdate(board: Y.Doc, update: Uint8Array): string | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return 'undecodable';
  }
  const { store } = board;
  const own = board.clientID;
  const ownState = Y.getState(store, own);
  /** The board's struct at an id it holds, else undefined. */
  const held = (id: Y.ID) =>
    id.clock < Y.getState(store, id.client) ? Y.getItem(store, id) : undefined;
  for (const s of decoded.structs) {
    if (s.length <= 0) return 'empty struct';
    if (!Number.isSafeInteger(s.id.clock + s.length)) return 'unsafe clock';
    if (s.id.client === own && s.id.clock + s.length > ownState) return 'server client id';
    if (!(s instanceof Y.Item)) continue;
    for (const ref of [s.origin, s.rightOrigin, s.parent instanceof Y.ID ? s.parent : null])
      if (ref && ref.client === s.id.client && ref.clock >= s.id.clock) return 'self reference';
    if (s.content instanceof Y.ContentDoc && typeof s.content.doc.guid !== 'string')
      return 'subdocument guid';
    // Overlapping clocks the board holds, Yjs integrates the rest after the struct before them.
    // When that one was collected, it only manages if the struct's parent is gone too (a real
    // resend after its card was deleted); otherwise it fails halfway through.
    const local = Y.getState(store, s.id.client);
    if (s.id.clock < local && s.id.clock + s.length > local) {
      const left = held(Y.createID(s.id.client, local - 1));
      const named = s.origin ?? s.rightOrigin ?? (s.parent instanceof Y.ID ? s.parent : null);
      if (left instanceof Y.GC && !(named && held(named) instanceof Y.GC))
        return 'overlaps a collected struct';
    }
  }
  for (const [client, ranges] of decoded.ds.clients) {
    // Yjs writes a client's deletions sorted and apart; others fail to apply, now or on load.
    let end = 0;
    for (const { clock, len } of ranges) {
      if (len <= 0) return 'empty deletion';
      if (!Number.isSafeInteger(clock + len)) return 'unsafe clock';
      if (clock < end) return 'unsorted deletions';
      end = clock + len;
      if (client === own && end > ownState) return 'server client id';
    }
  }
  return null;
}

/** Whether a connection may still write once an await is over: anything may have changed. */
export function stillWritable(state: {
  readOnly: boolean;
  /** Still one of the board's connections: closing one takes it off, the socket may stay open. */
  connected: boolean;
  /** The socket's readyState: 2 (closing) and 3 (closed) end it. */
  socketState: number;
  documentDestroyed: boolean;
}) {
  return !state.readOnly && state.connected && state.socketState < 2 && !state.documentDestroyed;
}
