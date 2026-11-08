import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, notification, user } from '../db/schema.ts';
import { type Limits, overrideAllowed, personLimit, saveLimits } from '../storage-limits.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';
import { HttpError } from './errors.ts';

const limits = (over: Partial<Limits> = {}): Limits => ({
  total: null,
  perUser: 5e9,
  warnPercent: 80,
  locked: { total: false, perUser: false },
  ...over,
});

describe('the limit of one person (decision 0081)', () => {
  it('follows the default, their own or none', () => {
    expect(personLimit(limits(), null)).toBe(5e9);
    expect(personLimit(limits(), 20e9)).toBe(20e9);
    expect(personLimit(limits(), 0)).toBeNull();
  });
  it('can only be lowered under a limit of the environment', () => {
    const env = limits({ locked: { total: false, perUser: true } });
    expect(personLimit(env, 20e9)).toBe(5e9);
    expect(personLimit(env, 0)).toBe(5e9);
    expect(personLimit(env, 1e9)).toBe(1e9);
    expect(overrideAllowed(env, 1e9)).toBe(true);
    expect(overrideAllowed(env, 20e9)).toBe(false);
    expect(overrideAllowed(env, 0)).toBe(false);
    expect(overrideAllowed(env, null)).toBe(true);
  });
});

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe.skipIf(!url)('storage limits on uploads (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 6);
  const deps = testDeps(db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  const as: Record<'admin' | 'member', { cookie: string; id: string }> = {
    admin: { cookie: '', id: '' },
    member: { cookie: '', id: '' },
  };
  let projectId = '';
  const tus = { 'tus-resumable': '1.0.0' };

  const call = async (
    who: keyof typeof as,
    method: 'GET' | 'POST' | 'PATCH',
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
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie: as[who].cookie,
        origin: config.PUBLIC_URL,
        ...(body !== undefined && !Buffer.isBuffer(payload)
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
      body,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
  };
  const start = (bytes: number, name = 'take.mov') =>
    call('member', 'POST', '/api/v1/uploads', undefined, {
      ...tus,
      'upload-length': String(bytes),
      'upload-metadata': [
        `projectId ${b64(projectId)}`,
        `filename ${b64(name)}`,
        `filetype ${b64('application/octet-stream')}`,
      ].join(','),
    });
  const finish = (id: string, bytes: number) =>
    call('member', 'PATCH', `/api/v1/uploads/${id}`, Buffer.alloc(bytes, 1), {
      ...tus,
      'upload-offset': '0',
      'content-type': 'application/offset+octet-stream',
    });
  const setLimits = (patch: object) =>
    call('admin', 'PATCH', '/api/v1/instance/storage-limits', patch);

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...deps });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const who of Object.keys(as) as Array<keyof typeof as>) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${who}@example.com`, password: 'correct-horse-battery', name: who },
      });
      as[who] = {
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
        id: res.json().user.id,
      };
    }
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, as.admin.id));
    await db.update(user).set({ role: 'member' }).where(eq(user.id, as.member.id));
    projectId = (await call('member', 'POST', '/api/v1/projects', { name: 'Quota' })).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('is off by default: uploads go through and nobody has a limit', async () => {
    const created = await start(300);
    expect(created.status).toBe(201);
    expect((await finish(String(created.headers.get('inkadra-asset-id')), 300)).status).toBe(204);
    const mine = (await call('member', 'GET', '/api/v1/me/storage')).json();
    expect(mine).toMatchObject({ originalBytes: 300, limit: null, instanceFull: false });
    const settings = (await call('admin', 'GET', '/api/v1/instance/storage-limits')).json();
    expect(settings).toMatchObject({ total: null, perUser: null, warnPercent: 80 });
    expect(settings.locked).toEqual({ total: false, perUser: false });
  });

  it('refuses a file over the space of the person, with what is left', async () => {
    expect((await setLimits({ perUser: 1000 })).status).toBe(200);
    expect((await start(500)).status).toBe(201);
    // 300 finished and 500 still arriving: 200 left.
    const refused = await start(600);
    expect(refused.status).toBe(413);
    expect(JSON.parse(refused.text)).toEqual({
      code: 'storage_full',
      scope: 'user',
      remaining: 200,
      limit: 1000,
    });
    const members = (await call('admin', 'GET', '/api/v1/instance/members')).json().items;
    expect(members.find((m: { id: string }) => m.id === as.member.id)).toMatchObject({
      storageBytes: 300,
      storageLimit: 1000,
      storageLimitOverride: null,
    });
  });

  it('lets only one of two parallel uploads take the last bytes', async () => {
    const both = await Promise.all([start(150), start(150)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 413]);
  });

  it('checks again when the last byte arrives, and keeps nothing', async () => {
    await call('admin', 'PATCH', `/api/v1/instance/members/${as.member.id}`, { storageLimit: 0 });
    const created = await start(100, 'late.mov');
    expect(created.status).toBe(201);
    const id = String(created.headers.get('inkadra-asset-id'));
    // The limit comes back and drops under what is used while the bytes travel.
    await call('admin', 'PATCH', `/api/v1/instance/members/${as.member.id}`, {
      storageLimit: null,
    });
    await setLimits({ perUser: 500 });
    const done = await finish(id, 100);
    expect(done.status).toBe(413);
    expect(JSON.parse(done.text)).toMatchObject({ code: 'storage_full', scope: 'user' });
    expect(await db.select().from(asset).where(eq(asset.id, id))).toEqual([]);
  });

  it('gives the instance total precedence over a person without limit', async () => {
    await call('admin', 'PATCH', `/api/v1/instance/members/${as.member.id}`, { storageLimit: 0 });
    await setLimits({ total: 2000 });
    const refused = await start(5000);
    expect(refused.status).toBe(413);
    expect(JSON.parse(refused.text)).toMatchObject({ scope: 'instance', limit: 2000 });
    expect((await call('member', 'GET', '/api/v1/me/storage')).json()).toMatchObject({
      limit: null,
    });
  });

  it('lists the largest files and asks the administrators for space once a day', async () => {
    const files = (await call('member', 'GET', '/api/v1/me/storage/files')).json();
    expect(files.items[0]).toMatchObject({ filename: 'take.mov', projectName: 'Quota' });
    expect(files.hiddenCount).toBe(0);
    // The administrator is not a member of the project: counted, never named.
    const theirs = (
      await call('admin', 'GET', `/api/v1/instance/members/${as.member.id}/files`)
    ).json();
    expect(theirs.items).toEqual([]);
    expect(theirs.hiddenCount).toBeGreaterThan(0);
    expect((await call('member', 'POST', '/api/v1/me/storage/request', {})).json()).toEqual({
      sent: true,
    });
    expect((await call('member', 'POST', '/api/v1/me/storage/request', {})).json()).toEqual({
      sent: false,
    });
    const sent = await db.select().from(notification).where(eq(notification.userId, as.admin.id));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ actorId: as.member.id, type: 'server_alert' });
  });

  it('refuses changes to limits the server environment sets', async () => {
    const env = { STORAGE_LIMIT: 1e12, STORAGE_LIMIT_PER_USER: undefined };
    await expect(saveLimits(db, env, { total: 5e12 })).rejects.toBeInstanceOf(HttpError);
    await expect(saveLimits(db, env, { warnPercent: 90 })).rejects.toBeInstanceOf(HttpError);
    const saved = await saveLimits(db, { ...env, STORAGE_LIMIT: undefined }, { perUser: 7e9 });
    expect(saved).toMatchObject({ perUser: 7e9, locked: { total: false, perUser: false } });
  });
});
