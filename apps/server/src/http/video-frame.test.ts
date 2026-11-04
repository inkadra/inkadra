import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import { extractVideoFrame } from '../media/video.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

vi.mock('../media/video.ts', async (original) => ({
  ...(await original<typeof import('../media/video.ts')>()),
  mediaTools: async () => ({ ffmpeg: 'ffmpeg' }),
  extractVideoFrame: vi.fn(),
}));
const extract = vi.mocked(extractVideoFrame);

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('frame of a video: limits (needs DATABASE_URL)', () => {
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

  /** A new person, as limits are per person, with a project and a ready video of 10 seconds. */
  async function person(name: string) {
    const signedUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
    });
    const cookie = String(signedUp.headers['set-cookie']).split(';')[0] ?? '';
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: { name },
    });
    const [row] = await db
      .insert(asset)
      .values({
        projectId: project.json().id,
        kind: 'video',
        mime: 'video/mp4',
        filename: 'video.mp4',
        size: 10,
        storageKey: `frame-${name}`,
        status: 'ready',
        durationMs: 10_000,
      })
      .returning();
    return { cookie, id: row?.id as string };
  }
  const frame = (who: { cookie: string; id: string }, time = 1) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/assets/${who.id}/frame?time=${time}`,
      headers: { cookie: who.cookie },
    });

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, join(import.meta.dirname, '..', '..', 'drizzle'));
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
  });
  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it('stops one person after the limit of a minute, before any work', async () => {
    const who = await person('limited');
    for (let i = 0; i < 12; i += 1) expect((await frame(who, 99)).statusCode).toBe(404);
    expect((await frame(who, 1)).statusCode).toBe(429);
    expect(extract).not.toHaveBeenCalled();
  });

  it('runs two extractions at a time, streams the result and frees the slots', async () => {
    const who = await person('busy');
    const release: Array<() => void> = [];
    extract.mockImplementation(async (_ffmpeg, _file, out) => {
      await writeFile(out, 'picture');
      await new Promise<void>((resolve) => release.push(resolve));
    });
    const running = [frame(who), frame(who)];
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect((await frame(who)).statusCode).toBe(429);
    for (const go of release) go();
    for (const response of await Promise.all(running)) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.body).toBe('picture');
    }
    extract.mockImplementation(async (_ffmpeg, _file, out) => writeFile(out, 'again'));
    expect((await frame(who)).body).toBe('again');
  });

  it('stops the work when the client goes away and frees the slot', async () => {
    const who = await person('gone');
    let signal: AbortSignal | undefined;
    extract.mockImplementationOnce(async (_ffmpeg, _file, _out, _time, _container, s) => {
      signal = s;
      await new Promise((_resolve, reject) => {
        s?.addEventListener('abort', () => reject(new Error('killed')));
      });
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const leaving = new AbortController();
    const asked = fetch(`http://127.0.0.1:${port}/api/v1/assets/${who.id}/frame?time=1`, {
      headers: { cookie: who.cookie },
      signal: leaving.signal,
    }).catch(() => null);
    await vi.waitFor(() => expect(signal).toBeDefined());
    leaving.abort();
    await asked;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    extract.mockImplementation(async (_ffmpeg, _file, out) => writeFile(out, 'next'));
    await vi.waitFor(async () => expect((await frame(who)).statusCode).toBe(200));
  });
});
