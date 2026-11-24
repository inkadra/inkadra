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
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { setBusy, setUnsaved } from '../pwa/busy.ts';
import { refetchAsset } from './assets.ts';
import {
  discardKept,
  downloadKept,
  dropLocalBoard,
  hasKept,
  keepAside,
  keptUpdate,
  LOCAL_ORIGIN,
  type LocalBoard,
  localBoardName,
  openLocalBoard,
  RestoreError,
  restoreAsNew,
  restoreConflict,
  sweepLocalBoards,
} from './local-boards.ts';
import { BoardStore } from './store.ts';

/**
 * `denied`: no access to this board (refused, or removed while open). `signedOut`: the
 * session or token ended while the board was open.
 */
export type ConnectionStatus = 'connecting' | 'synced' | 'offline' | 'denied' | 'signedOut';

/**
 * Reasons the collab server gives when it closes or refuses a board (decision 0011). `Forbidden`
 * is an explicit loss of access (removed, an expired grant, or the board is in the trash and may
 * come back): the only refusal that deletes the board's copy on this device (#791), with the
 * edits it holds set aside first. A refusal without a reason of its own may be a passing
 * failure, so the copy stays.
 */
const CLOSE_REASONS: Record<string, ConnectionStatus> = {
  Unauthorized: 'signedOut',
  Forbidden: 'denied',
};

/**
 * Hocuspocus closes a document, not the socket, with this reason when handling an update failed:
 * the server refused it (a check on the update), or failed for a moment. The document signs in
 * and syncs again on its own; refused that often within the window, the unconfirmed edits are set
 * aside and the board is reopened from what the server has, as for a board at its size limit.
 */
export const RESET_REASON = 'Reset Connection';
export const RESET_LIMIT = 3;
export const RESET_WINDOW_MS = 60_000;
/** The wait before the nth retry of a reset document: n times this. */
export const RESET_BACKOFF_MS = 250;
/** After RESET_LIMIT resets without our edits, how long the board waits offline to try again. */
export const RESET_PAUSE_MS = 30_000;
/** When each board (`cacheKey`) was last reset by the server, kept across its reopenings. */
const resets = new Map<string, number[]>();

export interface BoardConnection {
  store: BoardStore;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  readOnly: boolean;
  schemaTooNew?: boolean;
  sizeLimited?: boolean;
  /** Edits of this board the server would not take are set aside on this device (#791). */
  kept?: KeptChanges | null;
  /** The edits were set aside because the server refused them again and again. */
  updateRefused?: boolean;
  /** The board was deleted or moved to the trash while open (#951); `status` is `denied`. */
  gone?: 'deleted' | 'trash' | null;
  /** Signing in again after the server reset the document (`RESET_REASON`), until synced. */
  retrying?: boolean;
  /** When the server last changed our access while the board was open. */
  accessChangedAt: number | null;
  /** Save progress, kept out of this object so an edit does not re-render the board. */
  saves: SaveStore;
  /**
   * Merges edits set aside (#898) into the board (`restorableUpdate`): resolves once the server
   * has confirmed them, rejects with a `RestoreError` when it cannot take them, and with
   * `conflict` (nothing merged) when merging would lose some or overwrite newer edits
   * (`restoreConflict`). With `asNew`, those cards are copied in as new ones (`restoreAsNew`).
   */
  merge?: (update: Uint8Array, asNew?: string[]) => Promise<void>;
}

/**
 * Edits set aside on this device for a board (#791): the person restores them into the board
 * (#898), downloads or discards them.
 */
export interface KeptChanges {
  /**
   * Deletes them once the server confirmed them; refused, or in conflict with the board, they
   * stay (`RestoreError`). With `asNew`, the cards `conflict.cards` names come back as new ones.
   */
  restore(asNew?: string[]): Promise<void>;
  download(): Promise<void>;
  discard(): Promise<void>;
}

