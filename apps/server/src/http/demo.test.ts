import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  newElementId,
} from '@inkadra/doc-schema';
import { eq, inArray, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { DEMO_FILE_MAX, demoConfig, loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, boardDoc, project, projectMember, session, user } from '../db/schema.ts';
import { DEMO_DOMAIN, demoSeeds, sweepSandboxes, verifyTurnstile } from '../demo.ts';
import type { safeFetch } from '../safe-fetch.ts';
import { originalKey } from '../storage.ts';
import { testDeps } from '../test-deps.ts';
import { transferFile } from '../transfers/service.ts';
import { directVersionWriter } from '../versions.ts';
import { createApp } from './app.ts';
import { DEMO_MAX_BOARDS } from './boards-routes.ts';
import { DEMO_REFUSALS, demoAllows } from './demo-routes.ts';
import { securityHeaders } from './security-headers.ts';
import { demoBytesMatch, demoTypeAllowed } from './uploads.ts';

const base = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://unused',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
};

describe('the demo configuration (decision 0084)', () => {
  it('is off by default and changes nothing then', () => {
    const plain = loadConfig({
      ...base,
      CSP_ENFORCE: 'false',
      SMTP_URL: 'smtp://x',
      MAIL_FROM: 'a@b.c',
    });
    expect(plain.DEMO_MODE).toBe(false);
    expect(demoConfig(plain)).toBe(plain);
    expect(plain.CSP_ENFORCE).toBe(false);
    expect(plain.UPLOAD_MAX_SIZE).toBe(20 * 1024 ** 3);
  });

  it('closes what a stranger could abuse, whatever the environment says', () => {
    const c = loadConfig({
      ...base,
      DEMO_MODE: 'true',
      CSP_ENFORCE: 'false',
      UPLOAD_MAX_SIZE: '2GB',
      SMTP_URL: 'smtp://mail.example.com',
      MAIL_FROM: 'demo@example.com',
      REGISTRATION: 'open',
      MAP_GEOCODER_URL: 'https://nominatim.example.com/search',
      FEEDBACK_GITHUB_TOKEN: 'ghp_x',
    });
    expect(c).toMatchObject({
      CSP_ENFORCE: true,
      UPLOAD_MAX_SIZE: DEMO_FILE_MAX,
      STORAGE_LIMIT_PER_USER: 100e6,
      DEMO_TTL: 3_600_000,
      DEMO_MAX_SANDBOXES: 50,
      REGISTRATION: 'closed',
      VIDEO_PROXIES: false,
      RAW_PREVIEWS: false,
      HEIC_PREVIEWS: false,
      PDF_PREVIEWS: false,
      MAPS: false,
      FEEDBACK_RELAY_URL: '',
    });
    expect(c.SMTP_URL).toBeUndefined();
    expect(c.MAP_GEOCODER_URL).toBeUndefined();
    expect(c.FEEDBACK_GITHUB_TOKEN).toBeUndefined();
    expect(loadConfig({ ...base, DEMO_MODE: 'true', UPLOAD_MAX_SIZE: '1MB' }).UPLOAD_MAX_SIZE).toBe(
      1024 ** 2,
    );
  });

  it('does not start a demo in production without Turnstile', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(
      /TURNSTILE_SECRET: Required with DEMO_MODE in production/,
    );
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        TURNSTILE_SITE_KEY: 'k',
        TURNSTILE_SECRET: 's',
      }).DEMO_MODE,
    ).toBe(true);
    // Development and tests start, and main logs the missing keys.
    expect(loadConfig({ ...base, NODE_ENV: 'development', DEMO_MODE: 'true' }).DEMO_MODE).toBe(
      true,
    );
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).DEMO_MODE).toBe(false);
  });

  it('imports Last Train then Low Tide, or the archives DEMO_SEED lists', () => {
    const seeds = demoSeeds(undefined);
    expect(seeds.map((p) => p.split(/[\\/]/).pop())).toEqual([
      'last-train.inkadra',
      'low-tide.inkadra',
    ]);
    expect(demoSeeds('')).toEqual(seeds);
    expect(demoSeeds('/srv/one.inkadra')).toEqual(['/srv/one.inkadra']);
    expect(demoSeeds(' /srv/a.inkadra, /srv/b.inkadra ,')).toEqual([
      '/srv/a.inkadra',
      '/srv/b.inkadra',
    ]);
  });

  it('reads durations and wants both Turnstile keys', () => {
    expect(loadConfig({ ...base, DEMO_TTL: '30m' }).DEMO_TTL).toBe(1_800_000);
    expect(loadConfig({ ...base, DEMO_TTL: '7200' }).DEMO_TTL).toBe(7_200_000);
    expect(() => loadConfig({ ...base, DEMO_TTL: '10s' })).toThrow(/DEMO_TTL/);
    expect(() => loadConfig({ ...base, TURNSTILE_SITE_KEY: 'k' })).toThrow(/TURNSTILE_SECRET/);
  });

  it('enforces the CSP and lets Turnstile in only with its key', () => {
    const c = loadConfig({
      ...base,
      DEMO_MODE: 'true',
      TURNSTILE_SITE_KEY: 'site',
      TURNSTILE_SECRET: 'secret',
    });
    const headers = securityHeaders(c);
    expect(headers['content-security-policy']).toMatch(
      /script-src 'self' https:\/\/challenges\.cloudflare\.com/,
    );
    expect(headers['content-security-policy-report-only']).toBeUndefined();
    expect(securityHeaders(loadConfig(base))['content-security-policy-report-only']).not.toMatch(
      /cloudflare/,
    );
  });
});

