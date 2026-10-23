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
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { type Actor, atLeast, boardRole } from './access.ts';
import type { Auth } from './auth.ts';
import type { Database } from './db/client.ts';
import { boardDoc, user } from './db/schema.ts';
import { actorFromToken, isToken } from './tokens.ts';

interface Context {
  actor: Actor;
  boardId: string;
  user: PresenceUser;
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

  async function signedIn(token: string, headers: Headers): Promise<Actor | null> {
    // Native apps and the clipper send their token; browsers send the session cookie.
    if (isToken(token)) return actorFromToken(db, token);
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    return {
      id: session.user.id,
      role: (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member',
    };
  }

  /** Closes connections that lost their role and updates read-only on the others. */
  async function recheck(server: Server<Context>) {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections() as Array<Connection<Context>>) {
        const ctx = connection.context;
        if (!ctx?.actor) continue;
        try {
          const access = await boardRole(db, ctx.actor, ctx.boardId);
          if (!access?.role) {
            log.info({ boardId: ctx.boardId }, 'collab connection closed: access removed');
            connection.close({ code: 4403, reason: 'Forbidden' });
          } else {
            connection.readOnly = !atLeast(access.role, 'editor');
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
      const actor = await signedIn(token, requestHeaders);
      if (!actor) throw new Error('Not signed in');
      const access = await boardRole(db, actor, boardId);
      if (!access?.role) throw new Error('Not allowed');
      const [me] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, actor.id));
      connectionConfig.readOnly = !atLeast(access.role, 'editor');
      return {
        actor,
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
