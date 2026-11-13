import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type Connection, type Document, Server } from '@hocuspocus/server';
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  LocalPresence,
  MIN_WRITER_SCHEMA,
  migrateBoardDoc,
  type PresenceState,
  type PresenceUser,
  parseBoardDocName,
  validateBoardDoc,
} from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { type Actor, atLeast, boardRole } from './access.ts';
import { adminEnrollmentRequired } from './admin-two-factor.ts';
import type { Auth } from './auth.ts';
import { noteWriter, type PendingWriters, storeWriters } from './board-writers.ts';
import type { Database } from './db/client.ts';
import { board, boardDoc, personalToken, session, user } from './db/schema.ts';
import { prepareImageDrawings } from './image-drawing.ts';
import { boardProblem, recordProblem } from './monitor/problems.ts';
import type { MonitorStore, PresenceBoard } from './monitor/store.ts';
import { allowedOrigin, ORIGIN_HEADER, rawOrigin } from './request-origin.ts';
import { writeBoardIndex } from './search/index-doc.ts';
import {
  assignedItems,
  dropRemovedAssignees,
  notifyAssignment,
  validateTaskUpdate,
} from './tasks.ts';
import { actorFromToken, isToken } from './tokens.ts';
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
    const pending = document.store.pendingStructs;
    // Yjs keeps them in its second update format.
    if (pending) waiting = Y.parseUpdateMetaV2(pending.update);
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

/** How often open connections are checked against the current roles (decision 0011). */
export const ACCESS_RECHECK_MS = 30_000;

export interface CollabLimits {
  /** Largest WebSocket message. */
  maxPayload: number;
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
  maxPayload: 1024 * 1024,
  elements: 500,
  stateBytes: 2 * 1024 * 1024,
};

/** A board document written for a board row that no longer exists. */
function boardGone(err: unknown): boolean {
  for (let e = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, constraint_name } = e as { code?: string; constraint_name?: string };
    if (code === '23503' && constraint_name === 'board_doc_board_id_board_id_fk') return true;
  }
  return false;
}

