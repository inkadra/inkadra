import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { boardDocName } from '@inkadra/doc-schema';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

it.skipIf(!process.env.DATABASE_URL)(
  'signs in, writes and collaborates over LAN HTTP with canonical HTTPS',
  async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_RATE_LIMITS: 'off',
      PUBLIC_URL: 'https://boards.example.test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'unused',
      AUTH_SECRET: 'lan-origin-test-secret-lan-origin-test',
      TRUST_PROXY: 'loopback',
      REGISTRATION: 'open',
    });
    const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    const log = pino({ level: 'silent' });
    const mailer = memoryMailer();
    const auth = createAuth(config, db, { mailer });
    const app = await createApp({ config, db, auth, log, mailer, ...testDeps(db, log) });
    const collab = createCollabServer({
      db,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      trustProxy: config.TRUST_PROXY,
    });
    attachCollab(app.server, collab);
    const lan = { host: 'soyo:7340', origin: 'http://soyo:7340' };
    const credentials = {
      email: 'owner@example.test',
      name: 'Owner',
      password: 'lan-password-for-tests',
    };
    try {
      const signup = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: lan,
        payload: credentials,
      });
      expect(signup.statusCode).toBe(200);
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: lan,
        payload: credentials,
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === 'inkadra.session_token')!;
      expect(cookie).toBeDefined();
      expect(cookie.secure).not.toBe(true);
      const headers = { ...lan, cookie: `${cookie.name}=${cookie.value}` };
      expect((await app.inject({ url: '/api/v1/me', headers })).statusCode).toBe(200);
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers,
        payload: { name: 'LAN' },
      });
      expect(project.statusCode).toBe(201);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/projects',
            headers: { ...headers, origin: 'https://evil.test' },
            payload: { name: 'CSRF' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/sign-in/email',
            headers: { ...lan, origin: 'https://evil.test' },
            payload: credentials,
          })
        ).statusCode,
      ).toBe(403);
      const invite = await app.inject({
        method: 'POST',
        url: '/api/v1/invitations',
        headers,
        payload: { kind: 'email', email: 'invited@example.test' },
      });
      expect(invite.statusCode).toBe(201);
      expect(invite.json().invitation.url).toMatch(/^https:\/\/boards.example.test\/join\//);
      expect(mailer.sent.at(-1)?.text).toContain('https://boards.example.test/join/');
      const share = await app.inject({
        method: 'POST',
        url: `/api/v1/boards/${project.json().rootBoardId}/share-links`,
        headers,
        payload: { label: 'LAN share' },
      });
      expect(share.statusCode).toBe(201);
      expect(share.json().url).toMatch(/^https:\/\/boards.example.test\//);
      const proxy = {
        host: 'internal:3000',
        origin: config.PUBLIC_URL,
        'x-forwarded-host': 'boards.example.test',
        'x-forwarded-proto': 'https',
      };
      const httpsLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: proxy,
        payload: credentials,
      });
      expect(httpsLogin.statusCode).toBe(200);
      expect(
        httpsLogin.cookies.find((c) => c.name === '__Host-inkadra.session_token')?.secure,
      ).toBe(true);
      const spoof = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { ...lan, 'x-forwarded-proto': 'https' },
        remoteAddress: '203.0.113.9',
        payload: credentials,
      });
      expect(spoof.cookies.find((c) => c.name === 'inkadra.session_token')?.secure).not.toBe(true);
      expect(spoof.statusCode).toBe(200);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('No listener');
      const websocket = new HocuspocusProviderWebsocket({
        url: `ws://127.0.0.1:${address.port}/collab`,
        WebSocketPolyfill: class extends WebSocket {
          constructor(url: string) {
            super(url, { headers });
          }
        },
      });
      const document = new Y.Doc();
      const provider = new HocuspocusProvider({
        websocketProvider: websocket,
        name: boardDocName(project.json().rootBoardId),
        document,
        token: '',
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('LAN collaboration timed out')), 5000);
          provider.on('synced', () => {
            clearTimeout(timer);
            resolve();
          });
          provider.on('authenticationFailed', () => {
            clearTimeout(timer);
            reject(new Error('LAN collaboration rejected'));
          });
        });
      } finally {
        provider.destroy();
        websocket.destroy();
        document.destroy();
      }
    } finally {
      await collab.destroy();
      await app.close();
      auth.closeSecurity();
      await client.end({ timeout: 1 });
    }
  },
);
