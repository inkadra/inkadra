import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type Connection, Server } from '@hocuspocus/server';
import {
  LocalPresence,
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
import type { Auth } from './auth.ts';
import type { Database } from './db/client.ts';
import { board, boardDoc, personalToken, session, user } from './db/schema.ts';
import { writeBoardIndex } from './search/index-doc.ts';
import { actorFromToken, isToken } from './tokens.ts';

interface Context {
  actor: Actor;
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

/** How often open connections are checked against the current roles (decision 0011). */
export const ACCESS_RECHECK_MS = 30_000;

export function createCollabServer(deps: {
  db: Database;
  auth: Auth;
  log: Logger;
  publicUrl: string;
  recheckMs?: number;
}) {
  const { db, auth, log } = deps;
  const allowedOrigin = new URL(deps.publicUrl).origin;
  /** Yjs client ids each socket has published presence for, per document. */
  const owners = new Map<string, string>();
  const ownerKey = (documentName: string, clientId: number) => `${documentName}#${clientId}`;

  async function signedIn(
    token: string,
    headers: Headers,
  ): Promise<{ actor: Actor; sessionId: string | null } | null> {
    // Native apps and the clipper send their token; browsers send the session cookie.
    if (isToken(token)) {
      const actor = await actorFromToken(db, token);
      return actor && { actor, sessionId: null };
    }
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    return {
      actor: {
        id: session.user.id,
        role: (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member',
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
          if (!(await stillSignedIn(ctx, now))) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: signed out');
            connection.close({ code: 4401, reason: 'Unauthorized' });
            continue;
          }
          const access = await boardRole(db, ctx.actor, ctx.boardId);
          if (!access?.role) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: access removed');
            connection.close({ code: 4403, reason: 'Forbidden' });
          } else {
            const readOnly = !atLeast(access.role, 'editor');
            if (readOnly !== connection.readOnly) {
              connection.readOnly = readOnly;
              // Tell the client, so the editor follows instead of dropping what someone types.
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

  let timer: NodeJS.Timeout | undefined;

  const server: Server<Context> = new Server<Context>({
    name: 'inkadra-collab',
    quiet: true,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: 16 * 1024 * 1024 },

    async onConfigure() {
      timer = setInterval(() => void recheck(server), deps.recheckMs ?? ACCESS_RECHECK_MS);
      timer.unref();
    },

    async onDestroy() {
      if (timer) clearInterval(timer);
    },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) throw new Error('Unknown document');
      // Browsers always send Origin on WebSocket upgrades; native apps send none.
      const origin = requestHeaders.get('origin');
      if (origin && origin !== allowedOrigin) throw new Error('Origin not allowed');
      const signed = await signedIn(token, requestHeaders);
      if (!signed) throw new Error('Not signed in');
      const { actor } = signed;
      const access = await boardRole(db, actor, boardId);
      if (!access?.role) throw new Error('Not allowed');
      const [me] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, actor.id));
      connectionConfig.readOnly = !atLeast(access.role, 'editor');
      return {
        actor,
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
      const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
      if (row) Y.applyUpdate(document, row.state);
      const steps = migrateBoardDoc(document, boardId);
      if (steps.length > 0) log.info({ boardId, steps }, 'board document migrated');
      return document;
    },

    async onStoreDocument({ document, documentName }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) return;
      const issues = validateBoardDoc(document);
      if (issues.length > 0) log.warn({ boardId, issues: issues.slice(0, 10) }, 'invalid elements');
      const state = Y.encodeStateAsUpdate(document);
      const schemaVersion = document.getMap('meta').get('schemaVersion') as number;
      await db
        .insert(boardDoc)
        .values({ boardId, state, schemaVersion, size: state.byteLength })
        .onConflictDoUpdate({
          target: boardDoc.boardId,
          set: { state, schemaVersion, size: state.byteLength, updatedAt: new Date() },
        });
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
    },
  });

  return Object.assign(server, { recheck: () => recheck(server) });
}

export type CollabServer = ReturnType<typeof createCollabServer>;

/** All-in-one mode: serve the collab WebSocket on the web port under /collab. */
export function attachCollab(http: HttpServer, collab: CollabServer) {
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith(COLLAB_PATH)) collab.httpServer.emit('upgrade', req, socket, head);
    else socket.destroy();
  });
}