describe('the demo allowlist', () => {
  const api = (p: string) => `/api/v1${p}`;
  it.each([
    ['POST', '/boards/:boardId/share-links'],
    ['PATCH', '/share-links/:linkId'],
    ['POST', '/invitations'],
    ['PUT', '/projects/:projectId/members/:userId'],
    ['DELETE', '/projects/:projectId/members/:userId'],
    ['PUT', '/boards/:boardId/grants/:userId'],
    ['POST', '/projects'],
    ['DELETE', '/projects/:projectId'],
    ['POST', '/projects/import'],
    ['GET', '/users/search'],
    ['POST', '/me/tokens'],
    ['POST', '/app-authorizations'],
    ['POST', '/clip'],
    ['PUT', '/me/avatar'],
    ['DELETE', '/me'],
    ['POST', '/me/storage/request'],
    ['POST', '/map-search'],
    ['POST', '/map-previews'],
    ['GET', '/map-tiles/:z/:x/:y'],
    ['GET', '/me/calendar-feed'],
    ['POST', '/me/calendar-feed'],
    ['GET', '/feedback/settings'],
    ['GET', '/diagnostics'],
    ['GET', '/instance/settings'],
    ['PATCH', '/instance/storage-limits'],
    ['GET', '/instance/members'],
    ['POST', '/instance/backups'],
    ['GET', '/guest/by-token/:token'],
    ['GET', '/assets/:assetId/office/:part'],
  ])('refuses %s %s', (method, route) => {
    expect(demoAllows(method, api(route), api(route))).toBe(false);
  });

  it('refuses every sign-in and sign-up, guest pages, calendar feeds and unknown API paths', () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/magic-link',
      '/api/auth/demo-session',
      '/api/auth/request-password-reset',
    ])
      expect(demoAllows('POST', '/api/auth/*', path)).toBe(false);
    expect(demoAllows('GET', '/api/auth/*', '/api/auth/get-session')).toBe(true);
    expect(demoAllows('POST', '/api/auth/*', '/api/auth/sign-out')).toBe(true);
    expect(demoAllows('GET', '/s/:token', '/s/abc')).toBe(false);
    expect(demoAllows('GET', '/calendar/:token.ics', '/calendar/abc.ics')).toBe(false);
    expect(demoAllows('GET', undefined, '/api/v1/nothing')).toBe(false);
    expect(demoAllows('GET', undefined, '/projects/abc')).toBe(true);
  });

  it('lets a sandbox work on its project', () => {
    for (const [method, route] of [
      ['GET', '/projects/:projectId'],
      ['HEAD', '/assets/:assetId/file'],
      ['POST', '/boards/:boardId/comments'],
      ['GET', '/boards/:boardId/share-links'],
      ['GET', '/share-links/:linkId/picks'],
      ['POST', '/projects/:projectId/exports'],
      ['POST', '/uploads'],
      ['PATCH', '/uploads/:uploadId'],
      ['DELETE', '/demo/sandbox'],
    ] as const)
      expect(demoAllows(method, api(route), api(route))).toBe(true);
  });
});

