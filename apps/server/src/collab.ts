import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { type Connection, type Document, OutgoingMessage, Server } from '@hocuspocus/server';
import {
  type BoardNotice,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  LocalPresence,
  MIN_WRITER_SCHEMA,
  migrateBoardDoc,
  type PresenceState,
  type PresenceUser,
  parseBoardDocName,
  preparePlanLists,
  validateBoardDoc,
} from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { type Actor, atLeast, boardRole } from './access.ts';
import { adminEnrollmentRequired } from './admin-two-factor.ts';
import type { Auth } from './auth.ts';
import { trackGuestHiding } from './board-content.ts';
import { noteWriter, type PendingWriters, storeWriters } from './board-writers.ts';
import { fenceCollabWrite, StaleCollabEpochError } from './collab-epoch.ts';
import type { Database } from './db/client.ts';
import { board, boardDoc, personalToken, session, user } from './db/schema.ts';
import { prepareImageDrawings } from './image-drawing.ts';
import { boardProblem, recordProblem } from './monitor/problems.ts';
import { DocSizes, StoreRecorder } from './monitor/sampler.ts';
import type { MonitorStore, PresenceBoard } from './monitor/store.ts';
import { preparePlanListsOnChange } from './plan-lists-live.ts';
import { allowedOrigin, ORIGIN_HEADER, rawOrigin } from './request-origin.ts';
import { writeBoardIndex } from './search/index-doc.ts';
import {
  assignedItems,
  dropRemovedAssignees,
  notifyAssignment,
  trackAssignments,
  validateTaskUpdate,
} from './tasks.ts';
import { actorFromToken, isToken, recordTokenUse } from './tokens.ts';
import { malformedUpdate, stillWritable } from './update-shape.ts';
import { AUTO_VERSION_EVERY_MS, takeAutoVersion } from './versions.ts';

interface Context {
  actor: Actor;
  supportedSchemaVersion: number;
  /** The client runs the strict card check (`?strictCards=1`, decision 0102). */
  strictCards: boolean;
  /** Its role lets it edit; kept with the rechecks. */
  canEdit: boolean;
  /** Browser sign-ins: the session behind the cookie, checked again like the role. */
  sessionId: string | null;
  boardId: string;
  user: PresenceUser;
}

/** Sent to a client just before its board closes because the board was deleted or trashed. */
type BoardGoneNotice = Extract<BoardNotice, { type: 'boardGone' }>;

/** Sent to a client when its role on an open board changes between editing and reading. */
export interface AccessMessage {
  type: 'access';
  readOnly: boolean;
}

type WriteRefusal = { reason: 'frozen' | 'role' } | { reason: 'schema'; schemaVersion: number };

/** Sent to a client whose edits were not applied, with the reason (decision 0102). */
export type WriteRefusedMessage = { type: 'writeRefused' } & WriteRefusal;

/**
 * Why a connection only reads (decision 0102). A client that may not edit is told only that,
 * whatever else holds the board; the schema it would need is the one it can already learn.
 */
export function writeRefusal(state: {
  canEdit: boolean;
  frozen: boolean;
  schemaVersion: number;
}): WriteRefusal {
  if (!state.canEdit) return { reason: 'role' };
  if (state.frozen) return { reason: 'frozen' };
  return { reason: 'schema', schemaVersion: state.schemaVersion };
}

/**
 * The client ids under which an update holds items the document does not have, each with the
 * last clock it holds, from the clocks alone: no walk of the document. Deletions alone are not
 * seen; the next edit with content is. Items the document holds while they wait for others
 * (Yjs's pending structs, which sync passes on to clients) count as had.
 */
function newItems(document: Y.Doc, update: Uint8Array): Array<[client: number, clock: number]> {
  let sent: { from: Map<number, number>; to: Map<number, number> };
  let waiting: typeof sent | null = null;
  try {
    sent = Y.parseUpdateMeta(update);
    waiting = waitingClocks(document);
  } catch {
    return [];
  }
  if (sent.to.size === 0) return [];
  const have = Y.decodeStateVector(Y.encodeStateVector(document));
  // Whether the clocks sent, [from, to), are all integrated or waiting: [0, have) ∪ [wFrom, wTo).
  const held = (client: number, to: number) => {
    const integrated = have.get(client) ?? 0;
    if (to <= integrated) return true;
    const wFrom = waiting?.from.get(client);
    const wTo = waiting?.to.get(client);
    if (wFrom === undefined || wTo === undefined || to > wTo) return false;
    return wFrom <= integrated || (sent.from.get(client) ?? 0) >= wFrom;
  };
  return [...sent.to]
    .filter(([client, to]) => !held(client, to))
    .map(([client, to]) => [client, to - 1]);
}
const addsItems = (document: Y.Doc, update: Uint8Array) => newItems(document, update).length > 0;

/**
 * Presence client ids one connection may hold on a document for as long as it is open, so that
 * an authenticated connection cannot claim an unbounded number of them; the states of more are
 * dropped. A provider publishes one id, but several providers of one document can share a
 * connection: Hocuspocus hands the frames of a session-aware provider to the socket's session-less
 * connection to the same document until the session's own connection exists. 8 leaves room for
 * that, far above what a client opens.
 */
const PRESENCE_IDS_PER_CONNECTION = 8;

/** How often open connections are checked against the current roles (decision 0011). */
export const ACCESS_RECHECK_MS = 30_000;

/**
 * How often every open connection hears from the server. The Hocuspocus provider closes a
 * socket that receives nothing for 30 s (`messageReconnectTimeout`), and a person alone on a
 * board gets nothing otherwise: WebSocket pings do not count and their own awareness is not
 * echoed. Half of that timeout, so one lost tick is not enough to drop.
 */
export const KEEPALIVE_MS = 15_000;

/**
 * Passes that never overlap. `join` starts a pass or joins the one under way, so a tick that
 * finds the last pass still running waits for it instead of starting another (#760). `fresh`
 * waits for a pass that starts after the call, for a change just made: the pass under way may
 * have read the state before it. Calls during that wait share the same next pass.
 */
export function serialPasses(pass: () => Promise<void>) {
  let running: Promise<void> | undefined;
  let next: Promise<void> | undefined;
  const join = () =>
    (running ??= pass().finally(() => {
      running = undefined;
    }));
  const fresh = () => {
    if (!running) return join();
    next ??= running
      .catch(() => {})
      .then(() => {
        next = undefined;
        return join();
      });
    return next;
  };
  return { join, fresh };
}

export interface CollabLimits {
  /** Largest WebSocket message. */
  maxPayload: number;
  /** Demo only: freeze all edits and skip storing oversized state. */
  freeze?: boolean;
  /** Cards on one board. */
  elements: number;
  /** Size of a board's saved state. */
  stateBytes: number;
}

/**
 * The demo's caps (decision 0084): far above what a sample project needs, far below what
 * would let one sandbox fill the memory or the database of a small server.
 */
export const DEMO_COLLAB_LIMITS: CollabLimits = {
  freeze: true,
  maxPayload: 1024 * 1024,
  elements: 500,
  stateBytes: 2 * 1024 * 1024,
};

/** First retry of a failed board store; doubled at each failure up to the maximum (#795). */
const STORE_RETRY_FIRST_MS = 1000;
const STORE_RETRY_MAX_MS = 60_000;
const UNSAVED_SUFFIX = '.yupdate';
/**
 * A board where a card guests could see became hidden from them is stored this soon, instead of
 * after the usual debounce: share pages read the stored document. Short, so a burst of moves
 * still stores once.
 */
const GUEST_HIDING_STORE_MS = 300;
/** A board store that takes longer fails and is retried (#795). */
const STORE_TIMEOUT_MS = 15_000;
/**
 * At shutdown a store gets this long before the board is kept on disk instead: well inside
 * Docker's stop grace period (`stop_grace_period` in the compose files).
 */
export const SHUTDOWN_STORE_MS = 3000;

/** Rejects when the work takes longer than `ms`; the work itself goes on. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Where boards that could not be stored at shutdown wait for the next start (#795). */
export const unsavedBoardsDir = (dataDir: string) => join(dataDir, 'unsaved-boards');

/** Clocks Yjs holds back until the items they follow arrive (pending structs), per client. */
function waitingClocks(document: Y.Doc) {
  const pending = document.store.pendingStructs;
  // Yjs keeps them in its second update format.
  return pending ? Y.parseUpdateMetaV2(pending.update) : null;
}

