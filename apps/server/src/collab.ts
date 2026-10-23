import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Server } from '@hocuspocus/server';
import { migrateBoardDoc, parseBoardDocName, validateBoardDoc } from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { type Actor, atLeast, boardRole } from './access.ts';
import type { Auth } from './auth.ts';
import type { Database } from './db/client.ts';
import { boardDoc } from './db/schema.ts';

interface Context {
  actor: Actor;
  boardId: string;
}

export function createCollabServer(deps: {
  db: Database;
  auth: Auth;
  log: Logger;
  publicUrl: string;
}) {
  const { db, auth, log } = deps;
  const allowedOrigin = new URL(deps.publicUrl).origin;

  return new Server<Context>({
    name: 'inkadra-collab',
    quiet: true,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: 16 * 1024 * 1024 },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const boardId = parseBoardDocName(documentName);
      if (!boardId) throw new Error('Unknown document');
      // Browsers always send Origin on WebSocket upgrades; native apps send none.
      const origin = requestHeaders.get('origin');
      if (origin && origin !== allowedOrigin) throw new Error('Origin not allowed');
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new Error('Not signed in');
      const actor: Actor = {
        id: session.user.id,
        role: (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member',
      };
      const access = await boardRole(db, actor, boardId);
      if (!access?.role) throw new Error('Not allowed');
      connectionConfig.readOnly = !atLeast(access.role, 'editor');
      return { actor, boardId } satisfies Context;
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
}

export type CollabServer = ReturnType<typeof createCollabServer>;

/** All-in-one mode: serve the collab WebSocket on the web port under /collab. */
export function attachCollab(http: HttpServer, collab: CollabServer) {
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith(COLLAB_PATH)) collab.httpServer.emit('upgrade', req, socket, head);
    else socket.destroy();
  });
}