export function collabUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // `reasons=1`: refusals say `Forbidden` or `Unauthorized` when they are (#791).
  return `${scheme}://${window.location.host}${COLLAB_PATH}?schemaVersion=${CURRENT_SCHEMA_VERSION}&reasons=1`;
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
    // A server error is not a lost access. Denied or not, a refusal without the collab server's
    // own `Forbidden` (a proxy's 403 here) keeps the board's copy on this device (#791).
    if (err instanceof RequestError)
      return err.status === 401 ? 'signedOut' : err.status >= 500 ? 'offline' : 'denied';
    return 'offline';
  }
}

// Keep reopened boards and their last authenticated role available while this tab is offline.
// Edits the server has not confirmed are also kept on the device (`local-boards.ts`, #791).
// #777: only the last few boards are kept, so a long session does not hold every board it opened.
// A board with edits the server has not confirmed is never dropped.
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
/** How long a merge of edits set aside (#898) waits for the server before it counts refused. */
export const MERGE_TIMEOUT_MS = 60_000;

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
  const [keptBoard, setKeptBoard] = useState<string | null>(null);
  const [refusedBoard, setRefusedBoard] = useState<string | null>(null);
  const merger = useRef<BoardConnection['merge']>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A refusal must reopen the document even though its board id is unchanged.
  useEffect(() => {
    let refused = false;
    // A refusal at the size limit carries the deletions over to the reopened board; a reset does
    // not: a Y.Map key set again is a deletion and an insert, and the deletion alone would wipe
    // the server's value.
    let carryDeletions = false;
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
      gone: null,
      retrying: false,
    };
    const saves = createSaveStore();
    // Changes the server has not confirmed yet: a reload for a new version waits for them.
    const busy = {};
    let unsynced = 0;
    // Edits made here that the server has not confirmed: closing the tab would lose them.
    // Kept under the board's key, so edits cached when the board closed still warn.
    let edited = cached?.unsaved ?? false;
    let alive = true;
    // The board's copy on this device (#791): opened once a deletion of it is done.
    const localName = userId ? localBoardName(userId, boardId) : '';
    let local: LocalBoard | null = null;
    let marked = false;
    // The person lost access: the copy is deleted, also when it opens later.
    let dropped = false;
    /** Says on the device whether the copy holds edits the server has not confirmed. */
    const mark = () => {
      if (!local || marked === edited) return;
      marked = edited;
      local.mark(edited);
    };
    /**
     * Deletes the copy, its unsaved edits set aside first (`keepAside`): the server will not
     * take them. If they cannot be set aside (a full disk), the copy stays, still unsaved.
     */
    const setAside = (closing: Promise<void> | undefined, unsaved: boolean) => {
      if (!localName) return;
      const kept = unsaved ? keepAside(userId, boardId, doc) : undefined;
      const settled = Promise.all([closing, kept]);
      if (kept)
        settled.then(
          () => setKeptBoard(boardId),
          () => {},
        );
      void dropLocalBoard(localName, settled);
    };
    /**
     * The server said the person can no longer open the board (removed, or the board is in the
     * trash and may come back): the copy goes, and edits it holds are set aside.
     */
    const drop = () => {
      if (dropped) return;
      dropped = true;
      // Not open yet: done once it is, with what it holds.
      if (!local) return;
      setAside(local.close(), edited || marked);
      local = null;
    };
    // A merge of edits set aside (#898), until the server confirms or refuses it.
    let merging: {
      resolve: () => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const settleMerge = (err?: Error) => {
      const pending = merging;
      merging = null;
      if (pending) clearTimeout(pending.timer);
      if (err) pending?.reject(err);
      else pending?.resolve();
    };
    const merge: NonNullable<BoardConnection['merge']> = (update, asNew) =>
      new Promise<void>((resolve, reject) => {
        if (state.readOnly || state.status !== 'synced' || refused || dropped || merging) {
          reject(new RestoreError('notWritable'));
          return;
        }
        try {
          if (!asNew) {
            // Checked against the board as it is now, in the same turn as the merge.
            const conflict = restoreConflict(doc, update);
            if (conflict) throw new RestoreError('conflict', conflict);
          }
          // A refusal the server does not say again, or an answer that never comes: the edits
          // stay set aside rather than wait forever.
          const timer = setTimeout(
            () => settleMerge(new RestoreError('refused')),
            MERGE_TIMEOUT_MS,
          );
          merging = { resolve, reject, timer };
          // An edit made here: sent, stored in the copy and counted unsaved like any other.
          if (asNew) restoreAsNew(doc, update, asNew, { boardId, userId: userId || null });
          else Y.applyUpdate(doc, update);
        } catch (err) {
          if (merging) settleMerge(err instanceof RestoreError ? err : new RestoreError('invalid'));
          else reject(err instanceof RestoreError ? err : new RestoreError('invalid'));
          return;
        }
        // Nothing the board lacked: nothing for the server to confirm.
        if (!provider.hasUnsyncedChanges) settleMerge();
      });
    merger.current = merge;
    const hold = () => {
      if (!trackBusy) return;
      setBusy(busy, unsynced > 0 || state.status === 'connecting' || state.status === 'offline');
      setUnsaved(cacheKey, edited && state.status !== 'denied');
    };
    if (localName)
      void openLocalBoard(
        localName,
        boardId,
        doc,
        () => {
          local = null;
        },
        // The same updates `onEdit` counts as edits made here.
        { before: () => edited, is: (origin) => origin !== provider && origin !== LOCAL_ORIGIN },
      )
        .then((opened) => {
          if (dropped) {
            setAside(opened.close(), edited || opened.unsaved);
            return;
          }
          if (!alive || refused) {
            void opened.close();
            return;
          }
          // Written by a newer build: kept for it, and this one only reads the board.
          if (opened.tooNew) {
            copyTooNew = true;
            update({});
            return;
          }
          local = opened;
          marked = opened.unsaved;
          // Edits a closed tab left on the device: the server confirms them once it has them.
          if (marked && !edited && (state.status !== 'synced' || unsynced > 0)) {
            edited = true;
            hold();
          }
          mark();
        })
        // No IndexedDB (a private window may refuse it): the board works from memory, as before.
        .catch(() => {});
    const socket = shareSocket ? acquireSharedSocket(boardDocName(boardId)) : undefined;
    const provider = new HocuspocusProvider({
      ...(socket ? { websocketProvider: socket } : { url: collabUrl() }),
      name: boardDocName(boardId),
      document: doc,
      onSynced: () => {
        // A board that went stays gone, even if its socket syncs again (restored meanwhile).
        if (state.gone) return;
        if (deletions) {
          Y.applyUpdate(doc, deletions);
          // Deletions of the refused additions name items the server never got: drop them,
          // rather than keep them waiting and send them with the next sync.
          doc.store.pendingDs = null;
          deletions = undefined;
        }
        stopRetry();
        update({ status: 'synced' });
      },
      onDisconnect: () => {
        // The socket reconnects on its own, and its handshake signs this document in again.
        stopRetry();
        if (state.status !== 'denied' && state.status !== 'signedOut')
          update({ status: 'offline' });
      },
      // The server says when the role changes between editing and reading (decision 0011).
      onStateless: ({ payload }) => {
        const msg = readBoardNotice(payload);
        if (msg?.type === 'writeRefused') settleMerge(new RestoreError('refused'));
        if (msg?.type === 'writeRefused' && msg.reason === 'frozen') {
          setLimitedBoard(boardId);
          // A rejected Yjs struct leaves a clock gap. Reopen from confirmed state before
          // sending further edits; never cache the unaccepted additions.
          if (!roleReadOnly && !refused) {
            refused = true;
            carryDeletions = true;
            // The refused edits stay on the device, set aside, and the person is told.
            setAside(local?.close(), edited);
            local = null;
            setReload((value) => value + 1);
          }
        }
        if (msg?.type === 'asset') refetchAsset(msg.assetId);
        // The board went (#951): the `Forbidden` close follows; this says why.
        if (msg?.type === 'boardGone') {
          drop();
          update({ status: 'denied', gone: msg.reason });
        }
        if (msg?.type === 'access') update({ readOnly: msg.readOnly, accessChangedAt: Date.now() });
      },
      onClose: ({ event }) => {
        const status = CLOSE_REASONS[event.reason];
        if (status === 'denied') drop();
        if (status) update({ status });
        // Only the document's close: a socket closing with this reason reconnects on its own.
        else if (event.reason === RESET_REASON && event.code === 1000) resetByServer();
      },
      onAuthenticated: ({ scope }) => {
        const readOnly = scope === 'readonly';
        // A reconnection with another role is an access change like an `access` message: the
        // server's periodic check may not have told us before the socket dropped.
        const changed = authenticated && readOnly !== roleReadOnly;
        authenticated = true;
        update(changed ? { readOnly, accessChangedAt: Date.now() } : { readOnly });
      },
      onAuthenticationFailed: ({ reason }) => {
        const status = CLOSE_REASONS[reason];
        if (status === 'denied') drop();
        if (status) update({ status });
        else
          void refusalStatus().then((next) => {
            if (alive) update({ status: next });
          });
      },
    });
    // Edits the server reset the document for in this run of resets, not confirmed since: the
    // handshake of the next attempt may count back to zero before the server refuses them again.
    let resetEdits = false;
    // The next attempt after a reset, and whether the board waits offline for it.
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    const stopRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      paused = false;
    };
    /** Signs in and syncs again over the same socket, which stayed open. */
    const retry = () => {
      stopRetry();
      if (!alive || refused || dropped || state.gone) return;
      update({ status: 'connecting', retrying: true });
      provider.configuration.websocketProvider.attach(provider);
    };
    // Waiting offline: the network coming back, or the tab shown again, tries at once.
    const retryNow = () => {
      if (paused && document.visibilityState !== 'hidden') retry();
    };
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', retryNow);
    /** The server closed the document over an update (`RESET_REASON`). */
    const resetByServer = () => {
      if (!alive || refused || dropped || state.status === 'denied') return;
      if (state.status === 'signedOut') return;
      // A merge in flight is what the server refused, whatever the retry's handshake counts.
      settleMerge(new RestoreError('refused'));
      const now = Date.now();
      const recent = (resets.get(cacheKey) ?? []).filter((at) => now - at < RESET_WINDOW_MS);
      // A new run of resets: edits of an earlier one were saved since, or set aside.
      if (recent.length === 0) resetEdits = false;
      resetEdits ||= edited;
      recent.push(now);
      resets.set(cacheKey, recent);
      stopRetry();
      if (recent.length < RESET_LIMIT) {
        update({ status: 'connecting', retrying: true });
        // Not at once: a blip of a few milliseconds would use up every attempt.
        retryTimer = setTimeout(retry, RESET_BACKOFF_MS * recent.length);
        return;
      }
      resets.delete(cacheKey);
      if (!(resetEdits || edited)) {
        // Nothing of ours to set aside: the server refuses the board itself. It waits offline
        // and tries again later, rather than retry or reload in a loop.
        update({ status: 'offline' });
        paused = true;
        retryTimer = setTimeout(retry, RESET_PAUSE_MS);
        return;
      }
      // Our edits refused every time: set aside, and reopened from what the server confirmed.
      // The reopened board holds none of them, so it reloads at most once per run of resets.
      refused = true;
      setRefusedBoard(boardId);
      setAside(local?.close(), true);
      local = null;
      setReload((value) => value + 1);
    };
    const onEdit = (_update: Uint8Array, origin: unknown) => {
      // The copy on the device loading is not an edit: its own flag says if it holds some.
      if (origin === provider || origin === LOCAL_ORIGIN || edited) return;
      edited = true;
      mark();
      hold();
    };
    doc.on('update', onEdit);
    // A provider on a shared socket is not attached by itself.
    if (socket) provider.attach();
    let roleReadOnly = cached?.readOnly ?? false;
    let authenticated = false;
    let docTooNew = false;
    let copyTooNew = false;
    function update(patch: Partial<typeof state>) {
      if (patch.readOnly !== undefined) roleReadOnly = patch.readOnly;
      const was = state.status;
      state = { ...state, ...patch };
      // A board that went stays so, whatever the connection says after (#951).
      if (state.gone) state.status = 'denied';
      // Retrying is a kind of connecting only.
      if (state.status !== 'connecting') state.retrying = false;
      state.schemaTooNew = docTooNew || copyTooNew;
      state.readOnly = roleReadOnly || state.schemaTooNew;
      if (state.status === 'denied') settleMerge(new RestoreError('refused'));
      if (state.status === 'signedOut') settleMerge(new RestoreError('notWritable'));
      // The session ended: copies with nothing unsaved go, so none stays on a shared computer.
      if (state.status === 'signedOut' && was !== 'signedOut') void sweepLocalBoards();
      hold();
      setConn({ store, provider, saves, merge, ...state });
    }
    const stopSchema = watchDocumentSchema(doc, (tooNew) => {
      docTooNew = tooNew;
      update({});
    });
    // The provider sends nothing before the socket opens, so no count is missed here.
    const stopSaves = watchSaves(provider, (next) => {
      unsynced = next.pending;
      // A read-only connection is answered without its edits being applied: they stay unsaved.
      if (unsynced === 0 && !state.readOnly) edited = false;
      if (unsynced === 0) settleMerge(state.readOnly ? new RestoreError('refused') : undefined);
      mark();
      saves.set(next);
      hold();
    });
    update({});
    return () => {
      alive = false;
      stopRetry();
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', retryNow);
      settleMerge(new RestoreError('notWritable'));
      if (merger.current === merge) merger.current = undefined;
      // Kept: another view may have it open. Once all is confirmed, `sweepLocalBoards` deletes it.
      mark();
      void local?.close();
      // Only the deletions: an update from the document's own state vector holds no items.
      if (carryDeletions)
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

  // Edits set aside earlier, in this tab or another session (#791).
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void hasKept(userId, boardId).then((has) => {
      if (alive && has) setKeptBoard(boardId);
    });
    return () => {
      alive = false;
    };
  }, [userId, boardId]);
  const sizeLimited = limitedBoard === boardId;
  // Said with the edits it set aside; once they are dealt with, the next notice is the usual one.
  const updateRefused = refusedBoard === boardId && keptBoard === boardId;
  const kept = useMemo<KeptChanges | null>(() => {
    if (keptBoard !== boardId || !userId) return null;
    const settled = () => {
      setKeptBoard(null);
      setRefusedBoard(null);
    };
    return {
      // Deleted only once the server has them: refused, they stay set aside.
      restore: async (asNew?: string[]) => {
        const update = await keptUpdate(userId, boardId);
        if (!merger.current) throw new RestoreError('notWritable');
        await merger.current(update, asNew);
        await discardKept(userId, boardId);
        settled();
      },
      download: () => downloadKept(userId, boardId).then(settled),
      discard: () => discardKept(userId, boardId).then(settled),
    };
  }, [keptBoard, boardId, userId]);
  // The same object until something changes: the board page's effects depend on it.
  return useMemo(
    () => (conn ? { ...conn, sizeLimited, kept, updateRefused } : null),
    [conn, sizeLimited, kept, updateRefused],
  );
}