export function createCollabServer(deps: {
  db: Database;
  auth: Auth;
  log: Logger;
  publicUrl: string;
  trustProxy?: boolean | string;
  recheckMs?: number;
  /** Clock for automatic versions; tests move it forward. */
  now?: () => Date;
  /** The demo's caps (DEMO_COLLAB_LIMITS); none elsewhere, where boards can grow large. */
  limits?: CollabLimits;
  /** Oldest client schema that may write (decision 0102); tests lower it. */
  minWriterSchema?: number;
  /** Where a board that cannot be saved or opened goes for the Server page (#514). */
  monitor?: { store: MonitorStore; role: 'collab' | 'all' };
}) {
  const { db, auth, log, limits } = deps;
  const minWriterSchema = deps.minWriterSchema ?? MIN_WRITER_SCHEMA;
  const reportBoard = (
    kind: 'board_save_failed' | 'board_load_failed',
    boardId: string,
    err: unknown,
  ) => {
    log.error({ err, boardId }, kind === 'board_save_failed' ? 'board not stored' : 'board not loaded');
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
   * Bytes of a capped board: stored state plus what clients sent since, measured for real
   * only past the cap, as encoding a whole board on every keystroke would cost too much.
   */
  const grown = new WeakMap<Y.Doc, number>();
  const freeze = (document: Document, boardId: string | undefined) => {
    if (!frozen.has(document)) log.warn({ boardId }, 'board over the demo caps: read-only');
    frozen.add(document);
    for (const connection of document.getConnections() as Array<Connection<Context>>) {
      if (connection.readOnly) continue;
      connection.readOnly = true;
      connection.sendStateless(
        JSON.stringify({ type: 'access', readOnly: true } satisfies AccessMessage),
      );
    }
  };
  /** Yjs client ids each socket has published presence for, per document. */
  const owners = new Map<string, string>();
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
      return actor && !(await adminEnrollmentRequired(db, actor))
        ? { actor, sessionId: null }
        : null;
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

  /**
   * Closes connections whose token or session ended (4401) or that lost their role (4403), and
   * updates read-only on the others.
   */
  async function recheck(server: Server<Context>) {
    const now = new Date();
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections() as Array<Connection<Context>>) {
        const ctx = connection.context;
        if (!ctx?.actor) continue;
        try {
          const [owner] = await db.select().from(user).where(eq(user.id, ctx.actor.id));
          if (owner) ctx.actor.role = owner.role;
          if (
            !owner ||
            owner.deactivatedAt ||
            (await adminEnrollmentRequired(db, owner)) ||
            !(await stillSignedIn(ctx, now))
          ) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: signed out');
            connection.close({ code: 4401, reason: 'Unauthorized' });
            continue;
          }
          const access = await boardRole(db, ctx.actor, ctx.boardId);
          if (!access?.role) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: access removed');
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

  const server: Server<Context> = new Server<Context>({
    name: 'inkadra-collab',
    quiet: true,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: limits?.maxPayload ?? 16 * 1024 * 1024 },

    async onConfigure() {
      timer = setInterval(() => void recheck(server), deps.recheckMs ?? ACCESS_RECHECK_MS);
      timer.unref();
    },

    async onDestroy() {
      if (timer) clearInterval(timer);
    },

    async onUpgrade({ request, socket }) {
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
      const signed = await signedIn(token, requestHeaders);
      if (!signed) throw new Error('Not signed in');
      const { actor } = signed;
      const access = await boardRole(db, actor, boardId);
      if (!access?.role) throw new Error('Not allowed');
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
    async beforeHandleAwareness({ states, removedClients, connection, documentName }) {
      if (!connection) return;
      const ctx = connection.context;
      for (const [clientId, state] of states) {
        const key = ownerKey(documentName, clientId);
        const owner = owners.get(key);
        const local = LocalPresence.safeParse(state);
        if ((owner && owner !== connection.socketId) || !ctx?.user || !local.success) {
          states.delete(clientId);
          continue;
        }
        owners.set(key, connection.socketId);
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
        if (owners.get(ownerKey(documentName, clientId)) !== connection.socketId)
          removedClients.delete(clientId);
      }
    },

    async onDisconnect({ socketId, documentName }) {
      for (const [key, owner] of owners)
        if (owner === socketId && key.startsWith(`${documentName}#`)) owners.delete(key);
    },

    async onLoadDocument({ document, documentName }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) throw new Error('Unknown document');
      try {
        const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
        if (row) Y.applyUpdate(document, row.state);
        if (limits) grown.set(document, row?.state.byteLength ?? 0);
        const steps = migrateBoardDoc(document, boardId);
        if (steps.length > 0) log.info({ boardId, steps }, 'board document migrated');
        prepareImageDrawings(document);
        assignments.set(document, assignedItems(document));
        openedAt.set(document, Date.now());
        return document;
      } catch (err) {
        reportBoard('board_load_failed', boardId, err);
        throw err;
      }
    },

    async beforeSync({ connection, document, context, type, payload }) {
      if (type !== 1 && type !== 2) return;
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
      // Decision 0120: the ids this socket delivers new items under, read from what it sent.
      // onChange sees the whole transaction, which can also integrate items another socket sent
      // earlier that were waiting for theirs: those must not go on this account.
      if (context.actor)
        for (const [client, clock] of newItems(document, payload))
          noteWriter(writersOf(document), client, context.actor.id, clock);
    },

    async onChange({ connection: from, document, context, update }) {
      // The server's own writes (restores, clips, migrations) go under the document's id.
      if (!from) {
        let to: number | undefined;
        try {
          to = Y.parseUpdateMeta(update).to.get(document.clientID);
        } catch {}
        if (to !== undefined) noteWriter(writersOf(document), document.clientID, null, to - 1);
      }
      // Checked on every change a client makes, so a board never grows far past the caps in
      // memory before the next store; the store measures it again.
      if (limits && from && !frozen.has(document)) {
        let bytes = (grown.get(document) ?? 0) + update.byteLength;
        if (bytes > limits.stateBytes) bytes = Y.encodeStateAsUpdate(document).byteLength;
        grown.set(document, bytes);
        if (bytes > limits.stateBytes || document.getMap('elements').size > limits.elements)
          freeze(document, context?.boardId);
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
      const after = assignedItems(document);
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

    async onStoreDocument({ document, documentName }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) return;
      const issues = validateBoardDoc(document);
      if (issues.length > 0) log.warn({ boardId, issues: issues.slice(0, 10) }, 'invalid elements');
      if (frozen.has(document)) return;
      const pending = new Map(pendingAssignments.get(document));
      const state = Y.encodeStateAsUpdate(document);
      if (limits && state.byteLength > limits.stateBytes) {
        freeze(document, boardId);
        return;
      }
      const schemaVersion = document.getMap('meta').get('schemaVersion') as number;
      const elementCount = document.getMap('elements').size;
      try {
        await db
          .insert(boardDoc)
          .values({ boardId, state, schemaVersion, size: state.byteLength })
          .onConflictDoUpdate({
            target: boardDoc.boardId,
            set: { state, schemaVersion, size: state.byteLength, updatedAt: new Date() },
          });
      } catch (err) {
        // The board was deleted for good (its project, or emptied from the trash) while open:
        // there is nothing to keep it for. Returning lets Hocuspocus unload the document.
        if (!boardGone(err)) {
          // Hocuspocus keeps the document in memory and prints the error to stderr; this is the
          // structured line and the Server page problem.
          reportBoard('board_save_failed', boardId, err);
          throw err;
        }
        log.info({ boardId }, 'board deleted while open: document not stored');
        return;
      }
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
          await writeBoardIndex(tx, boardId, document);
          await tx
            .update(board)
            .set({ docSchemaVersion: schemaVersion, updatedAt: sql`${board.updatedAt}` })
            .where(eq(board.id, boardId));
        });
      } catch (err) {
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
    },
  });

  // A store leaves a setTimeout(0) holding its document, and Hocuspocus unloads by name. If that
  // copy is gone and the board was opened again, the timer removes the new copy from the map: what
  // is written to it (a restore) never reaches whoever opens the board next. Only the copy in the
  // map may unload.
  // shortcut: replaces a Hocuspocus method, drop it once upstream compares the document.
  const { hocuspocus } = server;
  const shouldUnload = hocuspocus.shouldUnloadDocument.bind(hocuspocus);
  hocuspocus.shouldUnloadDocument = (document) =>
    hocuspocus.documents.get(document.name) === document && shouldUnload(document);

  /** Who is on which board now: ids only, the web role names them for whoever may see them. */
  function presence(): PresenceBoard[] {
    const out: PresenceBoard[] = [];
    for (const document of server.hocuspocus.documents.values()) {
      const users = new Set<string>();
      let boardId: string | null = null;
      for (const connection of document.getConnections() as Array<Connection<Context>>) {
        const ctx = connection.context;
        if (!ctx?.user) continue;
        users.add(ctx.user.id);
        boardId = ctx.boardId;
      }
      if (boardId && users.size)
        out.push({ boardId, since: openedAt.get(document) ?? Date.now(), users: [...users] });
    }
    return out;
  }

  return Object.assign(server, { recheck: () => recheck(server), presence });
}

export type CollabServer = ReturnType<typeof createCollabServer>;

/** All-in-one mode: serve the collab WebSocket on the web port under /collab. */
export function attachCollab(http: HttpServer, collab: CollabServer) {
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith(COLLAB_PATH)) collab.httpServer.emit('upgrade', req, socket, head);
    else socket.destroy();
  });
}