/**
 * Whether a deletion names only items the document holds. Yjs would keep the rest as pending
 * deletions, which are stored with the board but measured by nothing.
 */
function deletesKnownItems(document: Y.Doc, update: Uint8Array): boolean {
  let deleted: ReturnType<typeof Y.decodeUpdate>['ds'];
  let waiting: ReturnType<typeof waitingClocks>;
  try {
    deleted = Y.decodeUpdate(update).ds;
    waiting = waitingClocks(document);
  } catch {
    return false;
  }
  const have = Y.decodeStateVector(Y.encodeStateVector(document));
  for (const [client, ranges] of deleted.clients) {
    const end = Math.max(have.get(client) ?? 0, waiting?.to.get(client) ?? 0);
    if (ranges.some((range) => range.clock + range.len > end)) return false;
  }
  return true;
}

/** A board's encoded size: measured (`exact`), or that plus what was applied since. */
export interface BoardSize {
  bytes: number;
  exact: boolean;
}

const grow = (sizes: WeakMap<Y.Doc, BoardSize>, document: Y.Doc, bytes: number) => {
  const size = sizes.get(document);
  if (size) sizes.set(document, { bytes: size.bytes + bytes, exact: false });
};

/** The board's size, measured for real only when the bound leaves no room for `extra` bytes. */
function sizeFor(sizes: WeakMap<Y.Doc, BoardSize>, document: Y.Doc, extra: number, cap: number) {
  let size = sizes.get(document);
  if (!size || (!size.exact && size.bytes + extra > cap)) {
    size = { bytes: Y.encodeStateAsUpdate(document).byteLength, exact: true };
    sizes.set(document, size);
  }
  return size.bytes;
}

/**
 * At most how many cards the board holds once the update is applied, read without applying it:
 * the keys it sets on `elements` that are not live there (or whose live card it deletes), plus
 * one for each item whose place cannot be told from the board and the update; live cards it
 * deletes count off. Edits inside existing cards add nothing. Items Yjs holds back count too,
 * as the update may be what they wait for.
 */
function cardsAfter(document: Y.Doc, update: Uint8Array): number {
  const elements = document.getMap('elements');
  const { store } = document;
  let sent: ReturnType<typeof Y.decodeUpdate>;
  let waiting: ReturnType<typeof Y.decodeUpdate>['structs'] = [];
  try {
    sent = Y.decodeUpdate(update);
    if (store.pendingStructs) waiting = Y.decodeUpdateV2(store.pendingStructs.update).structs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  const items = [...sent.structs, ...waiting].filter(
    (s): s is Y.Item =>
      s instanceof Y.Item && s.id.clock + s.length > Y.getState(store, s.id.client),
  );
  const byClient = new Map<number, Y.Item[]>();
  for (const item of items) {
    const list = byClient.get(item.id.client);
    if (list) list.push(item);
    else byClient.set(item.id.client, [item]);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.id.clock - b.id.clock);
  const find = (id: Y.ID) => {
    if (id.clock < Y.getState(store, id.client)) return Y.getItem(store, id);
    const list = byClient.get(id.client);
    try {
      return list?.[Y.findIndexSS(list, id.clock)];
    } catch {
      return undefined;
    }
  };
  // The key an item sets on `elements`; null: somewhere else; undefined: cannot tell.
  const placed = new Map<Y.Item, string | null | undefined>();
  const keyOf = (item: Y.Item, depth: number): string | null | undefined => {
    if (placed.has(item)) return placed.get(item);
    // Decoded items name a root type by its name, or the item of their parent type.
    const parent = item.parent as Y.AbstractType<unknown> | Y.ID | string | null;
    let key: string | null | undefined;
    if (parent instanceof Y.AbstractType) key = parent === elements ? item.parentSub : null;
    else if (typeof parent === 'string') key = parent === 'elements' ? item.parentSub : null;
    else if (parent) key = null;
    else {
      // Yjs takes the parent from the item it follows, else from the one it precedes.
      const next = item.origin ?? item.rightOrigin;
      const neighbour = next && depth < 100 ? find(next) : undefined;
      key = neighbour instanceof Y.Item ? keyOf(neighbour, depth + 1) : undefined;
    }
    placed.set(item, key);
    return key;
  };
  const deleted = new Set<string>();
  if (sent.ds.clients.size > 0)
    for (const [key, item] of elements._map)
      if (!item.deleted && Y.isDeleted(sent.ds, item.id)) deleted.add(key);
  const added = new Set<string>();
  let unknown = 0;
  for (const item of items) {
    const key = keyOf(item, 0);
    if (key === undefined) unknown++;
    else if (key !== null && (!elements.has(key) || deleted.has(key))) added.add(key);
  }
  return elements.size - deleted.size + added.size + unknown;
}

/**
 * Admits an update to a board under limits, without applying it to a copy. Deletions of items
 * the board holds always pass, including on boards saved before limits existed. An addition is
 * refused when the board's size plus the update's, or the cards counted by `cardsAfter`, pass
 * a cap: an update that would fit only thanks to what it also deletes is refused, and its
 * deletions then pass on their own (the web client sends them again after a refusal).
 *
 * `sizes` keeps each board's encoded size: measured for real only when the bound says an
 * addition may not fit, then reused until something else is applied, so refused additions cost
 * no further encoding. Updates are counted here rather than on change, as one Yjs holds back
 * until the items it follows arrive changes nothing yet but is stored with the board. Yjs may
 * split an item an update edits inside, a few bytes the bound misses until the next measure.
 */
export function admitBoardUpdate(
  document: Y.Doc,
  update: Uint8Array,
  limits: CollabLimits,
  sizes: WeakMap<Y.Doc, BoardSize>,
): boolean {
  if (addsItems(document, update)) {
    const bytes = sizeFor(sizes, document, update.byteLength, limits.stateBytes);
    if (bytes + update.byteLength > limits.stateBytes) return false;
    if (cardsAfter(document, update) > limits.elements) return false;
  } else if (!deletesKnownItems(document, update)) return false;
  grow(sizes, document, update.byteLength);
  return true;
}

/** A board document written for a board row that no longer exists. */
function boardGone(err: unknown): boolean {
  for (let e = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, constraint_name } = e as { code?: string; constraint_name?: string };
    if (code === '23503' && constraint_name === 'board_doc_board_id_board_id_fk') return true;
  }
  return false;
}

/**
 * Upserts a board's document only while its board row exists (#935): a board deleted for good
 * (its project, or emptied from the trash) writes no row, instead of an insert the foreign key
 * rejects in the database log. False means the board is gone; callers keep `boardGone` for a
 * deletion between this check and the write.
 */
async function storeIfBoardExists(
  tx: Pick<Database, 'execute'>,
  boardId: string,
  state: Uint8Array,
  schemaVersion: number,
) {
  const bytes = Buffer.from(state.buffer, state.byteOffset, state.byteLength);
  const rows = await tx.execute(sql`
    insert into ${boardDoc} (board_id, state, schema_version, size)
    select ${board.id}, ${bytes}::bytea, ${schemaVersion}::int, ${state.byteLength}::int
    from ${board} where ${board.id} = ${boardId}
    on conflict (board_id) do update set state = excluded.state,
      schema_version = excluded.schema_version, size = excluded.size,
      updated_at = ${new Date().toISOString()}::timestamptz
    returning board_id`);
  return rows.length > 0;
}

/** `<boardId>.yupdate`, or `<boardId>.<time>.yupdate` when the first one was unreadable. */
function unsavedBoardId(name: string, claimed = false) {
  const kept = name.endsWith(UNSAVED_SUFFIX) || (claimed && name.endsWith(DRAINING_SUFFIX));
  const boardId = kept ? name.split('.')[0] : null;
  return boardId && parseBoardDocName(boardDocName(boardId)) === boardId ? boardId : null;
}

/** Whether a file holds a Yjs update at all. */
function decodable(update: Uint8Array) {
  try {
    Y.decodeUpdate(update);
    return true;
  } catch {
    return false;
  }
}

/** In the demo (`freeze`, decision 0084): a board past its caps, which is never stored. */
function overDemoCaps(limits: CollabLimits | undefined, document: Y.Doc) {
  if (!limits?.freeze) return false;
  return (
    document.getMap('elements').size > limits.elements ||
    Y.encodeStateAsUpdate(document).byteLength > limits.stateBytes
  );
}

