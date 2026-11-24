import * as Y from 'yjs';

/**
 * Why a collaborator's update is refused before it reaches the board, or null. Read from the
 * decoded update and the board's clocks only, in one pass over the update. Each case is one no Yjs
 * client writes, and one that would break the board for everyone:
 * - an update the lazy decoder can't read as applyUpdate does;
 * - a struct or a deletion of no length, or a subdocument whose guid is not a string (the board
 *   could no longer be encoded, so it would never be stored again);
 * - ids past the safe integers (held back, they can't be encoded again);
 * - a struct naming a clock of its own client at or after its own, a live map entry of several clocks,
 *   or one overlapping held clocks after a collected struct or under another key than the live one
 *   before them (applyUpdate fails halfway through, after changing the board, or while cleaning
 *   up, after which the board emits nothing more);
 * - deletions out of order (the stored board would no longer load);
 * - new structs or deletions under the board's own client id, which only the server writes.
 * Edit rights already allow any change to a board's content: this only keeps one update from
 * wedging the board (SECURITY.md, decision 0139). A struct whose key can't be told here (its
 * origin is not held yet) waits, and is not read again when it is let in: a known limit.
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
  /** This update's structs of each client in clock order, and the one at an id. */
  const byClient = new Map<number, Array<(typeof decoded.structs)[number]>>();
  for (const s of decoded.structs) {
    const list = byClient.get(s.id.client) ?? [];
    list.push(s);
    byClient.set(s.id.client, list);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.id.clock - b.id.clock);
  const sent = (id: Y.ID) => {
    const list = byClient.get(id.client) ?? [];
    let [lo, hi] = [0, list.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (!s || id.clock < s.id.clock) hi = mid - 1;
      else if (id.clock >= s.id.clock + s.length) lo = mid + 1;
      else return s;
    }
    return undefined;
  };
  /**
   * The map key an item goes under: its own when it names its parent, else that of the item it
   * follows (or precedes), in the board or earlier in this update, as Yjs reads it. Undefined when
   * it can't be told here (an origin Yjs doesn't hold yet: the item waits, and is not integrated).
   * Each chain is walked once.
   */
  const keys = new Map<Y.Item, string | null | undefined>();
  const keyOf = (first: Y.Item): string | null | undefined => {
    const chain: Y.Item[] = [];
    let item: Y.Item = first;
    let key: string | null | undefined;
    for (;;) {
      if (keys.has(item)) {
        key = keys.get(item);
        break;
      }
      chain.push(item);
      if (!item.origin && !item.rightOrigin) {
        key = item.parentSub;
        break;
      }
      const ref = (item.origin ?? item.rightOrigin) as Y.ID;
      const inBoard = held(ref);
      if (inBoard) {
        key = inBoard instanceof Y.Item ? inBoard.parentSub : undefined;
        break;
      }
      const next = sent(ref);
      if (!(next instanceof Y.Item) || chain.length > decoded.structs.length) break;
      item = next;
    }
    for (const c of chain) keys.set(c, key);
    return key;
  };
  /** Whether Yjs collects the item instead of placing it: the parent it names is gone (getMissing). */
  const parentGone = (s: Y.Item) => {
    if (s.origin || s.rightOrigin)
      return [s.origin, s.rightOrigin].some((id) => id && held(id) instanceof Y.GC);
    if (!(s.parent instanceof Y.ID)) return false;
    const parent = held(s.parent);
    return (
      parent instanceof Y.GC ||
      (parent instanceof Y.Item && !(parent.content instanceof Y.ContentType))
    );
  };
  /**
   * Whether every clock of a range is deleted: by this update, or already on the board. Read
   * before the deletions are checked for order, so each client's are looked through in full.
   */
  const deleted = (client: number, from: number, to: number) => {
    const ranges = decoded.ds.clients.get(client) ?? [];
    for (let clock = from; clock < to; ) {
      const inUpdate = ranges.find((r) => r.clock <= clock && clock < r.clock + r.len);
      if (inUpdate) {
        clock = inUpdate.clock + inUpdate.len;
        continue;
      }
      const struct = held(Y.createID(client, clock));
      if (!struct || (struct instanceof Y.Item && !struct.deleted)) return false;
      clock = struct.id.clock + struct.length;
    }
    return true;
  };
  for (const s of decoded.structs) {
    if (s.length <= 0) return 'empty struct';
    if (!Number.isSafeInteger(s.id.clock + s.length)) return 'unsafe clock';
    if (!Number.isSafeInteger(s.id.client)) return 'unsafe id';
    if (s.id.client === own && s.id.clock + s.length > ownState) return 'server client id';
    if (!(s instanceof Y.Item)) continue;
    for (const ref of [s.origin, s.rightOrigin, s.parent instanceof Y.ID ? s.parent : null]) {
      if (!ref) continue;
      // Held back, an id past the safe integers can't be encoded again: the board can't be stored.
      if (!Number.isSafeInteger(ref.client) || !Number.isSafeInteger(ref.clock)) return 'unsafe id';
      if (ref.client === s.id.client && ref.clock >= s.id.clock) return 'self reference';
    }
    if (s.content instanceof Y.ContentDoc && typeof s.content.doc.guid !== 'string')
      return 'subdocument guid';
    // A live map entry spans one clock: Yjs fails while cleaning up a deleted map with a longer
    // one, and the board emits nothing more. Removed values merge into longer ones (also kept,
    // for undo or without garbage collection, with their content): deleted throughout, harmless.
    const key = keyOf(s);
    if (
      s.length > 1 &&
      typeof key === 'string' &&
      !(s.content instanceof Y.ContentDeleted) &&
      !deleted(s.id.client, s.id.clock, s.id.clock + s.length)
    )
      return 'map entry of several clocks';
    // Overlapping clocks the board holds, Yjs integrates the rest after the struct before them.
    // When that one was collected, it only manages if the struct's parent is gone too (a real
    // resend after its card or text was deleted); otherwise it fails halfway through. When it
    // is live, the rest goes under its key, not the one the struct names.
    const local = Y.getState(store, s.id.client);
    if (s.id.clock < local && s.id.clock + s.length > local) {
      const left = held(Y.createID(s.id.client, local - 1));
      if (left instanceof Y.GC && !parentGone(s)) return 'overlaps a collected struct';
      if (left instanceof Y.Item && key !== undefined && (key ?? null) !== left.parentSub)
        return 'overlaps under another key';
    }
  }
  for (const [client, ranges] of decoded.ds.clients) {
    if (!Number.isSafeInteger(client)) return 'unsafe id';
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