describe('the demo upload types', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  it('takes pictures, PDFs and plain text by type and extension', () => {
    expect(demoTypeAllowed('image/png', 'a.png')).toBe(true);
    expect(demoTypeAllowed('application/pdf', 'a.PDF')).toBe(true);
    expect(demoTypeAllowed('text/plain', 'notes.txt')).toBe(true);
    expect(demoTypeAllowed('image/svg+xml', 'a.svg')).toBe(false);
    expect(demoTypeAllowed('image/png', 'a.svg')).toBe(false);
    expect(demoTypeAllowed('text/html', 'a.html')).toBe(false);
    expect(demoTypeAllowed('video/mp4', 'a.mp4')).toBe(false);
    expect(demoTypeAllowed('image/heic', 'a.heic')).toBe(false);
  });
  it('checks the bytes against the type', () => {
    expect(demoBytesMatch('image/png', png)).toBe(true);
    expect(demoBytesMatch('image/png', Buffer.from('<svg onload="alert(1)">'))).toBe(false);
    expect(demoBytesMatch('image/jpeg', png)).toBe(false);
    expect(demoBytesMatch('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    // A polyglot: HTML first, the PDF header later, which `isPdf` alone would take.
    expect(demoBytesMatch('application/pdf', Buffer.from('<html><script>x</script>%PDF-1.7'))).toBe(
      false,
    );
    expect(demoBytesMatch('application/pdf', Buffer.from(' %PDF-1.7'))).toBe(false);
    expect(demoBytesMatch('text/plain', Buffer.from('hello'))).toBe(true);
    expect(demoBytesMatch('text/plain', Buffer.from('\ufeffScene 1\r\n\tINT. — Città\n'))).toBe(
      true,
    );
    expect(demoBytesMatch('text/plain', Uint8Array.from([0x68, 0, 0x69]))).toBe(false);
    expect(demoBytesMatch('text/plain', Buffer.from('a\u001b[31mb'))).toBe(false);
    expect(demoBytesMatch('text/plain', Uint8Array.from([0x68, 0xc3, 0x28]))).toBe(false);
    // Binary after a page of text: the whole text is checked, not its first bytes.
    const tail = Buffer.concat([Buffer.alloc(8192, 'a'), Uint8Array.from([0xff, 0xfe, 0x01])]);
    expect(demoBytesMatch('text/plain', tail)).toBe(false);
  });
});

describe('Turnstile', () => {
  const host = 'demo.example.com';
  const passed = { success: true, hostname: host, action: 'demo_sandbox' };
  it('posts the secret, token and address and trusts only success: true', async () => {
    const seen: Array<{ url: string; body?: string; maxRedirects?: number }> = [];
    const fake = (answer: unknown) =>
      (async (url: string, opts: Parameters<typeof safeFetch>[1]) => {
        seen.push({ url, body: opts.body, maxRedirects: opts.maxRedirects });
        return { url, contentType: 'application/json', body: Buffer.from(JSON.stringify(answer)) };
      }) as typeof safeFetch;
    expect(await verifyTurnstile('s3cret', 'tok', '203.0.113.9', host, fake(passed))).toBe(true);
    expect(seen[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(new URLSearchParams(seen[0]?.body)).toEqual(
      new URLSearchParams({ secret: 's3cret', response: 'tok', remoteip: '203.0.113.9' }),
    );
    expect(seen[0]?.maxRedirects).toBe(0);
    expect(
      await verifyTurnstile('s', 'tok', 'ip', host, fake({ ...passed, success: 'true' })),
    ).toBe(false);
    expect(await verifyTurnstile('s', undefined, 'ip', host, fake(passed))).toBe(false);
    const broken = (async () => {
      throw new Error('down');
    }) as unknown as typeof safeFetch;
    expect(await verifyTurnstile('s', 'tok', 'ip', host, broken)).toBe(false);
  });

  it('refuses a token solved on another site or for another action', async () => {
    const fake = (answer: unknown) =>
      (async (url: string) => ({
        url,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(answer)),
      })) as unknown as typeof safeFetch;
    for (const answer of [
      { ...passed, hostname: 'evil.example.com' },
      { ...passed, hostname: undefined },
      { ...passed, action: 'login' },
      { ...passed, action: undefined },
    ])
      expect(
        await verifyTurnstile('s', 'tok', 'ip', host, fake(answer)),
        JSON.stringify(answer),
      ).toBe(false);
  });
});

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe.skipIf(!url)('the public demo (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    DEMO_MODE: 'true',
    DEMO_MAX_SANDBOXES: '3',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET: 'secret-key',
  });
  // Errors are kept: a sandbox ending under an export must not log a failed transfer.
  const errors: string[] = [];
  const log = pino({ level: 'error' }, { write: (line: string) => void errors.push(line) });
  const limits = { maxPayload: 2 * 1024 * 1024, elements: 40, stateBytes: 256 * 1024 };
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 6);
  const deps = testDeps(db, log);
  // Export archives where the in-process jobs write them, so endSandbox finds them.
  config.DATA_DIR = deps.root;
  const auth = createAuth(config, db);
  const collab = createCollabServer({
    db,
    auth,
    log,
    publicUrl: config.PUBLIC_URL,
    limits,
  });
  let app: Awaited<ReturnType<typeof createApp>>;
  let host = '';
  const turnstile = (async (u: string, opts: Parameters<typeof safeFetch>[1]) => ({
    url: u,
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        success: new URLSearchParams(opts.body).get('response') === 'pass',
        hostname: 'localhost',
        action: 'demo_sandbox',
      }),
    ),
  })) as typeof safeFetch;

  interface Sandbox {
    cookie: string;
    id: string;
    projectId: string;
    boardId: string;
  }
  let a: Sandbox;
  let b: Sandbox;

  const call = async (
    cookie: string,
    method: string,
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const body =
      payload === undefined
        ? undefined
        : Buffer.isBuffer(payload)
          ? payload
          : JSON.stringify(payload);
    const res = await fetch(`http://${host}${path}`, {
      method,
      headers: {
        cookie,
        origin: config.PUBLIC_URL,
        ...(body !== undefined && !Buffer.isBuffer(payload)
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
      body,
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: () => JSON.parse(text),
    };
  };
  const open = (ip: string, token: string | null = 'pass') =>
    call('', 'POST', '/api/v1/demo/sandbox', token ? { turnstileToken: token } : {}, {
      'x-forwarded-for': ip,
    });
  async function sandbox(ip: string): Promise<Sandbox> {
    const res = await open(ip);
    expect(res.status).toBe(201);
    const cookie = (res.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
    const me = (await call(cookie, 'GET', '/api/v1/me')).json();
    const projectId = res.json().projectId as string;
    const p = (await call(cookie, 'GET', `/api/v1/projects/${projectId}`)).json();
    return { cookie, id: me.id, projectId, boardId: p.rootBoardId };
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth,
      log,
      ...deps,
      versions: directVersionWriter(collab, db, log, limits),
      turnstileFetch: turnstile,
    });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  it('tells the sign-in page it is a demo, with no first account to set up', async () => {
    const instance = (await call('', 'GET', '/api/v1/instance')).json();
    expect(instance).toMatchObject({
      setupRequired: false,
      registration: 'closed',
      auth: { emailPassword: false, google: false, magicLink: false },
      demo: {
        ttlSeconds: 3600,
        storageBytes: 100e6,
        fileBytes: DEMO_FILE_MAX,
        maxSandboxes: 3,
        full: false,
        turnstileSiteKey: 'site-key',
      },
    });
    const headers = (await call('', 'GET', '/api/v1/instance')).headers;
    expect(headers.get('content-security-policy')).toMatch(/challenges\.cloudflare\.com/);
  });

  it('refuses a sandbox without a passed Turnstile check', async () => {
    for (const token of [null, 'fail']) {
      const res = await open('198.51.100.1', token);
      expect(res.status).toBe(403);
      expect(res.json().error.details).toEqual({ reason: 'turnstile' });
    }
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it('makes a sandbox with the sample projects, signed in, for one hour', async () => {
    const before = Date.now();
    a = await sandbox('198.51.100.1');
    const [row] = await db.select().from(user).where(eq(user.id, a.id));
    expect(row?.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
    expect(row?.role).toBe('member');
    const mine = (await call(a.cookie, 'GET', '/api/v1/demo/sandbox')).json();
    expect(Date.parse(mine.expiresAt) - before).toBeGreaterThan(3_590_000);
    expect(Date.parse(mine.expiresAt) - before).toBeLessThan(3_610_000);
    expect(mine).toMatchObject({ projectId: a.projectId, exportUsed: false });
    const projects = (await call(a.cookie, 'GET', '/api/v1/projects')).json();
    const byName = new Map<string, string>(
      projects.items.map((p: { id: string; name: string }) => [p.name, p.id]),
    );
    expect([...byName.keys()].sort()).toEqual(['Last Train', 'Low Tide']);
    // "Try the demo" opens the first one, the film.
    expect(byName.get('Last Train')).toBe(a.projectId);
    const boards = (await call(a.cookie, 'GET', `/api/v1/projects/${a.projectId}/boards`)).json();
    expect(boards.items.length).toBeGreaterThanOrEqual(3);
    const photo = byName.get('Low Tide') as string;
    const photoBoards = (await call(a.cookie, 'GET', `/api/v1/projects/${photo}/boards`)).json();
    expect(photoBoards.items.map((b: { title: string }) => b.title)).toEqual(
      expect.arrayContaining(['Shot list', 'Selects']),
    );
    // The shooting days keep their distance from today: the film shoots today, the photo shoot
    // was two days ago.
    const firstDay = async (projectId: string) => {
      const days = await db.execute<{ date: string }>(
        sql`select date from shooting_day where project_id = ${projectId} order by date`,
      );
      return [...days][0]?.date;
    };
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    expect(await firstDay(a.projectId)).toBe(day(0));
    expect(await firstDay(photo)).toBe(day(-2));
  });

  it('lets one address open one sandbox every ten minutes', async () => {
    const again = await open('198.51.100.1');
    expect(again.status).toBe(429);
    expect(again.json().error.details).toEqual({ reason: 'demo_wait' });
    expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(500);
    b = await sandbox('198.51.100.2');
  });

  it('limits refused attempts per address, an IPv6 /64 as one', async () => {
    for (let i = 0; i < DEMO_REFUSALS; i++) {
      const res = await open(`2001:db8:1:2::${i + 1}`, 'fail');
      expect(res.status).toBe(403);
    }
    // A passed check from the same /64 waits too: the refusals spent its budget.
    const next = await open('2001:db8:1:2:ffff::1');
    expect(next.status).toBe(429);
    expect(next.json().error.details).toEqual({ reason: 'demo_wait' });
    expect(Number(next.headers.get('retry-after'))).toBeGreaterThan(500);
    expect(
      await db
        .select()
        .from(user)
        .where(sql`${user.email} like ${`%@${DEMO_DOMAIN}`}`),
    ).toHaveLength(2);
  });

  it.each([
    ['POST', '/boards/:board/share-links', { allowDownload: true }],
    ['POST', '/invitations', { projectId: ':project', role: 'editor', kind: 'link' }],
    ['PUT', '/projects/:project/members/:other', { role: 'editor' }],
    ['POST', '/projects', { name: 'Another' }],
    ['DELETE', '/projects/:project', undefined],
    ['GET', '/users/search?q=demo', undefined],
    ['POST', '/me/tokens', { name: 'x' }],
    ['POST', '/me/calendar-feed', {}],
    ['GET', '/instance/settings', undefined],
    ['GET', '/instance/members', undefined],
    ['GET', '/diagnostics', undefined],
    ['GET', '/feedback/settings', undefined],
    ['POST', '/feedback', { text: 'spam' }],
    ['POST', '/map-search', { q: 'Roma' }],
    ['POST', '/me/storage/request', {}],
    ['DELETE', '/me', {}],
    [
      'POST',
      '/link-previews',
      { projectId: ':project', boardId: ':board', url: 'https://example.com' },
    ],
  ] as const)('answers 403 to %s %s', async (method, path, payload) => {
    const fill = (text: string) =>
      text.replace(':board', a.boardId).replace(':project', a.projectId).replace(':other', b.id);
    const filled = fill(path);
    const res = await call(
      a.cookie,
      method,
      `/api/v1${filled}`,
      payload && JSON.parse(fill(JSON.stringify(payload))),
    );
    expect(res.status).toBe(403);
    expect(res.json().error.details).toEqual({ reason: 'demo_off' });
  });

  it('answers 403 to sign-in, sign-up, guest pages and calendar feeds', async () => {
    for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email']) {
      const res = await call('', 'POST', path, {
        email: 'x@example.com',
        password: 'correct-horse-battery',
        name: 'x',
      });
      expect(res.status).toBe(403);
    }
    expect((await call('', 'GET', `/s/${randomUUID()}`)).status).toBe(403);
    expect((await call('', 'GET', '/calendar/abc.ics')).status).toBe(403);
    expect((await call(a.cookie, 'GET', '/api/auth/get-session')).status).toBe(200);
  });

  it('keeps each sandbox to itself', async () => {
    const [file] = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.projectId, a.projectId))
      .limit(1);
    for (const [method, path, payload] of [
      ['GET', `/projects/${a.projectId}`, undefined],
      ['GET', `/projects/${a.projectId}/boards`, undefined],
      ['PATCH', `/projects/${a.projectId}`, { name: 'Mine now' }],
      ['GET', `/boards/${a.boardId}`, undefined],
      ['PATCH', `/boards/${a.boardId}`, { title: 'Mine now' }],
      ['DELETE', `/boards/${a.boardId}`, undefined],
      ['GET', `/boards/${a.boardId}/comments`, undefined],
      ['POST', `/boards/${a.boardId}/comments`, { body: 'hi', elementId: null }],
      ['GET', `/boards/${a.boardId}/versions`, undefined],
      ['GET', `/assets/${file?.id}`, undefined],
      ['GET', `/assets/${file?.id}/file`, undefined],
      ['POST', `/projects/${a.projectId}/exports`, {}],
    ] as const) {
      const res = await call(b.cookie, method, `/api/v1${path}`, payload);
      // Refused, or not even read: never served, changed or a hint that it exists.
      expect([400, 403, 404], `${method} ${path}`).toContain(res.status);
    }
    const seen = (await call(b.cookie, 'GET', '/api/v1/projects')).json();
    const own = await db
      .select({ id: projectMember.projectId })
      .from(projectMember)
      .where(eq(projectMember.userId, b.id));
    expect(seen.items.map((p: { id: string }) => p.id).sort()).toEqual(own.map((p) => p.id).sort());
    expect(own).toHaveLength(2);
    expect(own.map((p) => p.id)).not.toContain(a.projectId);
    const [mine] = await db.select().from(project).where(eq(project.id, a.projectId));
    expect(mine?.name).toBe('Last Train');
  });

  function connect(cookie: string, boardId: string) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie } });
      }
    }
    const doc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${host}/collab?schemaVersion=${CURRENT_SCHEMA_VERSION}`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(boardId),
      document: doc,
    });
    provider.attach();
    return {
      doc,
      provider,
      synced: new Promise<void>((resolve) => provider.on('synced', () => resolve())),
      failed: new Promise<boolean>((resolve) => {
        provider.on('authenticationFailed', () => resolve(true));
        setTimeout(() => resolve(false), 4000);
      }),
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
  }

  it('never lets one sandbox open the board of another live', async () => {
    const c = connect(b.cookie, a.boardId);
    expect(await c.failed).toBe(true);
    c.close();
  });

  it('makes a board read-only past the caps and does not save it', async () => {
    const [stored] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, b.boardId));
    const c = connect(b.cookie, b.boardId);
    await c.synced;
    c.doc.transact(() => {
      for (let i = 0; i < 60; i++)
        addElement(c.doc, {
          id: newElementId(),
          type: 'column',
          title: `Flood ${i}`,
          x: i * 300,
          y: 0,
          w: 280,
          z: 'a0',
          parent: null,
          createdBy: null,
          createdAt: Date.now(),
        });
    });
    const fresh = connect(b.cookie, b.boardId);
    await fresh.synced;
    await expect.poll(() => fresh.provider.authorizedScope, { timeout: 5000 }).toBe('readonly');
    // Nor is it copied into a version.
    const version = await call(b.cookie, 'POST', `/api/v1/boards/${b.boardId}/versions`, {
      name: 'Flood',
    });
    expect(version.status).toBe(409);
    expect(version.json().error.details).toEqual({ reason: 'demo_limit' });
    c.close();
    fresh.close();
    collab.hocuspocus.flushPendingStores();
    await new Promise((r) => setTimeout(r, 500));
    const [after] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, b.boardId));
    expect(after?.size).toBe(stored?.size);
  });

  it('makes a board read-only as soon as it grows past its size, before any store', async () => {
    const c = connect(a.cookie, a.boardId);
    let fresh: ReturnType<typeof connect> | undefined;
    try {
      await c.synced;
      const before = await call(a.cookie, 'POST', `/api/v1/boards/${a.boardId}/versions`, {
        name: 'Before',
      });
      expect(before.status).toBe(201);
      // One update past the size, in a part of the document no schema reads.
      c.doc.getMap('flood').set('x', 'x'.repeat(limits.stateBytes));
      const opened = connect(a.cookie, a.boardId);
      fresh = opened;
      await opened.synced;
      // Sooner than the store's debounce (2 s): the change itself froze it.
      await expect.poll(() => opened.provider.authorizedScope, { timeout: 1500 }).toBe('readonly');
      const back = await call(
        a.cookie,
        'POST',
        `/api/v1/boards/${a.boardId}/versions/${before.json().id}/restore`,
      );
      expect(back.status).toBe(409);
      expect(back.json().error.details).toEqual({ reason: 'demo_limit' });
    } finally {
      c.close();
      fresh?.close();
    }
  });

  it(`caps a sandbox at ${DEMO_MAX_BOARDS} boards`, async () => {
    const make = (n: number) =>
      call(a.cookie, 'POST', `/api/v1/projects/${a.projectId}/boards`, {
        parentBoardId: a.boardId,
        title: `Board ${n}`,
      });
    let made = 0;
    for (let n = 0; n < DEMO_MAX_BOARDS; n++) {
      const res = await make(n);
      if (res.status !== 201) {
        expect(res.status).toBe(409);
        expect(res.json().error.details).toEqual({ reason: 'demo_limit' });
        break;
      }
      made++;
    }
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThan(DEMO_MAX_BOARDS);
    expect((await make(99)).status).toBe(409);
  });

  it('takes only pictures, PDFs and text, and checks their bytes', async () => {
    const tus = { 'tus-resumable': '1.0.0' };
    const start = (name: string, type: string, bytes: number) =>
      call(a.cookie, 'POST', '/api/v1/uploads', undefined, {
        ...tus,
        'upload-length': String(bytes),
        'upload-metadata': [
          `projectId ${b64(a.projectId)}`,
          `filename ${b64(name)}`,
          `filetype ${b64(type)}`,
        ].join(','),
      });
    const send = (id: string, body: Buffer) =>
      call(a.cookie, 'PATCH', `/api/v1/uploads/${id}`, body, {
        ...tus,
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream',
      });
    expect((await start('x.svg', 'image/svg+xml', 100)).status).toBe(415);
    expect((await start('x.html', 'text/html', 100)).status).toBe(415);
    expect((await start('x.mp4', 'video/mp4', 100)).status).toBe(415);
    expect((await start('big.png', 'image/png', DEMO_FILE_MAX + 1)).status).toBe(413);
    // An SVG with a script, named and typed as a PNG: refused once its bytes are in.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const fake = await start('x.png', 'image/png', svg.length);
    expect(fake.status).toBe(201);
    const fakeId = String(fake.headers.get('inkadra-asset-id'));
    expect((await send(fakeId, svg)).status).toBe(415);
    expect(await db.select().from(asset).where(eq(asset.id, fakeId))).toHaveLength(0);
    // Binary after a page of text, named and typed as text: refused too.
    const hidden = Buffer.concat([Buffer.alloc(5000, 'a'), Uint8Array.from([0, 1, 2, 0xff])]);
    const smuggled = await start('notes.txt', 'text/plain', hidden.length);
    const smuggledId = String(smuggled.headers.get('inkadra-asset-id'));
    expect((await send(smuggledId, hidden)).status).toBe(415);
    const text = Buffer.from('Call sheet notes');
    const ok = await start('notes.txt', 'text/plain', text.length);
    expect((await send(String(ok.headers.get('inkadra-asset-id')), text)).status).toBe(204);
  });

  it('serves a stored SVG as a download that cannot run', async () => {
    const id = randomUUID();
    const body = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await deps.storage.write(originalKey(id), body, 'image/svg+xml');
    await db.insert(asset).values({
      id,
      projectId: a.projectId,
      kind: 'image',
      mime: 'image/svg+xml',
      filename: 'x.svg',
      size: body.length,
      storageKey: originalKey(id),
      status: 'ready',
      createdBy: a.id,
    });
    const res = await call(a.cookie, 'GET', `/api/v1/assets/${id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('opens pictures, video and sound in the page: a PDF is a download', async () => {
    const store = async (mime: string, filename: string, body: Buffer) => {
      const id = randomUUID();
      await deps.storage.write(originalKey(id), body, mime);
      await db.insert(asset).values({
        id,
        projectId: a.projectId,
        kind: mime.startsWith('image/') ? 'image' : 'file',
        mime,
        filename,
        size: body.length,
        storageKey: originalKey(id),
        status: 'ready',
        createdBy: a.id,
      });
      return (await call(a.cookie, 'GET', `/api/v1/assets/${id}/file`)).headers;
    };
    const pdf = await store('application/pdf', 'call-sheet.pdf', Buffer.from('%PDF-1.7\n'));
    expect(pdf.get('content-type')).toBe('application/octet-stream');
    expect(pdf.get('content-disposition')).toMatch(/^attachment/);
    expect(pdf.get('x-content-type-options')).toBe('nosniff');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await store('image/png', 'frame.png', png)).get('content-disposition')).toMatch(
      /^inline/,
    );
    // Only the sample project brings them: a sandbox cannot upload video or sound.
    for (const [mime, name] of [
      ['video/mp4', 'take.mp4'],
      ['audio/wav', 'note.wav'],
    ] as const) {
      const media = await store(mime, name, Buffer.from('media'));
      expect(media.get('content-type')).toBe(mime);
      expect(media.get('content-disposition')).toMatch(/^inline/);
    }
  });

  it('exports a sandbox once', async () => {
    const first = await call(a.cookie, 'POST', `/api/v1/projects/${a.projectId}/exports`, {});
    expect(first.status).toBe(202);
    const id = first.json().id as string;
    await expect
      .poll(async () => (await call(a.cookie, 'GET', `/api/v1/transfers/${id}`)).json().status, {
        timeout: 15_000,
      })
      .toBe('ready');
    expect((await call(a.cookie, 'DELETE', `/api/v1/transfers/${id}`)).status).toBe(204);
    const second = await call(a.cookie, 'POST', `/api/v1/projects/${a.projectId}/exports`, {});
    expect(second.status).toBe(429);
    expect(second.json().error.details).toEqual({ reason: 'demo_export' });
    expect((await call(a.cookie, 'GET', '/api/v1/demo/sandbox')).json().exportUsed).toBe(true);
  });

  it('stops at DEMO_MAX_SANDBOXES and says so', async () => {
    await sandbox('198.51.100.3');
    const full = await open('198.51.100.4');
    expect(full.status).toBe(429);
    expect(full.json().error.details).toEqual({ reason: 'demo_full' });
    expect((await call('', 'GET', '/api/v1/instance')).json().demo.full).toBe(true);
    // A refused visitor kept their turn: they get one as soon as there is room.
    const [third] = await db
      .select({ id: user.id })
      .from(user)
      .where(
        sql`${user.email} like ${`%@${DEMO_DOMAIN}`} and ${user.id} not in (${a.id}, ${b.id})`,
      );
    if (third) await db.delete(user).where(eq(user.id, third.id));
    expect((await open('198.51.100.4')).status).toBe(201);
  });

  it('removes a sandbox with its projects, files and sessions after its hour', async () => {
    const own = (
      await db
        .select({ id: projectMember.projectId })
        .from(projectMember)
        .where(eq(projectMember.userId, a.id))
    ).map((p) => p.id);
    expect(own).toHaveLength(2);
    const keys = await db
      .select({ key: asset.storageKey })
      .from(asset)
      .where(inArray(asset.projectId, own));
    expect(keys.length).toBeGreaterThan(0);
    await db
      .update(user)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(user.id, a.id));
    expect(await sweepSandboxes({ db, jobs: deps.jobs, config, log })).toBe(1);
    expect(await db.select().from(user).where(eq(user.id, a.id))).toHaveLength(0);
    expect(await db.select().from(project).where(inArray(project.id, own))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, a.id))).toHaveLength(0);
    expect(
      await db.select().from(projectMember).where(eq(projectMember.userId, a.id)),
    ).toHaveLength(0);
    // The files go in a queued job: on a busy runner that takes longer than the default second.
    await expect
      .poll(
        async () => {
          const sizes = await Promise.all(keys.map((k) => deps.storage.size(k.key)));
          return sizes.every((s) => s === null);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    expect((await call(a.cookie, 'GET', '/api/v1/me')).status).toBe(401);
    // Accounts outside the demo are never touched, however old.
    await db.insert(user).values({
      name: 'Operator',
      email: 'operator@example.com',
      role: 'member',
      createdAt: new Date(0),
    });
    expect(await sweepSandboxes({ db, jobs: deps.jobs, config, log })).toBe(0);
    expect(await db.select().from(user).where(eq(user.email, 'operator@example.com'))).toHaveLength(
      1,
    );
  });

  it('ends a sandbox now with "start over"', async () => {
    expect((await call(b.cookie, 'DELETE', '/api/v1/demo/sandbox')).status).toBe(204);
    expect(await db.select().from(user).where(eq(user.id, b.id))).toHaveLength(0);
    expect((await call(b.cookie, 'GET', '/api/v1/demo/sandbox')).status).toBe(401);
  });

  it('stops an export under way when its sandbox ends, leaving no archive or error', async () => {
    const c = await sandbox('198.51.100.5');
    const started = await call(c.cookie, 'POST', `/api/v1/projects/${c.projectId}/exports`, {});
    expect(started.status).toBe(202);
    const id = started.json().id as string;
    expect((await call(c.cookie, 'DELETE', '/api/v1/demo/sandbox')).status).toBe(204);
    // Whether the export had finished, was running or had not started yet, it ends the same.
    await new Promise((r) => setTimeout(r, 1500));
    await expect(stat(transferFile(deps.root, id))).rejects.toThrow(/ENOENT/);
    expect(errors.filter((line) => line.includes('transfer'))).toEqual([]);
  });
});

it('allows atomic schedule edits in the demo', () => {
  expect(
    demoAllows('POST', '/api/v1/boards/:boardId/schedule/edit', '/api/v1/boards/b/schedule/edit'),
  ).toBe(true);
});