/** A file being merged by the collab process serving the boards (F-24); replayed after a crash. */
const DRAINING_SUFFIX = '.draining';
/** A file whose content is not a Yjs update: left for an operator, never retried. */
const UNREADABLE_SUFFIX = '.unreadable';
/** Longest wait before merging again a file whose merge failed. */
const DRAIN_RETRY_MAX_MS = 60 * 60_000;

/**
 * Whether the stored board already holds every item and deletion of `update`, those Yjs holds
 * back included (pending structs and deletions), or the board is gone; 'no' while the store of
 * the merged board has not happened yet. Compared as whole encoded states, which carry what is
 * pending: a snapshot leaves out pending deletions.
 */
export async function storedHolds(db: Database, boardId: string, update: Uint8Array) {
  const [row] = await db
    .select({ state: boardDoc.state })
    .from(boardDoc)
    .where(eq(boardDoc.boardId, boardId));
  if (!row) {
    const [live] = await db.select({ id: board.id }).from(board).where(eq(board.id, boardId));
    return live ? 'no' : 'gone';
  }
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.state);
    const before = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(doc, update);
    return Buffer.from(before).equals(Y.encodeStateAsUpdate(doc)) ? 'yes' : 'no';
  } finally {
    doc.destroy();
  }
}

/** How often the collab process merges boards another collab process kept on disk (F-24). */
const DRAIN_UNSAVED_MS = 60_000;

/**
 * Stores the boards a shutdown kept on disk (#795), merged into what the database has, before any
 * board opens. A file that cannot be stored stays for the next start. With the process's collab
 * `epoch` (collab-epoch.ts), a newer collab process makes it throw `StaleCollabEpochError`.
 */
export async function replayUnsavedBoards(
  db: Database,
  dir: string,
  log: Logger,
  epoch?: number,
  /** The server's caps: in the demo (`freeze`), a board they would pass is not stored. */
  limits?: CollabLimits,
) {
  const names = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') log.error({ err, dir }, 'boards kept on disk not readable');
    return [];
  });
  for (const name of names) {
    // A `.draining` file too: one the last run was merging when it stopped.
    const boardId = unsavedBoardId(name, true);
    if (!boardId) continue;
    const file = join(dir, name);
    try {
      const kept = await readFile(file);
      if (!decodable(kept)) {
        const parked = join(dir, `${boardId}.${randomUUID()}${UNREADABLE_SUFFIX}`);
        await rename(file, parked);
        log.error({ boardId, file: parked }, 'board kept on disk is not readable: left');
        continue;
      }
      const written = await db.transaction(async (tx) => {
        await fenceCollabWrite(tx, epoch);
        const [row] = await tx
          .select({ state: boardDoc.state })
          .from(boardDoc)
          .where(eq(boardDoc.boardId, boardId))
          .for('update');
        const document = new Y.Doc();
        if (row) Y.applyUpdate(document, row.state);
        Y.applyUpdate(document, kept);
        if (overDemoCaps(limits, document)) return 'capped';
        const state = Y.encodeStateAsUpdate(document);
        return storeIfBoardExists(tx, boardId, state, getSchemaVersion(document));
      });
      await rm(file, { force: true });
      log.info(
        { boardId },
        written === 'capped'
          ? 'board kept on disk at the last shutdown is over the demo caps: dropped'
          : written
            ? 'board kept on disk at the last shutdown: stored'
            : 'board kept on disk at the last shutdown was deleted: dropped',
      );
    } catch (err) {
      // The file stays for whoever starts here next; this process must not serve boards.
      if (err instanceof StaleCollabEpochError) throw err;
      if (boardGone(err)) {
        await rm(file, { force: true });
        log.info({ boardId }, 'board kept on disk at the last shutdown was deleted: dropped');
      } else
        log.error({ err, boardId, file }, 'board kept on disk not stored: retried at next start');
    }
  }
}

