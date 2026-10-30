import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  newElementId,
  roots,
  validateBoardDoc,
} from '@inkadra/doc-schema';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { attachCollab, createCollabServer } from './collab.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { boardDoc } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { createRedis } from './queues.ts';
import { testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const duration = Number(process.env.COLLAB_SIM_DURATION_MS ?? 30_000);
if (!Number.isFinite(duration) || duration < 1000)
  throw new Error('Invalid COLLAB_SIM_DURATION_MS');
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A dedicated file keeps the soak selectable without running unrelated integration tests.
describe.skipIf(!url || !process.env.REDIS_URL)('Gate 0.3 collaboration simulation', () => {
  it(
    'preserves ten editors through network partitions, persistence and restart',
    async () => {
      const seed = Number(process.env.COLLAB_SIM_SEED ?? 305);
      let randomState = seed >>> 0;
      const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 2 ** 32;
      };
      const config = loadConfig({
        NODE_ENV: 'test',
        AUTH_RATE_LIMITS: 'off',
        PUBLIC_URL: 'http://localhost:3000',
        DATABASE_URL: url!,
        AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
        REGISTRATION: 'open',
      });
      const errors: string[] = [];
      const consoleErrors = vi.spyOn(console, 'error');
      const log = pino(
        { level: 'error' },
        {
          write(line: string) {
            errors.push(line);
          },
        },
      );
      const { db, sql: database } = createDatabase(config.DATABASE_URL, 4);
      const redis = createRedis(process.env.REDIS_URL!);
      const auth = createAuth(config, db);
      let app: Awaited<ReturnType<typeof createApp>> | undefined;
      let collab: ReturnType<typeof createCollabServer> | undefined;
      let base = '';
      let boardId = '';
      const sockets: Array<{ close(): void }> = [];
      const docs: Y.Doc[] = [];
      const deps = testDeps(db, log);
      const boot = async () => {
        collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
        app = await createApp({ config, db, auth, log, ...deps });
        attachCollab(app.server, collab);
        await app.listen({ host: '127.0.0.1', port: 0 });
        base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      };
      function connect(cookie: string) {
        let transport: WebSocket | undefined;
        class CookieSocket extends WebSocket {
          constructor(address: string, protocols?: string | string[]) {
            super(address, protocols, { headers: { cookie }, origin: config.PUBLIC_URL });
            transport = this;
          }
        }
        const doc = new Y.Doc();
        docs.push(doc);
        const ws = new HocuspocusProviderWebsocket({
          url: `ws://${base}/collab`,
          WebSocketPolyfill: CookieSocket,
        });
        const provider = new HocuspocusProvider({
          websocketProvider: ws,
          name: boardDocName(boardId),
          document: doc,
        });
        const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
        provider.attach();
        const connection = {
          doc,
          ws,
          provider,
          synced,
          drop() {
            transport?.terminate();
          },
          close() {
            provider.destroy();
            ws.destroy();
          },
        };
        sockets.push(connection);
        return connection;
      }
      // A fresh decode compacts GC struct boundaries left by offline delete delivery.
      // Equal logical Yjs histories can otherwise have different raw update lengths.
      const signature = (doc: Y.Doc) => {
        const canonical = new Y.Doc();
        Y.applyUpdate(canonical, Y.encodeStateAsUpdate(doc));
        const bytes = Buffer.from(Y.encodeStateAsUpdate(canonical)).toString('base64');
        canonical.destroy();
        return bytes;
      };
      try {
        expect(await redis.ping()).toBe('PONG');
        await runMigrations(config.DATABASE_URL, migrationsFolder);
        await db.execute(sql`truncate table "user", project, instance_setting cascade`);
        await boot();
        const people: Array<{ cookie: string; id: string }> = [];
        for (let i = 0; i < 12; i++) {
          const res = await app!.inject({
            method: 'POST',
            url: '/api/auth/sign-up/email',
            headers: { origin: config.PUBLIC_URL },
            payload: {
              email: `sim-${i}@example.com`,
              password: 'correct-horse-battery',
              name: `sim-${i}`,
            },
          });
          expect(res.statusCode, res.body).toBe(200);
          people.push({
            cookie: String(res.headers['set-cookie']).split(';')[0]!,
            id: res.json().user.id,
          });
        }
        const headers = { cookie: people[0]!.cookie, origin: config.PUBLIC_URL };
        const project = await app!.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers,
          payload: { name: 'Gate 0.3' },
        });
        expect(project.statusCode, project.body).toBe(201);
        boardId = project.json().rootBoardId;
        for (let i = 1; i < 12; i++) {
          const res = await app!.inject({
            method: 'PUT',
            url: `/api/v1/projects/${project.json().id}/members/${people[i]!.id}`,
            headers,
            payload: { role: i === 11 ? 'viewer' : 'editor' },
          });
          expect(res.statusCode, res.body).toBe(200);
        }
        const clients = people.slice(1, 11).map((p) => connect(p.cookie));
        await Promise.all(clients.map((c) => c.synced));
        const shared = newElementId();
        const baseElement = (id: string) => ({
          id,
          x: 0,
          y: 0,
          w: 280,
          z: 'a0',
          parent: null,
          createdBy: null,
          createdAt: 0,
        });
        addElement(clients[0]!.doc, { ...baseElement(shared), type: 'note' });
        await expect
          .poll(() => clients.every((c) => roots(c.doc).elements.has(shared)), { timeout: 5000 })
          .toBe(true);
        // Independent transport oracle: merge only locally intended transactions, never incoming updates.
        const oracle = new Y.Doc();
        docs.push(oracle);
        Y.applyUpdate(oracle, Y.encodeStateAsUpdate(clients[0]!.doc));
        for (const c of clients)
          c.doc.on('update', (update: Uint8Array, origin: unknown) => {
            if (origin === 'simulation') Y.applyUpdate(oracle, update);
          });
        const intents: Array<{ id: string; kind: number; element: string; value: number }> = [];
        const latest = new Map<string, Map<string, unknown>>();
        const deleted = new Set<string>();
        const tokens: string[] = [];
        const owned = clients.map(() => [] as string[]);
        let maxLagMs = 0;
        const pending: Array<{ client: number; clock: number; at: number }> = [];
        let peakRss = process.memoryUsage().rss;
        const start = Date.now();
        const ticks = Math.ceil(duration / 500);
        for (let tick = 0; tick < ticks; tick++) {
          const sentAt = Date.now();
          for (let i = 0; i < clients.length; i++) {
            const c = clients[i]!;
            // Client zero stays offline for a quarter of the run, continuing to edit.
            if (i === 0 && tick === Math.floor(ticks / 4)) c.ws.disconnect();
            if (i === 0 && tick === Math.floor(ticks / 2)) void c.ws.connect();
            if (i > 0 && random() < 0.015) c.drop();
            else if (i > 0) void c.ws.connect();
            const kind = tick < 8 ? tick : Math.floor(random() * 8);
            const id = `sim_op_${i}_${tick}`;
            const list = owned[i]!;
            let target = list[Math.floor(random() * list.length)];
            const value = Math.floor(random() * 10000);
            c.doc.transact(() => {
              const elements = roots(c.doc).elements;
              if (kind === 0 || kind === 1 || !target) {
                target = id;
                addElement(c.doc, { ...baseElement(id), type: kind === 1 ? 'frame' : 'note' });
                list.push(id);
                latest.set(id, new Map());
              } else if (kind === 6) {
                elements.delete(target);
                deleted.add(target);
                list.splice(list.indexOf(target), 1);
              } else if (kind === 7 || kind === 4) {
                // Concurrent rich-text insertions must ALL survive, unlike LWW scalar conflicts.
                const body = elements.get(shared)!.get('body') as Y.XmlFragment;
                const paragraph = new Y.XmlElement('paragraph');
                const text = new Y.XmlText();
                text.insert(0, `[${id}]`);
                paragraph.insert(0, [text]);
                body.insert(0, [paragraph]);
                tokens.push(`[${id}]`);
                elements.get(shared)!.set('x', value);
              } else {
                const element = elements.get(target)!;
                const field =
                  kind === 2
                    ? 'x'
                    : kind === 3
                      ? 'w'
                      : element.get('type') === 'frame'
                        ? 'action'
                        : 'y';
                const next = field === 'action' ? id : value + 1;
                element.set(field, next);
                latest.get(target)!.set(field, next);
              }
            }, 'simulation');
            intents.push({ id, kind, element: target!, value });
            pending.push({
              client: c.doc.clientID,
              clock: Y.decodeStateVector(Y.encodeStateVector(c.doc)).get(c.doc.clientID)!,
              at: sentAt,
            });
          }
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          if (tick > 0 && tick % 120 === 0)
            console.log(
              JSON.stringify({
                elapsedMs: Date.now() - start,
                operations: intents.length,
                maxLagMs,
              }),
            );
          // Bound offered load; run time does not depend on network delivery.
          await pause(Math.max(0, start + (tick + 1) * 500 - Date.now()));
          const received = Y.decodeStateVector(Y.encodeStateVector(clients[1]!.doc));
          for (let j = pending.length - 1; j >= 0; j--) {
            const op = pending[j]!;
            if ((received.get(op.client) ?? 0) >= op.clock) {
              maxLagMs = Math.max(maxLagMs, Date.now() - op.at);
              pending.splice(j, 1);
            }
          }
        }
        const reconnectAt = Date.now();
        for (const c of clients) void c.ws.connect();
        await expect
          .poll(() => clients.every((c) => signature(c.doc) === signature(clients[0]!.doc)), {
            timeout: 20_000,
          })
          .toBe(true);
        const recoveryMs = Date.now() - reconnectAt;
        expect(recoveryMs).toBeLessThan(20_000);
        for (const op of pending) maxLagMs = Math.max(maxLagMs, Date.now() - op.at);
        for (const c of clients) {
          expect(Y.encodeStateVector(c.doc)).toEqual(Y.encodeStateVector(oracle));
          expect(roots(c.doc).elements.toJSON()).toEqual(roots(oracle).elements.toJSON());
          expect(validateBoardDoc(c.doc)).toEqual([]);
        }
        const elements = roots(clients[0]!.doc).elements;
        for (const [id, fields] of latest) {
          expect(elements.has(id)).toBe(!deleted.has(id));
          if (!deleted.has(id))
            for (const [field, value] of fields)
              expect(elements.get(id)!.get(field)).toEqual(value);
        }
        const text = (elements.get(shared)!.get('body') as Y.XmlFragment).toString();
        for (const token of tokens) expect(text).toContain(token);
        const viewer = connect(people[11]!.cookie);
        await viewer.synced;
        expect(viewer.provider.authorizedScope).toBe('readonly');
        addElement(viewer.doc, { ...baseElement('forged_viewer'), type: 'note' });
        await pause(300);
        const persisted = async () => {
          collab!.hocuspocus.flushPendingStores();
          const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
          if (!row) return '';
          const doc = new Y.Doc();
          Y.applyUpdate(doc, row.state);
          const state = signature(doc);
          doc.destroy();
          return state;
        };
        await expect.poll(persisted, { timeout: 10_000 }).toBe(signature(oracle));
        for (const c of sockets) c.close();
        await collab!.destroy();
        await app!.close();
        await boot();
        const restored = connect(people[1]!.cookie);
        await restored.synced;
        expect(signature(restored.doc)).toBe(signature(oracle));
        expect(validateBoardDoc(restored.doc)).toEqual([]);
        expect(errors).toEqual([]);
        expect(consoleErrors).not.toHaveBeenCalled();
        console.log(
          JSON.stringify({
            seed,
            durationMs: duration,
            operations: intents.length,
            converged: true,
            maxLagMs,
            recoveryMs,
            peakRssMiB: Math.round(peakRss / 1024 ** 2),
            stateBytes: Y.encodeStateAsUpdate(oracle).length,
          }),
        );
      } finally {
        for (const c of sockets) c.close();
        await collab?.destroy();
        await app?.close();
        for (const doc of docs) doc.destroy();
        consoleErrors.mockRestore();
        redis.disconnect();
        await database.end();
      }
    },
    duration + 60_000,
  );
});
