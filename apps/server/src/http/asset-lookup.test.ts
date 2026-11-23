import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ASSET_LOOKUP_CAPABILITY, type Asset } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  asset,
  assetRendition,
  assetVariant,
  board,
  boardGrant,
  projectMember,
  user,
} from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';
import { renditionsOf } from './hls.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('POST /assets/lookup (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string; bearer?: string }> = {};
  /** Every asset of the suite by name, plus an id nobody has. */
  const ids: Record<string, string> = { missing: randomUUID() };
  const SIGN_UPS = [
    'owner',
    'member',
    'granted',
    'trashedGrant',
    'expiredGrant',
    'expiredMember',
    'oddRole',
    'deactivated',
    'outsider',
    'limited',
  ];
  /** Who asks: everyone signed up but the deactivated account, plus a token of the member. */
  const WHO = [...SIGN_UPS.filter((who) => who !== 'deactivated' && who !== 'limited'), 'token'];

  function request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    as: string | null,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: !as
        ? {}
        : people[as]?.bearer
          ? { authorization: `Bearer ${people[as]?.bearer}` }
          : { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }
  const lookup = (as: string | null, list: unknown) =>
    request('POST', '/assets/lookup', as, { ids: list });

  async function file(projectId: string, over: Partial<typeof asset.$inferInsert> = {}) {
    const [row] = await db
      .insert(asset)
      .values({
        projectId,
        kind: 'image',
        mime: 'image/png',
        filename: 'a.png',
        size: 100,
        width: 640,
        height: 480,
        status: 'ready',
        storageKey: `originals/${randomUUID()}`,
        createdBy: people.owner?.id ?? null,
        ...over,
      })
      .returning();
    return row?.id as string;
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of SIGN_UPS) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      people[name] = {
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
        id: res.json().user.id,
      };
    }
    const project = (await request('POST', '/projects', 'owner', { name: 'Lookup' })).json();
    const other = (await request('POST', '/projects', 'outsider', { name: 'Elsewhere' })).json();
    for (const name of ['member', 'expiredMember', 'oddRole', 'deactivated'])
      await request('PUT', `/projects/${project.id}/members/${people[name]?.id}`, 'owner', {
        role: 'editor',
      });
    await db
      .update(projectMember)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(projectMember.userId, people.expiredMember?.id as string));
    // A role written outside the app, which the single route refuses.
    await db.execute(
      sql`update project_member set role = 'auditor' where user_id = ${people.oddRole?.id}`,
    );
    const token = await request('POST', '/me/tokens', 'member', { name: 'Script' });
    expect(token.statusCode).toBe(201);
    people.token = { cookie: '', id: people.member?.id as string, bearer: token.json().token };
    const child = async (title: string) =>
      (
        await request('POST', `/projects/${project.id}/boards`, 'owner', {
          parentBoardId: project.rootBoardId,
          title,
        })
      ).json().id as string;
    const shared = await child('Shared');
    const trashed = await child('Trashed');
    await db.insert(boardGrant).values([
      { boardId: shared, userId: people.granted?.id as string, role: 'viewer' },
      { boardId: trashed, userId: people.trashedGrant?.id as string, role: 'editor' },
      {
        boardId: shared,
        userId: people.expiredGrant?.id as string,
        role: 'viewer',
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, trashed));

    ids.image = await file(project.id);
    for (const [size, width] of [
      ['512', 512],
      ['256', 256],
    ] as const)
      await db.insert(assetVariant).values({
        assetId: ids.image,
        size,
        width,
        height: width,
        storageKey: `variants/${ids.image}/${size}.webp`,
        bytes: 10,
      });
    ids.video = await file(project.id, {
      kind: 'video',
      mime: 'video/mp4',
      filename: 'a.mp4',
      durationMs: 4000,
      proxyStatus: 'processing',
    });
    await db.insert(assetVariant).values({
      assetId: ids.video,
      size: '256',
      width: 256,
      height: 144,
      storageKey: `variants/${ids.video}/256.webp`,
      bytes: 10,
    });
    await db.insert(assetRendition).values([
      {
        assetId: ids.video,
        name: '480',
        status: 'ready',
        recipe: 'x',
        storageKey: `variants/${ids.video}/r0-480.mp4`,
        playlist: '#EXTM3U\n',
        width: 854,
        height: 480,
      },
      { assetId: ids.video, name: '720', status: 'processing', progress: 40, recipe: 'x' },
    ]);
    ids.processing = await file(project.id, { status: 'processing' });
    ids.otherProject = await file(other.id, { createdBy: people.outsider?.id ?? null });
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('answers each id as GET /assets/{id} does, for every kind of person', async () => {
    const asked = Object.values(ids);
    const seen: Record<string, string[]> = {};
    for (const who of WHO) {
      const res = await lookup(who, asked);
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Asset[];
      const byId = new Map(items.map((a) => [a.id, a]));
      expect(byId.size).toBe(items.length);
      for (const id of asked) {
        const single = await request('GET', `/assets/${id}`, who);
        if (single.statusCode === 200) expect(byId.get(id)).toEqual(single.json());
        else {
          // 403 only for a file of the project of the role the app does not know.
          const oddFile = who === 'oddRole' && id !== ids.missing && id !== ids.otherProject;
          expect(single.statusCode).toBe(oddFile ? 403 : 404);
          expect(byId.has(id)).toBe(false);
        }
      }
      seen[who] = Object.keys(ids)
        .filter((name) => byId.has(ids[name] as string))
        .sort();
    }
    const inProject = ['image', 'processing', 'video'];
    // A grant on one board reads every file of the project, as the single route does.
    expect(seen).toEqual({
      owner: inProject,
      member: inProject,
      granted: inProject,
      trashedGrant: [],
      expiredMember: [],
      oddRole: [],
      token: inProject,
      expiredGrant: [],
      outsider: ['otherProject'],
    });
  });

  it('carries variants, the playable copy and the rungs of a video', async () => {
    const items = (await lookup('granted', [ids.video, ids.image, ids.processing])).json()
      .items as Asset[];
    const get = (id: string | undefined) => items.find((a) => a.id === id);
    expect(get(ids.image)?.variants.map((v) => v.size)).toEqual(['256', '512']);
    expect(get(ids.video)?.proxy?.status).toBe('processing');
    expect(get(ids.video)?.playback?.renditions.map((r) => [r.name, r.status])).toEqual([
      ['480', 'ready'],
      ['720', 'processing'],
    ]);
    expect(get(ids.processing)).toMatchObject({ status: 'processing', variants: [] });
    expect(get(ids.image)).not.toHaveProperty('playback');
  });

  it('reads whether each rung has a playlist, never the playlist itself', async () => {
    const rungs = await renditionsOf(db, [ids.video as string]);
    expect(rungs.map((r) => [r.name, r.hasPlaylist]).sort()).toEqual([
      ['480', true],
      ['720', false],
    ]);
    for (const r of rungs) expect(r).not.toHaveProperty('playlist');
  });

  it('counts repeated ids once and runs the same queries for 1 or many files', async () => {
    const res = await lookup('owner', [ids.image, ids.image, ids.image?.toUpperCase()]);
    expect(res.json().items.map((a: Asset) => a.id)).toEqual([ids.image]);
    const select = vi.spyOn(db, 'select');
    try {
      // One video asks for variants and rungs, as many files do.
      await lookup('owner', [ids.video]);
      const one = select.mock.calls.length;
      select.mockClear();
      const many = await lookup('owner', Object.values(ids));
      expect(many.json().items).toHaveLength(3);
      expect(select.mock.calls.length).toBe(one);
      select.mockClear();
      await lookup('owner', [ids.missing]);
      // Nothing readable: the asset query alone, no variants nor rungs.
      expect(select.mock.calls.length).toBeLessThan(one);
    } finally {
      select.mockRestore();
    }
  });

  it('refuses empty, oversized and malformed lists, and strangers', async () => {
    const many = Array.from({ length: 201 }, () => randomUUID());
    expect((await lookup('owner', many)).statusCode).toBe(400);
    expect((await lookup('owner', many.slice(0, 200))).statusCode).toBe(200);
    expect((await lookup('owner', [])).statusCode).toBe(400);
    expect((await lookup('owner', ['nope'])).statusCode).toBe(400);
    expect((await request('POST', '/assets/lookup', 'owner', {})).statusCode).toBe(400);
    expect((await lookup(null, [ids.image])).statusCode).toBe(401);
    // A deactivated account is refused by both routes, before any lookup.
    expect((await lookup('deactivated', [ids.image])).statusCode).toBe(200);
    await db
      .update(user)
      .set({ deactivatedAt: new Date() })
      .where(eq(user.id, people.deactivated?.id as string));
    expect((await lookup('deactivated', [ids.image])).statusCode).toBe(401);
    expect((await request('GET', `/assets/${ids.image}`, 'deactivated')).statusCode).toBe(401);
  });

  it('refuses a body over 16 KiB, and the 121st lookup of a minute with Retry-After', async () => {
    const big = await request('POST', '/assets/lookup', 'limited', {
      ids: [ids.image],
      padding: 'x'.repeat(17 * 1024),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('payload_too_large');
    for (let i = 0; i < 120; i++)
      expect((await lookup('limited', [ids.otherProject])).statusCode).toBe(200);
    const limited = await lookup('limited', [ids.otherProject]);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('is advertised on /instance/version', async () => {
    const res = await request('GET', '/instance/version', 'owner');
    expect(res.json().capabilities).toContain(ASSET_LOOKUP_CAPABILITY);
  });
});