export function createCollabServer(deps: {
  db: Database;
  auth: Auth;
  log: Logger;
  publicUrl: string;
  trustProxy?: boolean | string;
  recheckMs?: number;
  keepaliveMs?: number;
  /** Clock for automatic versions; tests move it forward. */
  now?: () => Date;
  /** Board caps; the demo additionally freezes all edits. */
  limits?: CollabLimits;
  /**
   * Where a board still not stored at shutdown is written, for replayUnsavedBoards at the next
   * start (unsavedBoardsDir). Without it those edits are only logged as lost.
   */
  unsavedDir?: string;
  /** Oldest client schema that may write (decision 0102); tests lower it. */
  minWriterSchema?: number;
  /** Waits GUEST_HIDING_STORE_MS, then runs; returns a cancel. Tests drive it by hand. */
  hidingTimer?: (run: () => void) => () => void;
  /** Where a board that cannot be saved or opened goes for the Server page (#514). */
  monitor?: { store: MonitorStore; role: 'collab' | 'all' };
  /** How often boards kept in `unsavedDir` by another process are merged; tests shorten it. */
  drainMs?: number;
  /**
   * This process's collab epoch (collab-epoch.ts): board writes are refused once a newer collab
   * process took over, and `onStale` then runs once (this process must stop, as on a lost lease).
   */
  fence?: { epoch: number; onStale: () => void };
}) {
  const { db, auth, log, limits } = deps;
  const minWriterSchema = deps.minWriterSchema ?? MIN_WRITER_SCHEMA;
  const reportBoard = (
    kind: 'board_save_failed' | 'board_load_failed',
    boardId: string,
    err: unknown,
  ) => {
    log.error(
      { err, boardId },
      kind === 'board_save_failed' ? 'board not stored' : 'board not loaded',
    );
    if (deps.monitor)
      recordProblem(
        deps.monitor.store,
        boardProblem(
          kind,
          deps.monitor.role,
          boardId,
          err instanceof Error ? err : new Error(String(err)),
        ),
        log,
      );
  };
  /**
   * The oldest client schema that may write a document (decision 0102): the minimum for clients
   * that declare the strict card check, the current schema for the others. A document a newer
   * client upgraded needs that client's schema.
   */
  const requiredSchema = (ctx: Pick<Context, 'strictCards'>, document?: Y.Doc) => {
    const version = document ? getSchemaVersion(document) : 0;
    if (version > CURRENT_SCHEMA_VERSION) return version;
    return ctx.strictCards ? minWriterSchema : CURRENT_SCHEMA_VERSION;
  };
  const refusal = (ctx: Context, document: Y.Doc) =>
    writeRefusal({
      canEdit: ctx.canEdit,
      frozen: frozen.has(document),
      schemaVersion: requiredSchema(ctx, document),
    });
  /** The refusal last told to each connection: said once, and again when it changes. */
  const refusalsSent = new WeakMap<object, string>();
  /** Boards past a cap: nobody writes to them and they are not saved (decision 0084). */
  const frozen = new WeakSet<Y.Doc>();
  /**
   * Bytes of a capped board: measured, plus what was applied since, measured for real again
   * only near the cap, as encoding a whole board on every keystroke would cost too much.
   */
  const grown = new WeakMap<Y.Doc, BoardSize>();
  /**
   * Whether the server may add a card to a board (clips, the share sheet) under the caps.
   * shortcut: the card itself is not measured, so it may take the board past the byte cap by
   * its own size (a few KB of text at most); measure it if server-side cards grow larger.
   */
  const hasRoom = (document: Y.Doc) =>
    !limits ||
    (!frozen.has(document) &&
      document.getMap('elements').size < limits.elements &&
      sizeFor(grown, document, 1, limits.stateBytes) < limits.stateBytes);
  const freeze = (document: Document, boardId: string | undefined) => {
    if (!frozen.has(document)) log.warn({ boardId }, 'board over the demo caps: read-only');
    frozen.add(document);
    cancelHiding(document);
    for (const connection of document.getConnections() as Array<Connection<Context>>) {
      if (connection.readOnly) continue;
      connection.readOnly = true;
      connection.sendStateless(
        JSON.stringify({ type: 'access', readOnly: true } satisfies AccessMessage),
      );
    }
  };
  /**
   * The connection (one per document session: several can share a socket) that published
   * presence under each Yjs client id of a document.
   */
  const owners = new Map<string, Connection<Context>>();
  /**
   * The same per connection: its cap, and what its close frees without reading every entry. An id
   * stays claimed until the connection closes, removed or not, as main keeps it. No other
   * connection can publish it meanwhile, and Hocuspocus removes a closing connection's presence
   * (its own registry of the ids that first appeared on it) before it runs the close callbacks:
   * so one connection's close never removes another's presence.
   */
  const claims = new WeakMap<Connection<Context>, Set<number>>();
  // Seed lazily from the authoritative transaction, including after a process restart.
  const lastAutoAt = new Map<string, number>();
  const ownerKey = (documentName: string, clientId: number) => `${documentName}#${clientId}`;
  /** When each board was opened, for the people on it in the Server page (#514). */
  const openedAt = new WeakMap<object, number>();

  async function signedIn(
    token: string,
    headers: Headers,
  ): Promise<{ actor: Actor; sessionId: string | null } | null> {
    // Native apps and the clipper send their token; browsers send the session cookie.
    if (isToken(token)) {
      const actor = await actorFromToken(db, token);
      // A limited token (the Clipper's, decision 0137) never opens a board.
      if (!actor?.tokenId || actor.scope !== 'full' || (await adminEnrollmentRequired(db, actor)))
        return null;
      await recordTokenUse(db, actor.tokenId);
      return { actor, sessionId: null };
    }
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    const [owner] = await db.select().from(user).where(eq(user.id, session.user.id));
    if (!owner || owner.deactivatedAt || (await adminEnrollmentRequired(db, owner))) return null;
    return {
      actor: {
        id: session.user.id,
        role: owner.role,
      },
      sessionId: session.session.id,
    };
  }

  /** Whether the token or session a connection signed in with is still valid. */
  async function stillSignedIn(ctx: Context, now: Date): Promise<boolean> {
    if (ctx.actor.tokenId) {
      const [row] = await db
        .select({ id: personalToken.id })
        .from(personalToken)
        .where(
          and(
            eq(personalToken.id, ctx.actor.tokenId),
            or(isNull(personalToken.expiresAt), gt(personalToken.expiresAt, now)),
          ),
        );
      return !!row;
    }
    if (!ctx.sessionId) return false;
    const [row] = await db
      .select({ id: session.id })
      .from(session)
      .where(and(eq(session.id, ctx.sessionId), gt(session.expiresAt, now)));
    return !!row;
  }

  /** Why a board nobody can open is gone: in the trash, or deleted (no row). */
  async function goneReason(boardId: string): Promise<BoardGoneNotice['reason'] | null> {
    const [row] = await db
      .select({ deletedAt: board.deletedAt })
      .from(board)
      .where(eq(board.id, boardId));
    return !row ? 'deleted' : row.deletedAt ? 'trash' : null;
  }

  /**
   * Closes connections whose token or session ended (4401) or that lost their role (4403), and
   * updates read-only on the others. Each person, sign-in and (person, board) pair is read once
   * per pass however many tabs they have open.
   */
  const rechecks = serialPasses(() => recheckAll(server));

  async function recheckAll(server: Server<Context>) {
    const now = new Date();
    const once = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
      const known = cache.get(key);
      if (known) return known;
      const loaded = load();
      cache.set(key, loaded);
      return loaded;
    };
    // The account, or null when it may no longer sign in.
    const people = new Map<string, Promise<typeof user.$inferSelect | null>>();
    const signIns = new Map<string, Promise<boolean>>();
    const roles = new Map<string, ReturnType<typeof boardRole>>();
    const gone = new Map<string, Promise<BoardGoneNotice['reason'] | null>>();
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections() as Array<Connection<Context>>) {
        const ctx = connection.context;
        if (!ctx?.actor) continue;
        const actorId = ctx.actor.id;
        try {
          const owner = await once(people, actorId, async () => {
            const [row] = await db.select().from(user).where(eq(user.id, actorId));
            return row && !row.deactivatedAt && !(await adminEnrollmentRequired(db, row))
              ? row
              : null;
          });
          if (owner) ctx.actor.role = owner.role;
          const credential = ctx.actor.tokenId ? `t:${ctx.actor.tokenId}` : `s:${ctx.sessionId}`;
          if (!owner || !(await once(signIns, credential, () => stillSignedIn(ctx, now)))) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: signed out');
            connection.close({ code: 4401, reason: 'Unauthorized' });
            continue;
          }
          const access = await once(roles, `${actorId}:${ctx.boardId}`, () =>
            boardRole(db, ctx.actor, ctx.boardId),
          );
          if (!access?.role) {
            // No board to have a role on: it was deleted or moved to the trash (#951). Said
            // first, so the client tells the person that rather than "no access".
            const reason = access
              ? null
              : await once(gone, ctx.boardId, () => goneReason(ctx.boardId));
            if (reason)
              connection.sendStateless(
                JSON.stringify({ type: 'boardGone', reason } satisfies BoardGoneNotice),
              );
            log.info(
              { boardId: ctx.boardId, reason },
              reason
                ? 'collab connection closed: board gone'
                : 'collab connection closed: access removed',
            );
            connection.close({ code: 4403, reason: 'Forbidden' });
          } else {
            ctx.canEdit = atLeast(access.role, 'editor');
            const readOnly =
              frozen.has(document) ||
              !ctx.canEdit ||
              ctx.supportedSchemaVersion < requiredSchema(ctx, document);
            if (readOnly !== connection.readOnly) {
              connection.readOnly = readOnly;
              // Tell the client, so the editor follows instead of dropping what someone types.
              if (ctx.supportedSchemaVersion >= requiredSchema(ctx, document))
                connection.sendStateless(
                  JSON.stringify({ type: 'access', readOnly } satisfies AccessMessage),
                );
            }
          }
        } catch (err) {
          log.warn({ err }, 'collab access check failed');
        }
      }
    }
  }

  const assignments = new WeakMap<Y.Doc, ReturnType<typeof assignedItems>>();
  /** The schema version each open board was last validated at, for the invalid-elements log. */
  const validatedAt = new WeakMap<Y.Doc, number>();
  /** Each open board's assignments now (trackAssignments). */
  const assignedNow = new WeakMap<Y.Doc, () => ReturnType<typeof assignedItems>>();
  const pendingAssignments = new WeakMap<
    Y.Doc,
    Map<string, { actorId: string; elementId: string; assigneeId: string }>
  >();
  /** Who wrote under which client id since each board was last stored (decision 0120). */
  const writers = new WeakMap<Y.Doc, PendingWriters>();
  const writersOf = (document: Y.Doc) => {
    const pending = writers.get(document) ?? new Map();
    writers.set(document, pending);
    return pending;
  };
  let timer: NodeJS.Timeout | undefined;
  let keepalive: NodeJS.Timeout | undefined;
  /**
   * An awareness update that changes no client: every Hocuspocus client, of any age, applies it
   * without an event, and it still counts as a message received.
   */
  function keepAlive() {
    for (const document of server.hocuspocus.documents.values())
      for (const connection of document.getConnections())
        connection.send(
          new OutgoingMessage(connection.messageAddress)
            .createAwarenessUpdateMessage(document.awareness, [])
            .toUint8Array(),
        );
  }

  type StorePayload = Parameters<Server['hocuspocus']['storeDocumentHooks']>[1];
  /**
   * Boards whose last store failed (#795). Hocuspocus keeps such a document in memory but never
   * stores it again unless it changes, and unloads it when the last person leaves: retry with
   * backoff, and refuse to unload it until a store succeeds.
   */
  const unsaved = new Map<
    Y.Doc,
    { attempt: number; payload: StorePayload; timer?: NodeJS.Timeout }
  >();
  let closing = false;
  const storeTimes = new StoreRecorder();
  const sizes = new DocSizes();
  /** The board is stored, or never will be (deleted, frozen, shutdown): nothing is pending. */
  const stored = (document: Y.Doc) => {
    clearTimeout(unsaved.get(document)?.timer);
    unsaved.delete(document);
    cancelHiding(document);
  };
  const retryStore = (payload: StorePayload) => {
    const { document, documentName } = payload;
    const entry = unsaved.get(document) ?? { attempt: 0, payload };
    unsaved.set(document, entry);
    // The retry stores everything: no early store waits through the backoff.
    cancelHiding(document);
    entry.attempt += 1;
    entry.payload = payload;
    clearTimeout(entry.timer);
    const delay = Math.min(STORE_RETRY_MAX_MS, STORE_RETRY_FIRST_MS * 2 ** (entry.attempt - 1));
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (server.hocuspocus.documents.get(documentName) !== document) return stored(document);
      void server.hocuspocus.storeDocumentHooks(document, payload, true);
    }, delay);
    entry.timer.unref();
    return delay;
  };
  /** Each open board's watch for cards newly hidden from guests (trackGuestHiding). */
  const guestHiding = new WeakMap<Y.Doc, () => boolean>();
  /** Counts each change that hid from guests a card they saw, so a store knows if it wrote it. */
  const hidingCount = new WeakMap<Y.Doc, number>();
  /** The count the last store that succeeded had read. */
  const storedHiding = new WeakMap<Y.Doc, number>();
  /** Boards a store is writing: an early store waits for it instead of queueing behind it. */
  const storing = new WeakSet<Y.Doc>();
  /** The pending early store of each board with a card newly hidden from guests: its cancel. */
  const hidingStores = new Map<Y.Doc, () => void>();
  const hidingTimer =
    deps.hidingTimer ??
    ((run: () => void) => {
      const timer = setTimeout(run, GUEST_HIDING_STORE_MS);
      timer.unref();
      return () => clearTimeout(timer);
    });
  /**
   * No early store can be due: frozen boards, a shutdown and a superseded process (F-24) don't
   * store, and a retry will.
   */
  const mayStoreSoon = (document: Y.Doc) =>
    !closing && !superseded && !frozen.has(document) && !unsaved.has(document);
  const storeSoon = (payload: StorePayload) => {
    const { document, documentName } = payload;
    // One per board until it runs, so a burst of changes stores once.
    if (hidingStores.has(document) || !mayStoreSoon(document)) return;
    let ran = false;
    const cancel = hidingTimer(() => {
      ran = true;
      hidingStores.delete(document);
      if (!mayStoreSoon(document) || server.hocuspocus.documents.get(documentName) !== document)
        return;
      // Never queued behind a store in flight: that store, once written, arms it again if the
      // state it read was older; a store that already read the hiding makes it moot.
      if (storing.has(document)) return;
      if ((hidingCount.get(document) ?? 0) <= (storedHiding.get(document) ?? 0)) return;
      void server.hocuspocus.storeDocumentHooks(document, payload, true);
    });
    // A timer that already ran leaves nothing pending.
    if (!ran) hidingStores.set(document, cancel);
  };
  function cancelHiding(document: Y.Doc) {
    hidingStores.get(document)?.();
    hidingStores.delete(document);
  }
  /**
   * A newer collab process took over (F-24): its clients reconnect to it once this process stops,
   * and it has the stored state. Boards this one still holds are not unloaded but kept on disk at
   * shutdown (`spill`), whose replay merges them into the stored state, so nothing is lost.
   */
  let superseded = false;
  const supersede = (err: StaleCollabEpochError) => {
    if (superseded) return;
    superseded = true;
    // Nothing it writes is stored any more: no early store stays armed.
    for (const cancel of hidingStores.values()) cancel();
    hidingStores.clear();
    log.error(
      { err: err.message },
      'another collab process took over the boards: this one stops, its clients reconnect',
    );
    deps.fence?.onStale();
  };
  /** A store of a superseded process: no database round trip; on disk at shutdown. */
  const keepSuperseded = (boardId: string, document: Y.Doc, payload: StorePayload) => {
    if (closing) {
      stored(document);
      return spill(boardId, document);
    }
    // Kept in memory without a retry: the shutdown keeps it on disk.
    clearTimeout(unsaved.get(document)?.timer);
    unsaved.set(document, { attempt: 0, payload });
  };
  /**
   * For collab-owned writes outside the store (versions): first in their transaction, refused
   * once a newer collab process took over, which also stops this one.
   */
  async function fenceWrite(tx: Pick<Database, 'execute'>) {
    if (superseded) throw new StaleCollabEpochError('a newer collab process took over');
    try {
      await fenceCollabWrite(tx, deps.fence?.epoch);
    } catch (err) {
      if (err instanceof StaleCollabEpochError) supersede(err);
      throw err;
    }
  }
  /**
   * Boards a superseded collab process kept on disk while this one serves (F-24): each file is
   * taken (renamed, so a process still writing one starts a new file), merged into the live board
   * through a direct connection, and then stored like any edit, retried or kept on disk on
   * failure. Waiting for a restart would merge week-old edits, deletions included, much later.
   * shortcut: only files in this process's own `unsavedDir`; a superseded process on another
   * data volume leaves its files for its own next start, and logs where they are.
   */
  /** Files merged into a live board, removed once its stored state holds them. */
  const merged = new Map<string, { boardId: string; update: Uint8Array }>();
  /** Boards whose file failed to merge: when to try again, with backoff. */
  const retryDrain = new Map<string, { attempt: number; at: number }>();
  let drainRun: Promise<void> | undefined;
  const drainMs = deps.drainMs ?? DRAIN_UNSAVED_MS;
  /** Renames a file, logging a failure: the file then stays where it is, under its old name. */
  const move = (from: string, to: string) =>
    rename(from, to).then(
      () => true,
      (err: unknown) => {
        log.error({ err, from, to }, 'board kept on disk could not be renamed');
        return false;
      },
    );
  async function drainOnce(dir: string) {
    // Merged files go once the board's store holds them; never while stopping or superseded,
    // when that store may not happen (the file is replayed at the next start).
    for (const [file, { boardId, update }] of merged) {
      if (closing || superseded) return;
      // A demo board frozen since: never stored, so nothing would ever hold the file.
      const live = server.hocuspocus.documents.get(boardDocName(boardId));
      if (live && frozen.has(live)) {
        await rm(file, { force: true });
        merged.delete(file);
        log.warn({ boardId }, 'board kept on disk is over the demo caps: dropped');
        continue;
      }
      try {
        const held = await storedHolds(db, boardId, update);
        if (held === 'no') continue;
        await rm(file, { force: true });
        merged.delete(file);
      } catch (err) {
        log.warn({ err, boardId }, 'board merged from disk not checked yet: checked again later');
      }
    }
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (closing || superseded) return;
      const boardId = unsavedBoardId(name);
      if (!boardId || (retryDrain.get(boardId)?.at ?? 0) > Date.now()) continue;
      const taken = join(dir, `${boardId}.${randomUUID()}${DRAINING_SUFFIX}`);
      if (!(await move(join(dir, name), taken))) continue;
      let update: Uint8Array;
      try {
        update = await readFile(taken);
      } catch (err) {
        await failedDrain(dir, boardId, taken, err);
        continue;
      }
      if (!decodable(update)) {
        const parked = join(dir, `${boardId}.${randomUUID()}${UNREADABLE_SUFFIX}`);
        await move(taken, parked);
        log.error({ boardId, file: parked }, 'board kept on disk is not readable: left');
        continue;
      }
      let capped = false;
      try {
        const connection = await server.hocuspocus.openDirectConnection(boardDocName(boardId));
        try {
          await connection.transact((doc) => {
            // The demo never stores a board past its caps: merging would only freeze it.
            if (limits?.freeze) {
              const merged = new Y.Doc();
              try {
                Y.applyUpdate(merged, Y.encodeStateAsUpdate(doc));
                Y.applyUpdate(merged, update);
                capped = frozen.has(doc) || overDemoCaps(limits, merged);
              } finally {
                merged.destroy();
              }
              if (capped) return;
            }
            Y.applyUpdate(doc, update);
          });
        } finally {
          await connection.disconnect({ unloadImmediately: false });
        }
      } catch (err) {
        await failedDrain(dir, boardId, taken, err);
        continue;
      }
      if (capped) {
        await rm(taken, { force: true });
        log.warn({ boardId }, 'board kept on disk is over the demo caps: dropped');
        continue;
      }
      retryDrain.delete(boardId);
      merged.set(taken, { boardId, update });
      log.warn({ boardId }, 'board kept on disk by another collab process: merged');
    }
  }
  /** Gives a file that failed to merge back its place, to be tried again with backoff. */
  async function failedDrain(dir: string, boardId: string, taken: string, err: unknown) {
    const attempt = (retryDrain.get(boardId)?.attempt ?? 0) + 1;
    const delay = Math.min(DRAIN_RETRY_MAX_MS, drainMs * 2 ** (attempt - 1));
    retryDrain.set(boardId, { attempt, at: Date.now() + delay });
    const back = join(dir, `${boardId}.${randomUUID()}${UNSAVED_SUFFIX}`);
    await move(taken, back);
    log.error({ err, boardId, file: back, retryInMs: delay }, 'board kept on disk not merged');
  }
  /**
   * Boards a superseded collab process kept on disk while this one serves (F-24): each file is
   * taken (renamed, so a process still writing one starts a new file), merged into the live board
   * through a direct connection, stored like any edit (retried or kept on disk on failure), and
   * removed only once the stored board holds it. Waiting for a restart would merge week-old
   * edits, deletions included, much later. A file of the last run still `.draining` is replayed
   * at the next start.
   * shortcut: only files in this process's own `unsavedDir`; a superseded process on another
   * data volume leaves its files for its own next start, and logs where they are.
   */
  function drainUnsaved() {
    const dir = deps.unsavedDir;
    if (!dir || drainRun || closing || superseded) return drainRun;
    drainRun = drainOnce(dir).finally(() => {
      drainRun = undefined;
    });
    return drainRun;
  }
  let drainTimer: NodeJS.Timeout | undefined;

  /** At shutdown, after one last failed store: keep the board on disk for the next start. */
  async function spill(boardId: string, document: Y.Doc) {
    if (!deps.unsavedDir) {
      log.error({ boardId }, 'board not stored at shutdown: its latest edits are lost');
      return;
    }
    const file = join(deps.unsavedDir, `${boardId}${UNSAVED_SUFFIX}`);
    try {
      await mkdir(deps.unsavedDir, { recursive: true });
      const update = Y.encodeStateAsUpdate(document);
      // A file left by an earlier shutdown that could not be replayed yet: keep both.
      let target = file;
      let before: Uint8Array | null = null;
      try {
        before = await readFile(file);
      } catch (err) {
        // An unreadable earlier file is left as it is: these edits go to a file of their own.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
          target = join(deps.unsavedDir, `${boardId}.${Date.now()}${UNSAVED_SUFFIX}`);
      }
      const partial = `${target}.${randomUUID()}.partial`;
      try {
        await writeFile(partial, before ? Y.mergeUpdates([before, update]) : update);
        await rename(partial, target);
      } finally {
        await rm(partial, { force: true });
      }
      log.warn(
        { boardId, file: target },
        'board not stored at shutdown: kept on disk for the next start',
      );
    } catch (err) {
      log.error({ err, boardId }, 'board not stored at shutdown: its latest edits are lost');
    }
  }

  const server: Server<Context> = new Server<Context>({
    name: 'inkadra-collab',
    quiet: true,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: limits?.maxPayload ?? 16 * 1024 * 1024 },

    async onConfigure() {
      timer = setInterval(() => {
        void rechecks.join();
        // An automatic version time is kept after its board closes, so a board opened again skips
        // the database until that version is an hour old; past that the next store checks the
        // database anyway, so the entry can go (or when the clock moved back).
        const now = (deps.now?.() ?? new Date()).getTime();
        for (const [boardId, at] of lastAutoAt)
          if (now - at >= AUTO_VERSION_EVERY_MS || now < at) lastAutoAt.delete(boardId);
      }, deps.recheckMs ?? ACCESS_RECHECK_MS);
      timer.unref();
      keepalive = setInterval(keepAlive, deps.keepaliveMs ?? KEEPALIVE_MS);
      keepalive.unref();
      if (deps.unsavedDir) {
        drainTimer = setInterval(() => void drainUnsaved(), drainMs);
        drainTimer.unref();
      }
    },

    async onDestroy() {
      if (timer) clearInterval(timer);
      if (keepalive) clearInterval(keepalive);
      if (drainTimer) clearInterval(drainTimer);
    },

    async onUpgrade({ request, socket }) {
      // Superseded: a newer collab process serves the boards, which the client reaches by
      // reconnecting (an upgrade that fails is retried, unlike a refused authentication).
      if (superseded) {
        socket.destroy();
        return Promise.reject();
      }
      let own: string;
      try {
        own = rawOrigin(request, deps.trustProxy ?? false);
      } catch {
        socket.destroy();
        // Hocuspocus treats rejection without a reason as an already handled upgrade.
        return Promise.reject();
      }
      // Resolve before removing any forwarded headers.
      request.headers[ORIGIN_HEADER] = own;
      // Downstream auth must never interpret unsanitized proxy headers.
      for (const key of Object.keys(request.headers))
        if (key.startsWith('x-forwarded-')) delete request.headers[key];
    },

    async onAuthenticate({
      documentName,
      requestHeaders,
      connectionConfig,
      token,
      requestParameters,
    }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) throw new Error('Unknown document');
      // Browsers always send Origin on WebSocket upgrades; native apps send none.
      const origin = requestHeaders.get('origin');
      if (origin && !allowedOrigin(origin, requestHeaders.get(ORIGIN_HEADER) ?? '', deps.publicUrl))
        throw new Error('Origin not allowed');
      // A client that asks (`reasons=1`) is told a signed-out session and a lost access apart from
      // other refusals, with the reasons of the matching closes (#791): it deletes its copy of the
      // board only for `Forbidden` (no access, an expired grant, or the board is in the trash and
      // may be restored), setting edits it holds aside first. Others keep the generic
      // "permission-denied" they know.
      const reasons = requestParameters.get('reasons') === '1';
      const refuse = (message: string, reason: 'Unauthorized' | 'Forbidden') =>
        Object.assign(new Error(message), reasons ? { reason } : {});
      const signed = await signedIn(token, requestHeaders);
      if (!signed) throw refuse('Not signed in', 'Unauthorized');
      const { actor } = signed;
      const access = await boardRole(db, actor, boardId);
      if (!access?.role) throw refuse('Not allowed', 'Forbidden');
      const [me] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, actor.id));
      const advertised = requestParameters.get('schemaVersion');
      const supportedSchemaVersion =
        advertised && /^\d+$/.test(advertised) && Number.isSafeInteger(Number(advertised))
          ? Number(advertised)
          : 0;
      const strictCards = requestParameters.get('strictCards') === '1';
      const canEdit = atLeast(access.role, 'editor');
      // An open document may already be of a newer schema than ours (a newer client upgraded it).
      const open = server.hocuspocus.documents.get(documentName);
      connectionConfig.readOnly =
        !canEdit || supportedSchemaVersion < requiredSchema({ strictCards }, open);
      if (open && frozen.has(open)) connectionConfig.readOnly = true;
      return {
        actor,
        supportedSchemaVersion,
        strictCards,
        canEdit,
        sessionId: signed.sessionId,
        boardId,
        user: { id: actor.id, name: me?.name ?? '', image: me?.image ?? null },
      } satisfies Context;
    },

    /**
     * Presence comes from clients, so the server writes who they are: nobody can appear as
     * someone else, change another client's presence or remove it.
     */
    async beforeHandleAwareness({ states, removedClients, connection, documentName, document }) {
      if (!connection) return;
      const ctx = connection.context;
      for (const [clientId, state] of states) {
        const key = ownerKey(documentName, clientId);
        const owner = owners.get(key);
        const local = LocalPresence.safeParse(state);
        // A message still queued when its connection closed publishes nothing.
        if (
          (owner && owner !== connection) ||
          !ctx?.user ||
          !local.success ||
          !document.hasConnection(connection)
        ) {
          states.delete(clientId);
          continue;
        }
        if (!owner) {
          let claimed = claims.get(connection);
          if (!claimed) {
            const mine = new Set<number>();
            claimed = mine;
            claims.set(connection, mine);
            // Like onDisconnect: once what the connection still had queued is handled.
            connection.onClose(() => {
              void connection.waitForPendingMessages().then(() => {
                for (const id of mine)
                  if (owners.get(ownerKey(documentName, id)) === connection)
                    owners.delete(ownerKey(documentName, id));
              });
            });
          }
          if (claimed.size >= PRESENCE_IDS_PER_CONNECTION) {
            states.delete(clientId);
            continue;
          }
          claimed.add(clientId);
          owners.set(key, connection);
        }
        const stamped: PresenceState = {
          ...local.data,
          // Only someone who can write may appear to be typing.
          ...(local.data.typing !== undefined
            ? { typing: local.data.typing && !connection.readOnly && local.data.editing !== null }
            : {}),
          user: ctx.user,
          readOnly: connection.readOnly,
        };
        states.set(clientId, stamped);
      }
      for (const clientId of removedClients) {
        if (owners.get(ownerKey(documentName, clientId)) !== connection)
          removedClients.delete(clientId);
      }
    },

    async beforeUnloadDocument({ document }) {
      // Throwing keeps the document in memory: the retry timer stores it, then it unloads.
      if (unsaved.has(document)) throw new Error('Board not stored yet: kept in memory');
      cancelHiding(document);
    },

    async onLoadDocument({ document, documentName }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) throw new Error('Unknown document');
      try {
        const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
        if (row) Y.applyUpdate(document, row.state);
        // Elsewhere the first addition measures it, after the migrations below.
        if (limits?.freeze) {
          grown.set(document, { bytes: row?.state.byteLength ?? 0, exact: false });
        }
        const steps = migrateBoardDoc(document, boardId);
        if (steps.length > 0) log.info({ boardId, steps }, 'board document migrated');
        prepareImageDrawings(document);
        // Set plans' lists made or converted here, before any client syncs (decision of 23 Nov),
        // and stored at once: Hocuspocus stores only after a change once the board is open, and
        // a board opened and left without an edit would serve another list at the next load.
        // The row as it is now goes into the document first, so a write that landed meanwhile is kept.
        const lists = preparePlanLists(document);
        if (lists > 0 && row) {
          await db.transaction(async (tx) => {
            // As the normal store: a database that stopped answering fails the load (retried).
            await tx.execute(sql.raw(`set local statement_timeout = ${STORE_TIMEOUT_MS}`));
            const [now] = await tx
              .select({ state: boardDoc.state })
              .from(boardDoc)
              .where(eq(boardDoc.boardId, boardId))
              .for('update');
            // A write that landed during the load goes into the document too, not only into the
            // row: the next store writes the document, and would otherwise lose it. Its lists are
            // prepared too.
            if (now) {
              Y.applyUpdate(document, now.state);
              preparePlanLists(document);
            }
            const state = Y.encodeStateAsUpdate(document);
            sizes.measured(document, state.byteLength);
            if (limits?.freeze) grown.set(document, { bytes: state.byteLength, exact: true });
            // Over the byte cap, as the normal store: read-only and not stored (decision 0084).
            if (limits?.freeze && state.byteLength > limits.stateBytes) {
              freeze(document, boardId);
              return false;
            }
            return storeIfBoardExists(tx, boardId, state, getSchemaVersion(document));
          });
          log.info({ boardId, lists }, 'set plan lists prepared and stored');
        }
        // And while it stays open (an older client's paste or edit): prepared right after. The
        // watch goes with the document when it unloads.
        preparePlanListsOnChange(document);
        const track = trackAssignments(document);
        assignedNow.set(document, track);
        assignments.set(document, track());
        guestHiding.set(document, trackGuestHiding(document));
        openedAt.set(document, Date.now());
        return document;
      } catch (err) {
        reportBoard('board_load_failed', boardId, err);
        throw err;
      }
    },

    async beforeSync({ connection, document, context, type, payload }) {
      if (type !== 1 && type !== 2) return;
      // A message still queued when its connection was closed (access removed) writes nothing.
      if (!document.hasConnection(connection)) {
        connection.readOnly = true;
        return;
      }
      // A refused update only makes this message read-only. Re-evaluate on the next one,
      // so deletions can still be applied without changing the person's editing role.
      if (!limits?.freeze)
        connection.readOnly =
          !context.canEdit || context.supportedSchemaVersion < requiredSchema(context, document);
      // A shape no Yjs client writes, which would wedge the board (decision 0139): refused before
      // anything else reads it.
      if (!connection.readOnly) {
        const malformed = malformedUpdate(document, payload);
        if (malformed) throw new Error(`Malformed update: ${malformed}`);
      }
      if (
        !connection.readOnly &&
        limits &&
        !limits.freeze &&
        !admitBoardUpdate(document, payload, limits, grown)
      ) {
        connection.readOnly = true;
        connection.sendStateless(
          JSON.stringify({ type: 'writeRefused', reason: 'frozen' } satisfies WriteRefusedMessage),
        );
        return;
      }
      // Hocuspocus answers a read-only connection without applying what it sent. When it sent
      // changes, say why, so a client can tell "update the app" from the rest (decision 0102).
      if (connection.readOnly) {
        const why = refusal(context, document);
        const key = JSON.stringify(why);
        if (refusalsSent.get(connection) === key) return;
        // A sync step carries what the client has: only items the document lacks are edits.
        if (type === 1 && !addsItems(document, payload)) return;
        refusalsSent.set(connection, key);
        connection.sendStateless(
          JSON.stringify({ type: 'writeRefused', ...why } satisfies WriteRefusedMessage),
        );
        return;
      }
      await validateTaskUpdate(db, context.boardId, context.actor?.id, document, payload);
      // Hocuspocus applies the update once this returns: anything may have changed during the
      // await (the role, a freeze, the connection closed, the board unloaded). The role check and
      // a freeze make the connection read-only; a closed connection (which Hocuspocus takes off
      // the board, leaving a shared socket open) or an unloaded board must too.
      if (
        !stillWritable({
          readOnly: connection.readOnly,
          connected: document.hasConnection(connection),
          socketState: connection.webSocket.readyState,
          documentDestroyed: document.isDestroyed,
        })
      ) {
        connection.readOnly = true;
        return;
      }
      // Decision 0120: the ids this socket delivers new items under, read from what it sent.
      // onChange sees the whole transaction, which can also integrate items another socket sent
      // earlier that were waiting for theirs: those must not go on this account.
      if (context.actor)
        for (const [client, clock] of newItems(document, payload))
          noteWriter(writersOf(document), client, context.actor.id, clock);
    },

    async onChange(payload) {
      const { connection: from, document, context, update } = payload;
      // The server's own writes (restores, clips, migrations) go under the document's id.
      if (!from) {
        let to: number | undefined;
        try {
          to = Y.parseUpdateMeta(update).to.get(document.clientID);
        } catch {}
        if (to !== undefined) noteWriter(writersOf(document), document.clientID, null, to - 1);
        // Admission counted what clients sent; the server's own writes count here. Restoring
        // an older version may take a board past the caps: it stays usable (decision 0130).
        if (limits && !limits.freeze) grow(grown, document, update.byteLength);
      }
      // Checked on every change a client makes, so a board never grows far past the caps in
      // memory before the next store; the store measures it again.
      if (limits?.freeze && from && !frozen.has(document)) {
        let bytes = (grown.get(document)?.bytes ?? 0) + update.byteLength;
        const exact = bytes > limits.stateBytes;
        if (exact) bytes = Y.encodeStateAsUpdate(document).byteLength;
        grown.set(document, { bytes, exact });
        if (bytes > limits.stateBytes || document.getMap('elements').size > limits.elements)
          freeze(document, context?.boardId);
      }
      if (guestHiding.get(document)?.()) {
        hidingCount.set(document, (hidingCount.get(document) ?? 0) + 1);
        storeSoon({
          document,
          documentName: payload.documentName,
          instance: payload.instance,
          clientsCount: payload.clientsCount,
          lastContext: context,
          lastTransactionOrigin: payload.transactionOrigin,
        });
      }
      for (const connection of document.getConnections() as Array<Connection<Context>>) {
        if (
          (connection.context
            ? connection.context.supportedSchemaVersion <
              requiredSchema(connection.context, document)
            : true) &&
          !connection.readOnly
        ) {
          connection.readOnly = true;
          // The live schema update drives the update-app notice; this is not a role change.
        }
      }
      const before = assignments.get(document) ?? new Map();
      const after = assignedNow.get(document)?.() ?? assignedItems(document);
      const pending = pendingAssignments.get(document) ?? new Map();
      for (const [key, item] of after) {
        if (before.get(key)?.assigneeId !== item.assigneeId && context?.actor?.id)
          pending.set(key, { ...item, actorId: context.actor.id });
      }
      assignments.set(document, after);
      pendingAssignments.set(document, pending);
      // Only what a client sent: the server's own writes are trusted, its corrections included.
      if (!from || !context?.boardId) return;
      try {
        await dropRemovedAssignees(db, context.boardId, document, before, after);
      } catch (err) {
        log.error({ err, boardId: context.boardId }, 'assignee check failed');
      }
    },

    async onStoreDocument(payload) {
      const { document, documentName } = payload;
      const boardId = parseBoardDocName(documentName);
      if (!boardId) return;
      let wrote = false;
      storing.add(document);
      try {
        return await (async () => {
          // A sample: the first store of an open board, and again after its schema changes, as
          // validating every card on each store walks the whole board. An element that becomes
          // invalid later is logged when the board is next opened.
          const version = getSchemaVersion(document);
          if (validatedAt.get(document) !== version) {
            validatedAt.set(document, version);
            const issues = validateBoardDoc(document);
            if (issues.length > 0)
              log.warn({ boardId, issues: issues.slice(0, 10) }, 'invalid elements');
          }
          if (frozen.has(document)) return stored(document);
          if (superseded) return keepSuperseded(boardId, document, payload);
          const pending = new Map(pendingAssignments.get(document));
          const hiding = hidingCount.get(document);
          const state = Y.encodeStateAsUpdate(document);
          sizes.measured(document, state.byteLength);
          if (limits?.freeze && state.byteLength > limits.stateBytes) {
            freeze(document, boardId);
            return stored(document);
          }
          const schemaVersion = document.getMap('meta').get('schemaVersion') as number;
          const elementCount = document.getMap('elements').size;
          try {
            const asked = performance.now();
            let began = 0;
            const write = db.transaction(async (tx) => {
              began = performance.now();
              // A database that stopped answering fails the store (retried) instead of holding it.
              await tx.execute(sql.raw(`set local statement_timeout = ${STORE_TIMEOUT_MS}`));
              await fenceCollabWrite(tx, deps.fence?.epoch);
              return storeIfBoardExists(tx, boardId, state, schemaVersion);
            });
            const written = await (closing ? within(write, SHUTDOWN_STORE_MS) : write);
            storeTimes.record(began - asked, performance.now() - asked);
            if (!written) {
              log.info({ boardId }, 'board deleted while open: document not stored');
              return stored(document);
            }
          } catch (err) {
            if (err instanceof StaleCollabEpochError) {
              supersede(err);
              return keepSuperseded(boardId, document, payload);
            }
            // Deleted between the check and the write: there is nothing to keep it for either.
            // Returning lets Hocuspocus unload the document.
            if (boardGone(err)) {
              log.info({ boardId }, 'board deleted while open: document not stored');
              return stored(document);
            }
            // The structured line and the Server page problem.
            reportBoard('board_save_failed', boardId, err);
            if (closing) {
              stored(document);
              log.error({ err, boardId }, 'board not stored at shutdown');
              // Returning lets the shutdown finish instead of waiting for a store that cannot happen.
              return spill(boardId, document);
            }
            const retryInMs = retryStore(payload);
            log.error({ err, boardId, retryInMs }, 'board not stored: retrying');
            throw err;
          }
          stored(document);
          storedHiding.set(document, hiding ?? 0);
          wrote = true;
          // Best effort (decision 0120): a failure loses who wrote, never the document.
          const written = writers.get(document);
          writers.delete(document);
          if (written)
            try {
              await storeWriters(db, boardId, written, deps.now?.() ?? new Date());
            } catch (err) {
              log.error({ err, boardId }, 'board writers not recorded');
            }
          for (const [key, value] of pending) {
            if (pendingAssignments.get(document)?.get(key) === value)
              pendingAssignments.get(document)?.delete(key);
          }
          for (const [key, item] of pending ?? []) {
            if (assignedItems(document).get(key)?.assigneeId !== item.assigneeId) continue;
            try {
              await notifyAssignment(db, boardId, item.elementId, item.assigneeId, item.actorId);
            } catch (err) {
              log.error({ err, boardId }, 'task notification failed');
            }
          }
          // The document is safe at this point. If indexing fails, the backfill job retries it
          // (indexed_at stays older than updated_at).
          try {
            await db.transaction(async (tx) => {
              await fenceCollabWrite(tx, deps.fence?.epoch);
              await writeBoardIndex(tx, boardId, document);
              await tx
                .update(board)
                .set({ docSchemaVersion: schemaVersion, updatedAt: sql`${board.updatedAt}` })
                .where(eq(board.id, boardId));
            });
          } catch (err) {
            if (err instanceof StaleCollabEpochError) {
              supersede(err);
              return;
            }
            log.error({ err, boardId }, 'board search index not updated');
          }
          // Decision 0013: an automatic version when the last one is more than an hour old.
          try {
            const now = deps.now?.() ?? new Date();
            const last = lastAutoAt.get(boardId);
            const elapsed = last === undefined ? Infinity : now.getTime() - last;
            // Recheck the database if the clock moves backwards.
            if (elapsed < 0 || elapsed >= AUTO_VERSION_EVERY_MS) {
              const snap = { state, schemaVersion, elementCount };
              const takenAt = await takeAutoVersion(db, boardId, snap, now);
              lastAutoAt.set(boardId, takenAt.getTime());
            }
          } catch (err) {
            log.error({ err, boardId }, 'automatic board version not saved');
          }
        })();
      } finally {
        storing.delete(document);
        // A card hidden after this store read the board: its early store, which waited for this
        // one, is due now. Never after a failure (its retry stores the board) or a store that
        // could not happen (deleted, frozen, shutdown).
        if (wrote && (hidingCount.get(document) ?? 0) > (storedHiding.get(document) ?? 0))
          storeSoon(payload);
      }
    },
  });

  // A store leaves a setTimeout(0) holding its document, and Hocuspocus unloads by name. If that
  // copy is gone and the board was opened again, the timer removes the new copy from the map: what
  // is written to it (a restore) never reaches whoever opens the board next. Only the copy in the
  // map may unload.
  // shortcut: replaces a Hocuspocus method, drop it once upstream compares the document.
  const { hocuspocus } = server;
  const destroy = server.destroy.bind(server);
  /** One last store for each board still not stored, then spill what fails, then close. */
  server.destroy = async () => {
    closing = true;
    // Hocuspocus runs onDestroy only once every board unloaded: a hung store never gets there.
    clearInterval(timer);
    clearInterval(keepalive);
    for (const cancel of hidingStores.values()) cancel();
    hidingStores.clear();
    clearInterval(drainTimer);
    // A merge in flight finishes first: its board is then stored (or kept on disk) below.
    if (drainRun) await within(drainRun, SHUTDOWN_STORE_MS).catch(() => undefined);
    for (const [document, { timer, payload }] of unsaved) {
      clearTimeout(timer);
      if (hocuspocus.documents.get(payload.documentName) === document)
        void hocuspocus.storeDocumentHooks(payload.document, payload, true);
      else stored(document);
    }
    // A store stuck on a database that stopped answering holds its board's save lock, so the
    // shutdown would wait for SIGKILL: past the grace time every board still open goes to disk
    // (a board stored meanwhile is merged twice at the next start, which changes nothing).
    const closed = destroy();
    try {
      await within(closed, SHUTDOWN_STORE_MS + 1000);
    } catch {
      await Promise.all(
        [...hocuspocus.documents].map(([name, document]) => {
          const boardId = parseBoardDocName(name);
          return boardId ? spill(boardId, document) : undefined;
        }),
      );
    }
  };
  const shouldUnload = hocuspocus.shouldUnloadDocument.bind(hocuspocus);
  hocuspocus.shouldUnloadDocument = (document) =>
    hocuspocus.documents.get(document.name) === document && shouldUnload(document);

  /** The signed-in people on a document and its board; null when nobody signed in is on it. */
  function whoIsOn(document: Document) {
    const users = new Set<string>();
    let boardId: string | null = null;
    for (const connection of document.getConnections() as Array<Connection<Context>>) {
      const ctx = connection.context;
      if (!ctx?.user) continue;
      users.add(ctx.user.id);
      boardId = ctx.boardId;
    }
    return boardId && users.size ? { boardId, users } : null;
  }

  /** Who is on which board now: ids only, the web role names them for whoever may see them. */
  function presence(): PresenceBoard[] {
    const out: PresenceBoard[] = [];
    for (const document of server.hocuspocus.documents.values()) {
      const on = whoIsOn(document);
      if (on)
        out.push({
          boardId: on.boardId,
          since: openedAt.get(document) ?? Date.now(),
          users: [...on.users],
        });
    }
    return out;
  }

  /** Encoded size of the boards `presence` lists (#911). */
  const boardBytes = () =>
    sizes.total([...server.hocuspocus.documents.values()].filter((d) => whoIsOn(d)));

  return Object.assign(server, {
    recheck: rechecks.fresh,
    presence,
    boardBytes,
    hasRoom,
    stores: storeTimes,
    fenceWrite,
    isSuperseded: () => superseded,
  });
}

export type CollabServer = ReturnType<typeof createCollabServer>;

/** All-in-one mode: serve the collab WebSocket on the web port under /collab. */
export function attachCollab(http: HttpServer, collab: CollabServer) {
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith(COLLAB_PATH)) collab.httpServer.emit('upgrade', req, socket, head);
    else socket.destroy();
  });
}
