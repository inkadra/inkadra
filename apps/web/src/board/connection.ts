import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  type onUnsyncedChangesParameters,
} from '@hocuspocus/provider';
import {
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  readBoardNotice,
} from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared/constants';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { setBusy, setUnsaved } from '../pwa/busy.ts';
import { refetchAsset } from './assets.ts';
import { BoardStore } from './store.ts';

/**
 * `denied`: no access to this board (refused, or removed while open). `signedOut`: the
 * session or token ended while the board was open.
 */
export type ConnectionStatus = 'connecting' | 'synced' | 'offline' | 'denied' | 'signedOut';

/** Reasons the collab server gives when it closes a board (decision 0011). */
const CLOSE_REASONS: Record<string, ConnectionStatus> = {
  Unauthorized: 'signedOut',
  Forbidden: 'denied',
};

export interface BoardConnection {
  store: BoardStore;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  readOnly: boolean;
  schemaTooNew?: boolean;
  sizeLimited?: boolean;
  /** When the server last changed our access while the board was open. */
  accessChangedAt: number | null;
  /** Save progress, kept out of this object so an edit does not re-render the board. */
  saves: SaveStore;
}

export function collabUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${COLLAB_PATH}?schemaVersion=${CURRENT_SCHEMA_VERSION}`;
}

export interface SaveState {
  /** The provider's count of changes the server has not confirmed. */
  pending: number;
  /** When the server last confirmed a change made here; null until it does. */
  savedAt: number | null;
}

export interface SaveStore {
  get: () => SaveState;
  subscribe: (listener: () => void) => () => void;
  set: (next: SaveState) => void;
}

/** A tiny external store for `useSyncExternalStore`; it only notifies when a value changes. */
export function createSaveStore(): SaveStore {
  let state: SaveState = { pending: 0, savedAt: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next.pending === state.pending && next.savedAt === state.savedAt) return;
      state = next;
      for (const l of listeners) l();
    },
  };
}

/**
 * Follows what the server has confirmed of the changes made in this tab. The provider's
 * unsynced count is not enough on its own: every handshake (first connection, reconnection,
 * forced sync) sets it to one and the server's reply brings it back to zero, edits or not. So
 * a return to zero is a save only when this tab changed the document since the last save;
 * edits made offline count, because the reconnection handshake is what sends them.
 */
export function watchSaves(
  provider: HocuspocusProvider,
  onChange: (state: SaveState) => void,
  now: () => number = Date.now,
): () => void {
  const doc = provider.document;
  let edited = false;
  let savedAt: number | null = null;
  // The provider sends every update it did not apply itself from the server: those are ours.
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== provider) edited = true;
  };
  const onUnsynced = ({ number }: onUnsyncedChangesParameters) => {
    if (number === 0 && edited) {
      edited = false;
      savedAt = now();
    }
    onChange({ pending: number, savedAt });
  };
  doc.on('update', onUpdate);
  provider.on('unsyncedChanges', onUnsynced);
  return () => {
    doc.off('update', onUpdate);
    provider.off('unsyncedChanges', onUnsynced);
  };
}

/**
 * Watch the live document, rather than only guarding saved-version previews. A client that runs
 * the strict card check and declares it (decision 0102) may pass `writers`, the pair the server
 * advertises (`docSchemaVersion`, `minWriterSchema`): it then also writes a document of exactly
 * that newer schema down to its minimum. The web app does not, so it reads any newer document.
 */
export function watchDocumentSchema(
  doc: Y.Doc,
  changed: (tooNew: boolean) => void,
  supported = CURRENT_SCHEMA_VERSION,
  writers?: { schemaVersion: number; minWriterSchema: number },
): () => void {
  const meta = doc.getMap('meta');
  const check = () => {
    const version = getSchemaVersion(doc);
    const allowed = writers?.schemaVersion === version && supported >= writers.minWriterSchema;
    changed(version > supported && !allowed);
  };
  meta.observe(check);
  check();
  return () => meta.unobserve(check);
}

/**
 * Why the collab server refused the board when it gives no reason of its own. A reconnection
 * after sleep or a network loss reaches the server with an expired session, and the server
 * answers that with its generic "permission denied": ask the API which one it is. Signed out
 * (401) is not a lost access, and an unreachable API is an offline board, not a denied one.
 */
export async function refusalStatus(): Promise<ConnectionStatus> {
  try {
    await api.get('/me');
    return 'denied';
  } catch (err) {
    if (err instanceof RequestError) return err.status === 401 ? 'signedOut' : 'denied';
    return 'offline';
  }
}

// Keep reopened boards and their last authenticated role available while this tab is offline.
// shortcut: memory only, so a closed or reloaded tab loses them; `setUnsaved` warns before
// that. Upgrade to a persistent copy (IndexedDB) to survive it (#791).
// #777: only the last few boards are kept, so a long session does not hold every board it opened.
// A board with edits the server has not confirmed is never dropped (#791 will persist those).
// Signing out reloads the page (#831), which empties it.
// shortcut: counted in boards, not bytes; add a byte budget if boards grow to tens of MB.
export const CACHED_BOARDS = 8;
type CachedBoard = { update: Uint8Array; readOnly: boolean; unsaved: boolean };
export const cachedBoards = new Map<string, CachedBoard>();
/** Keeps a closed board as the most recent one, then drops the oldest saved ones past the cap. */
export function cacheBoard(key: string, entry: CachedBoard) {
  cachedBoards.delete(key);
  cachedBoards.set(key, entry);
  for (const [oldKey, old] of cachedBoards) {
    if (cachedBoards.size <= CACHED_BOARDS) break;
    if (!old.unsaved) cachedBoards.delete(oldKey);
  }
}
/**
 * Shared WebSockets for the connections that ask for them (#826): the Production board opens every
 * storyboard of a project, each its own document over the same socket (Hocuspocus multiplexing).
 * A socket closes only after the last provider on it was destroyed and flushed.
 * A socket carries a board at most once: Hocuspocus routes messages by document name, so a second
 * view of the same board (two Production views) gets another socket and its own document.
 * shortcut: Hocuspocus closes a socket with more than 100 documents waiting to sign in
 * (`maxPendingDocuments`), so a socket carries at most SOCKET_DOCS boards and more open another;
 * load storyboards on demand if projects reach hundreds of them.
 * Known limits, kept as they are: an Unauthorized close (an expired session) closes every board on
 * the socket, which all show signed out, as each would on its own socket; and the server reads the
 * session cookie of the request that opened the socket, so a board attached later signs in with
 * that one. Both only matter after the session changed, and signing in again reloads the page
 * (#831), which opens new sockets.
 */
export const SOCKET_DOCS = 50;
const sharedSockets: Array<{ socket: HocuspocusProviderWebsocket; names: Set<string> }> = [];
export function acquireSharedSocket(name: string): HocuspocusProviderWebsocket {
  let shared = sharedSockets.find((s) => s.names.size < SOCKET_DOCS && !s.names.has(name));
  if (!shared) {
    shared = { socket: new HocuspocusProviderWebsocket({ url: collabUrl() }), names: new Set() };
    sharedSockets.push(shared);
  }
  shared.names.add(name);
  return shared.socket;
}
export function releaseSharedSocket(socket: HocuspocusProviderWebsocket, name: string) {
  const index = sharedSockets.findIndex((s) => s.socket === socket);
  const shared = sharedSockets[index];
  if (!shared) return;
  shared.names.delete(name);
  if (shared.names.size > 0) return;
  sharedSockets.splice(index, 1);
  socket.destroy();
}
/**
 * Deletions made in a document that was reopened after a refusal, to make again once the
 * reopened one has synced: a deletion is what still passes on a board at its size limit.
 * shortcut: other edits sent with or just after the refused update are not carried over; it
 * would need telling them apart from the refused additions.
 */
const refusedDeletions = new Map<string, Uint8Array>();

/** Opens the board document over the collaboration WebSocket; the session cookie signs in. */
/** `shareSocket`: open the document over the socket shared with other such boards (#826). */
export function useBoardConnection(
  boardId: string,
  trackBusy = true,
  shareSocket = false,
): BoardConnection | null {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const [conn, setConn] = useState<BoardConnection | null>(null);

  const [reload, setReload] = useState(0);
  const [limitedBoard, setLimitedBoard] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A refusal must reopen the document even though its board id is unchanged.
  useEffect(() => {
    let refused = false;
    const cacheKey = `${userId}:${boardId}`;
    const cached = cachedBoards.get(cacheKey);
    let deletions = refusedDeletions.get(cacheKey);
    refusedDeletions.delete(cacheKey);
    const doc = new Y.Doc();
    if (cached) Y.applyUpdate(doc, cached.update);
    const store = new BoardStore(doc);
    let state: Omit<BoardConnection, 'store' | 'provider' | 'saves'> = {
      status: 'connecting',
      readOnly: cached?.readOnly ?? false,
      schemaTooNew: false,
      accessChangedAt: null,
    };
    const saves = createSaveStore();
    // Changes the server has not confirmed yet: a reload for a new version waits for them.
    const busy = {};
    let unsynced = 0;
    // Edits made here that the server has not confirmed: closing the tab would lose them.
    // Kept under the board's key, so edits cached when the board closed still warn.
    let edited = cached?.unsaved ?? false;
    let alive = true;
    const hold = () => {
      if (!trackBusy) return;
      setBusy(busy, unsynced > 0 || state.status === 'connecting' || state.status === 'offline');
      setUnsaved(cacheKey, edited && state.status !== 'denied');
    };
    const socket = shareSocket ? acquireSharedSocket(boardDocName(boardId)) : undefined;
    const provider = new HocuspocusProvider({
      ...(socket ? { websocketProvider: socket } : { url: collabUrl() }),
      name: boardDocName(boardId),
      document: doc,
      onSynced: () => {
        if (deletions) {
          Y.applyUpdate(doc, deletions);
          // Deletions of the refused additions name items the server never got: drop them,
          // rather than keep them waiting and send them with the next sync.
          doc.store.pendingDs = null;
          deletions = undefined;
        }
        update({ status: 'synced' });
      },
      onDisconnect: () => {
        if (state.status !== 'denied' && state.status !== 'signedOut')
          update({ status: 'offline' });
      },
      // The server says when the role changes between editing and reading (decision 0011).
      onStateless: ({ payload }) => {
        const msg = readBoardNotice(payload);
        if (msg?.type === 'writeRefused' && msg.reason === 'frozen') {
          setLimitedBoard(boardId);
          // A rejected Yjs struct leaves a clock gap. Reopen from confirmed state before
          // sending further edits; never cache the unaccepted additions.
          if (!roleReadOnly && !refused) {
            refused = true;
            setReload((value) => value + 1);
          }
        }
        if (msg?.type === 'asset') refetchAsset(msg.assetId);
        if (msg?.type === 'access') update({ readOnly: msg.readOnly, accessChangedAt: Date.now() });
      },
      onClose: ({ event }) => {
        const status = CLOSE_REASONS[event.reason];
        if (status) update({ status });
      },
      onAuthenticated: ({ scope }) => update({ readOnly: scope === 'readonly' }),
      onAuthenticationFailed: ({ reason }) => {
        const status = CLOSE_REASONS[reason];
        if (status) update({ status });
        else
          void refusalStatus().then((next) => {
            if (alive) update({ status: next });
          });
      },
    });
    const onEdit = (_update: Uint8Array, origin: unknown) => {
      if (origin === provider || edited) return;
      edited = true;
      hold();
    };
    doc.on('update', onEdit);
    // A provider on a shared socket is not attached by itself.
    if (socket) provider.attach();
    let roleReadOnly = cached?.readOnly ?? false;
    function update(patch: Partial<typeof state>) {
      if (patch.readOnly !== undefined) roleReadOnly = patch.readOnly;
      state = { ...state, ...patch };
      state.readOnly = roleReadOnly || state.schemaTooNew === true;
      hold();
      setConn({ store, provider, saves, ...state });
    }
    const stopSchema = watchDocumentSchema(doc, (schemaTooNew) => update({ schemaTooNew }));
    // The provider sends nothing before the socket opens, so no count is missed here.
    const stopSaves = watchSaves(provider, (next) => {
      unsynced = next.pending;
      if (unsynced === 0) edited = false;
      saves.set(next);
      hold();
    });
    update({});
    return () => {
      alive = false;
      // Only the deletions: an update from the document's own state vector holds no items.
      if (refused)
        refusedDeletions.set(cacheKey, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc)));
      // Signed out keeps the edits: the same person signing in again in this tab gets them back.
      if (refused || state.status === 'denied') cachedBoards.delete(cacheKey);
      else
        cacheBoard(cacheKey, {
          update: Y.encodeStateAsUpdate(doc),
          readOnly: roleReadOnly,
          unsaved: edited,
        });
      doc.off('update', onEdit);
      stopSchema();
      stopSaves();
      setBusy(busy, false);
      // Destroying flushes what is still buffered: the shared socket closes only after that.
      provider.destroy();
      if (socket) releaseSharedSocket(socket, boardDocName(boardId));
      store.destroy();
      doc.destroy();
      setConn(null);
    };
  }, [boardId, trackBusy, userId, reload]);

  const sizeLimited = limitedBoard === boardId;
  // The same object until something changes: the board page's effects depend on it.
  return useMemo(() => (conn ? { ...conn, sizeLimited } : null), [conn, sizeLimited]);
}
