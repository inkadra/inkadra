import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { addElement, createBoardDoc } from '@inkadra/doc-schema';
import { InstanceBackups } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import {
  BUCKET_PREFIX,
  backupCron,
  backupsDir,
  copyReadable,
  copyWritable,
  nextBackupAt,
  reapStaleBackups,
  restoreBackup,
  resumeWhenDone,
  runBackup,
  STALE_MS,
  startBackup,
} from '../backup.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import { board, boardDoc, comment, instanceBackup, instanceSetting } from '../db/schema.ts';
import { createStorage } from '../storage.ts';
import { freshDatabase, testDeps } from '../test-deps.ts';
import { readZip, writeZip } from '../transfers/zip.ts';
import { createApp } from './app.ts';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.DATABASE_URL;

describe('COPY streams of postgres.js', () => {
  it('resume their socket once they end, even when they ended full', async () => {
    // Like postgres.js: read() resumes the socket; data arrives faster than it is read.
    let resumes = 0;
    const source = new Readable({
      highWaterMark: 16,
      read() {
        resumes += 1;
      },
    });
    expect(source.push(Buffer.alloc(64))).toBe(false); // full: the socket is paused
    source.push(null); // CopyDone arrived in the same chunk
    resumeWhenDone(source);
    const before = resumes;
    for await (const _ of source);
    await new Promise((r) => setImmediate(r));
    expect(resumes).toBeGreaterThan(before);
  });
});

describe('backup schedule', () => {
  it('turns the time into a daily cron pattern and the next start', () => {
    const settings = { enabled: true, time: '03:15', retention: 7 };
    expect(backupCron(settings)).toBe('15 3 * * *');
    const from = new Date(2026, 9, 30, 4, 0);
    expect(nextBackupAt(settings, from)).toEqual(new Date(2026, 9, 31, 3, 15));
    expect(nextBackupAt(settings, new Date(2026, 9, 30, 1, 0))).toEqual(
      new Date(2026, 9, 30, 3, 15),
    );
    expect(nextBackupAt({ ...settings, enabled: false }, from)).toBeNull();
  });
});

describe.skipIf(!url)('instance backups (needs DATABASE_URL)', () => {
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
  let deps: ReturnType<typeof testDeps>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let rootBoardId = '';

  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const backupDeps = () => ({
    db,
    storage: deps.storage,
    dataDir: deps.root,
    migrationsFolder: migrations,
    bucket: false,
    databaseUrl: config.DATABASE_URL,
    log,
  });

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(
      sql`truncate table "user", project, instance_setting, instance_backup cascade`,
    );
    deps = testDeps(db, log);
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth: createAuth(config, db),
      log,
      ...deps,
    });
    for (const name of ['admin', 'member']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      people[name] = {
        id: response.json().user.id,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    const project = await request('admin', 'POST', '/projects', { name: 'Last Train' });
    rootBoardId = project.json().rootBoardId;
    const doc = createBoardDoc(rootBoardId);
    addElement(doc, {
      id: 'note-000001',
      type: 'note',
      x: 0,
      y: 0,
      w: 200,
      z: 'a0',
      parent: null,
      createdAt: 1,
      createdBy: null,
    });
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: rootBoardId, state, schemaVersion: 4, size: state.byteLength });
    // Rows written after the rows they point to, then the parents rewritten, so a plain
    // COPY in storage order would put children first and fail on restore.
    const projectId = project.json().id as string;
    const [child] = await db
      .insert(board)
      .values({ projectId, parentBoardId: rootBoardId, title: 'Scene 1', position: 'a1' })
      .returning();
    const [thread] = await db
      .insert(comment)
      .values({ projectId, boardId: child?.id as string, body: 'Where is the train?' })
      .returning();
    await db.insert(comment).values({
      projectId,
      boardId: child?.id as string,
      threadId: thread?.id,
      body: 'Platform 4',
    });
    await db.update(board).set({ title: 'Last Train' }).where(eq(board.id, rootBoardId));
    await db
      .update(comment)
      .set({ editedAt: new Date() })
      .where(eq(comment.id, thread?.id as string));
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('is for administrators only', async () => {
    expect((await request('member', 'GET', '/instance/backups')).statusCode).toBe(403);
    expect((await request('member', 'POST', '/instance/backups')).statusCode).toBe(403);
    expect((await request(null, 'GET', '/instance/backups')).statusCode).toBe(401);
  });

  it('reads and saves the settings, with defaults first', async () => {
    const first = InstanceBackups.parse(
      (await request('admin', 'GET', '/instance/backups')).json(),
    );
    expect(first.settings).toEqual({ enabled: true, time: '03:00', retention: 7 });
    expect(first.bucket).toBe(false);
    const saved = await request('admin', 'PATCH', '/instance/backups/settings', {
      time: '02:30',
      retention: 3,
    });
    expect(saved.json()).toEqual({ enabled: true, time: '02:30', retention: 3 });
    expect(
      (await request('admin', 'PATCH', '/instance/backups/settings', { time: '25:00' })).statusCode,
    ).toBe(400);
  });

  it('backs up now and lists the result', async () => {
    const started = await request('admin', 'POST', '/instance/backups');
    expect(started.statusCode).toBe(202);
    await deps.jobs.idle();
    const list = InstanceBackups.parse((await request('admin', 'GET', '/instance/backups')).json());
    const [latest] = list.items;
    expect(latest).toMatchObject({ trigger: 'manual', status: 'ready', copiedToBucket: false });
    expect(latest?.size).toBeGreaterThan(0);
    expect(existsSync(join(backupsDir(deps.root), latest?.fileName ?? ''))).toBe(true);
  });

  it('runs one backup at a time', async () => {
    const running = await startBackup(db, 'manual', null);
    expect(running).not.toBeNull();
    expect(await startBackup(db, 'scheduled', null)).toBeNull();
    expect((await request('admin', 'POST', '/instance/backups')).statusCode).toBe(409);
    await runBackup(backupDeps(), running?.id as string);
  });

  it('needs a signed-in administrator, never a personal token', async () => {
    const created = await request('admin', 'POST', '/me/tokens', { name: 'scripts' });
    expect(created.statusCode).toBe(201);
    const bearer = { authorization: `Bearer ${created.json().token}`, origin: config.PUBLIC_URL };
    for (const [method, path] of [
      ['GET', '/instance/backups'],
      ['POST', '/instance/backups'],
      ['PATCH', '/instance/backups/settings'],
    ] as const) {
      const res = await app.inject({
        method,
        url: `/api/v1${path}`,
        headers: bearer,
        ...(method === 'PATCH' ? { payload: { retention: 3 } } : {}),
      });
      expect(res.statusCode, `${method} ${path}`).toBe(403);
    }
    expect((await request('admin', 'GET', '/instance/backups')).statusCode).toBe(200);
  });

  it('fails a backup whose COPY breaks off, instead of leaving it running', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'copy_fail');
    await runMigrations(fresh, migrations);
    const admin = postgres(fresh, { max: 1, onnotice: () => {} });
    await admin`create table zz_large as select g as id, repeat('x', 200) as pad
      from generate_series(1, 300000) g`;
    const client = postgres(fresh, { max: 2, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    // The COPY of the large table is cancelled half-way, as a failing statement would be.
    let running = true;
    const killer = (async () => {
      while (running) {
        await admin`select pg_cancel_backend(pid) from pg_stat_activity
          where query ilike 'copy%zz_large%' and pid <> pg_backend_pid()`;
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    try {
      const row = await startBackup(other, 'manual', null);
      const done = await runBackup(
        { ...backupDeps(), db: other, databaseUrl: fresh },
        row?.id as string,
      );
      expect(done).toMatchObject({ status: 'failed' });
      const left = (await readdir(backupsDir(deps.root))).filter((f) => f.endsWith('.partial'));
      expect(left).toEqual([]);
    } finally {
      running = false;
      await killer;
      await admin.end({ timeout: 1 });
      await client.end({ timeout: 1 });
    }
  }, 60_000);

  it('rejects a COPY cancelled right as it starts without an unhandled error', async () => {
    const copy = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });
    const unhandled: unknown[] = [];
    const onUncaught = (err: unknown) => unhandled.push(err);
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
    try {
      await copy.unsafe(`
        create temp table zz_copy_in (x int);
        create function pg_temp.zz_cancel() returns trigger language plpgsql as
          'begin perform pg_cancel_backend(pg_backend_pid()); return null; end';
        create trigger zz_cancel before insert on zz_copy_in
          for each statement execute function pg_temp.zz_cancel();
      `);
      for (let i = 0; i < 50; i += 1) {
        // Cancelling in the first row or in a BEFORE STATEMENT trigger sends ErrorResponse
        // (57014) right after CopyOutResponse or CopyInResponse, so postgres.js may destroy the
        // stream on nextTick before await resumes. The 57014 assertion holds whichever way the
        // race goes: either guardCopyStream rejects before await, or consuming the stream does.
        const out = async () => {
          const stream = await copyReadable(
            copy.unsafe(
              'copy (select pg_cancel_backend(pg_backend_pid()), g from generate_series(1, 10) g) to stdout',
            ),
          );
          for await (const _ of stream);
        };
        await expect(out()).rejects.toMatchObject({ code: '57014' });

        const into = async () => {
          const sink = await copyWritable(copy.unsafe('copy zz_copy_in from stdin'));
          await pipeline(Readable.from(['1\n']), sink);
        };
        await expect(into()).rejects.toMatchObject({ code: '57014' });
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUncaught);
      await copy.end({ timeout: 1 });
    }
  }, 60_000);

  it('finishes a backup whose large tables fill the COPY streams', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'large_tables');
    await runMigrations(fresh, migrations);
    const admin = postgres(fresh, { max: 1, onnotice: () => {} });
    await admin`create table zz_large as select g as id, repeat('x', 200) as pad
      from generate_series(1, 300000) g`;
    await admin`create table zz_after (id int)`;
    await admin`insert into zz_after values (1)`;
    await admin.end();
    const client = postgres(fresh, { max: 2, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    try {
      const row = await startBackup(other, 'manual', null);
      const done = await runBackup(
        { ...backupDeps(), db: other, databaseUrl: fresh, stallMs: 20_000 },
        row?.id as string,
      );
      expect(done).toMatchObject({ status: 'ready', failure: null });
    } finally {
      await client.end({ timeout: 1 });
    }
  }, 60_000);

  it('backs up replies to replies parents first, and refuses boards in a cycle', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'orders');
    await runMigrations(fresh, migrations);
    const admin = postgres(fresh, { max: 1, onnotice: () => {} });
    const [p] = await admin`insert into project (name, position) values ('Last Train', 'a0')
      returning id`;
    const [root] = await admin`insert into board (project_id, title, position)
      values (${p?.id}, 'Last Train', 'a0') returning id`;
    // Ids chosen so that the reply to a reply sorts before the reply it answers.
    const start = '00000000-0000-4000-8000-00000000000a';
    const reply = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const nested = '11111111-1111-4111-8111-111111111111';
    await admin`insert into comment (id, project_id, board_id, body) values
      (${start}, ${p?.id}, ${root?.id}, 'Which platform?')`;
    await admin`insert into comment (id, project_id, board_id, thread_id, body) values
      (${reply}, ${p?.id}, ${root?.id}, ${start}, 'Four')`;
    await admin`insert into comment (id, project_id, board_id, thread_id, body) values
      (${nested}, ${p?.id}, ${root?.id}, ${reply}, 'Sure?')`;
    const client = postgres(fresh, { max: 2, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    const run = async () => {
      const row = await startBackup(other, 'manual', null);
      return runBackup({ ...backupDeps(), db: other, databaseUrl: fresh }, row?.id as string);
    };
    try {
      const done = await run();
      expect(done).toMatchObject({ status: 'ready' });
      // It restores: every comment comes after the one it answers.
      const target = await freshDatabase(config.DATABASE_URL, 'orders_restore');
      const report = await restoreBackup({
        file: join(backupsDir(deps.root), done?.fileName as string),
        databaseUrl: target,
        migrationsFolder: migrations,
        storage: deps.storage,
        tmpDir: join(deps.root, 'tmp'),
        log,
      });
      expect(report.rows).toBeGreaterThan(0);

      // Two boards that are each other's parent: no root reaches them.
      const [a] = await admin`insert into board (project_id, parent_board_id, title, position)
        values (${p?.id}, ${root?.id}, 'A', 'a1') returning id`;
      const [b] = await admin`insert into board (project_id, parent_board_id, title, position)
        values (${p?.id}, ${a?.id}, 'B', 'a2') returning id`;
      await admin`update board set parent_board_id = ${b?.id} where id = ${a?.id}`;
      expect(await run()).toMatchObject({ status: 'failed', failure: 'inconsistent' });
    } finally {
      await admin.end({ timeout: 1 });
      await client.end({ timeout: 1 });
    }
  }, 60_000);

  it('leaves the playable copies of videos out, as they can be made again', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'proxies');
    await runMigrations(fresh, migrations);
    const admin = postgres(fresh, { max: 1, onnotice: () => {} });
    const [p] = await admin`insert into project (name, position) values ('Rushes', 'a0')
      returning id`;
    const [a] = await admin`insert into asset (project_id, kind, mime, filename, size,
      storage_key, status, proxy_status, proxy_progress)
      values (${p?.id}, 'video', 'video/quicktime', 'A001.mov', 10, 'originals/x', 'ready',
        'ready', 100) returning id`;
    await admin`insert into asset_variant (asset_id, size, width, height, storage_key) values
      (${a?.id}, '256', 256, 144, ${`variants/${a?.id}/256.webp`}),
      (${a?.id}, 'proxy', 1920, 1080, ${`variants/${a?.id}/proxy.mp4`})`;
    const client = postgres(fresh, { max: 2, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    const target = await freshDatabase(config.DATABASE_URL, 'proxies_restore');
    const restored = postgres(target, { max: 1, onnotice: () => {} });
    try {
      const row = await startBackup(other, 'manual', null);
      const done = await runBackup(
        { ...backupDeps(), db: other, databaseUrl: fresh },
        row?.id as string,
      );
      expect(done).toMatchObject({ status: 'ready', fileCount: 2 });
      const report = await restoreBackup({
        file: join(backupsDir(deps.root), done?.fileName as string),
        databaseUrl: target,
        migrationsFolder: migrations,
        storage: deps.storage,
        tmpDir: join(deps.root, 'tmp'),
        log,
      });
      expect(report.files.listed).toBe(2);
      const sizes = await restored`select size from asset_variant`;
      expect(sizes.map((v) => v.size)).toEqual(['256']);
      const [back] = await restored`select proxy_status, proxy_progress from asset`;
      expect(back).toEqual({ proxy_status: 'skipped', proxy_progress: null });
    } finally {
      await admin.end({ timeout: 1 });
      await client.end({ timeout: 1 });
      await restored.end({ timeout: 1 });
    }
  }, 60_000);

  it('keeps a live but quiet backup when another worker starts', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'quiet');
    await runMigrations(fresh, migrations);
    const locker = postgres(fresh, { max: 1, onnotice: () => {} });
    await locker`create table zz_locked (id int)`;
    const client = postgres(fresh, { max: 3, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    const reserved = await locker.reserve();
    await reserved`begin`;
    await reserved`lock table zz_locked in access exclusive mode`;
    try {
      const row = await startBackup(other, 'manual', null);
      // No data moves while the COPY waits; the process is alive all the same.
      const running = runBackup(
        { ...backupDeps(), db: other, databaseUrl: fresh, stallMs: 30_000, heartbeatMs: 100 },
        row?.id as string,
      );
      await new Promise((r) => setTimeout(r, 1500));
      // A worker starting now reaps rows silent for longer than a second: not this one.
      expect(await reapStaleBackups(other, 1000)).toBe(0);
      await reserved`rollback`;
      expect(await running).toMatchObject({ status: 'ready', failure: null });
    } finally {
      reserved.release();
      await locker.end({ timeout: 1 });
      await client.end({ timeout: 1 });
    }
  }, 60_000);

  it('keeps the archive when the copy to the bucket fails, as not copied', async () => {
    const failing = {
      ...deps.storage,
      async writeStream() {
        throw new Error('bucket down');
      },
    };
    const row = await startBackup(db, 'manual', null);
    const done = await runBackup(
      { ...backupDeps(), storage: failing, bucket: true },
      row?.id as string,
    );
    expect(done).toMatchObject({ status: 'ready', copiedToBucket: false });
    expect(existsSync(join(backupsDir(deps.root), done?.fileName as string))).toBe(true);
  });

  it('never turns a backup marked over by someone else into ready', async () => {
    const row = await startBackup(db, 'manual', null);
    const id = row?.id as string;
    // While the archive is copied, another process decides this backup is over.
    const meanwhile = {
      ...deps.storage,
      async writeStream() {
        await db
          .update(instanceBackup)
          .set({ status: 'failed', failure: 'interrupted', finishedAt: new Date() })
          .where(eq(instanceBackup.id, id));
      },
    };
    expect(await runBackup({ ...backupDeps(), storage: meanwhile, bucket: true }, id)).toBeNull();
    const [after] = await db.select().from(instanceBackup).where(eq(instanceBackup.id, id));
    expect(after).toMatchObject({ status: 'failed', failure: 'interrupted' });
  });

  it('fails a backup that stops moving as stalled, with its reason', async () => {
    const fresh = await freshDatabase(config.DATABASE_URL, 'stalled');
    await runMigrations(fresh, migrations);
    const locker = postgres(fresh, { max: 1, onnotice: () => {} });
    await locker`create table zz_locked (id int)`;
    const client = postgres(fresh, { max: 2, onnotice: () => {} });
    const other = drizzle(client, { schema, casing: 'snake_case' });
    // Another session holds the table: the COPY waits and no data ever moves.
    const reserved = await locker.reserve();
    await reserved`begin`;
    await reserved`lock table zz_locked in access exclusive mode`;
    try {
      const row = await startBackup(other, 'manual', null);
      const done = await runBackup(
        { ...backupDeps(), db: other, databaseUrl: fresh, stallMs: 400 },
        row?.id as string,
      );
      expect(done).toMatchObject({ status: 'failed', failure: 'stalled' });
      const left = (await readdir(backupsDir(deps.root))).filter((f) => f.endsWith('.partial'));
      expect(left).toEqual([]);
    } finally {
      await reserved`rollback`;
      reserved.release();
      await locker.end({ timeout: 1 });
      await client.end({ timeout: 1 });
    }
  }, 60_000);

  it('never works on a backup that is no longer running (a job run again)', async () => {
    const row = await startBackup(db, 'manual', null);
    await db
      .update(instanceBackup)
      .set({ status: 'failed', failure: 'interrupted', finishedAt: new Date() })
      .where(eq(instanceBackup.id, row?.id as string));
    const before = (await readdir(backupsDir(deps.root))).length;
    expect(await runBackup(backupDeps(), row?.id as string)).toBeNull();
    const [after] = await db
      .select()
      .from(instanceBackup)
      .where(eq(instanceBackup.id, row?.id as string));
    expect(after).toMatchObject({ status: 'failed', failure: 'interrupted', fileName: null });
    expect((await readdir(backupsDir(deps.root))).length).toBe(before);
  });

  it('lists a backup left running by a dead process as interrupted', async () => {
    const stuck = await startBackup(db, 'manual', null);
    await db
      .update(instanceBackup)
      .set({ heartbeatAt: new Date(Date.now() - STALE_MS - 1000) })
      .where(eq(instanceBackup.id, stuck?.id as string));
    const list = InstanceBackups.parse((await request('admin', 'GET', '/instance/backups')).json());
    expect(list.items.find((b) => b.id === stuck?.id)).toMatchObject({
      status: 'failed',
      failure: 'interrupted',
    });
  });

  it('lets the next backup run when a running one stopped beating', async () => {
    const stuck = await startBackup(db, 'manual', null);
    await db
      .update(instanceBackup)
      .set({ heartbeatAt: new Date(Date.now() - STALE_MS - 1000) })
      .where(eq(instanceBackup.id, stuck?.id as string));
    const next = await startBackup(db, 'scheduled', null);
    expect(next).not.toBeNull();
    const [old] = await db
      .select()
      .from(instanceBackup)
      .where(eq(instanceBackup.id, stuck?.id as string));
    expect(old).toMatchObject({ status: 'failed', failure: 'interrupted' });
    await runBackup(backupDeps(), next?.id as string);
  });

  it('keeps only the configured number of backups', async () => {
    await request('admin', 'PATCH', '/instance/backups/settings', { retention: 1 });
    const row = await startBackup(db, 'manual', null);
    const done = await runBackup(backupDeps(), row?.id as string);
    expect(done?.status).toBe('ready');
    const rows = await db.select().from(instanceBackup);
    const kept = rows.filter((r) => r.status === 'ready' && r.removedAt === null);
    expect(kept.map((r) => r.id)).toEqual([row?.id]);
    for (const r of rows.filter((r) => r.removedAt !== null))
      expect(existsSync(join(backupsDir(deps.root), r.fileName ?? ''))).toBe(false);
  });

  it('restores into an empty database with the same data, and refuses a used one', async () => {
    const [row] = await db
      .select()
      .from(instanceBackup)
      .where(and(eq(instanceBackup.status, 'ready'), isNull(instanceBackup.removedAt)));
    const file = join(backupsDir(deps.root), row?.fileName as string);
    const restore = (databaseUrl: string) =>
      restoreBackup({
        file,
        databaseUrl,
        migrationsFolder: migrations,
        storage: deps.storage,
        tmpDir: join(deps.root, 'tmp'),
        log,
      });
    await expect(restore(config.DATABASE_URL)).rejects.toThrow(/not empty/);

    const fresh = await freshDatabase(config.DATABASE_URL, 'restore');
    const report = await restore(fresh);
    expect(report.rows).toBeGreaterThan(0);
    expect(report.files).toMatchObject({ missing: 0 });
    const { db: restored, sql: restoredClient } = createDatabase(fresh, 1);
    try {
      const count = async (d: typeof db, table: string) =>
        (await d.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"`)))[0]
          ?.n;
      for (const table of [
        'user',
        'account',
        'project',
        'project_member',
        'board',
        'board_doc',
        'comment',
        'instance_setting',
      ])
        expect(await count(restored, table), table).toBe(await count(db, table));
      const [a] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, rootBoardId));
      const [b] = await restored.select().from(boardDoc).where(eq(boardDoc.boardId, rootBoardId));
      expect(b?.state).toEqual(a?.state);
      // Bookkeeping of backups is not carried over: the restored instance starts clean.
      expect(await count(restored, 'instance_backup')).toBe(0);
      // The search index is rebuilt from the documents by the startup backfill.
      expect(await count(restored, 'board_element_index')).toBe(0);
      const [indexed] = await restored.select().from(boardDoc);
      expect(indexed?.indexedAt).toBeNull();
    } finally {
      await restoredClient.end({ timeout: 1 });
    }
  });

  it('fails a restore whose archive lacks a table entry, rolling back with no COPY left open', async () => {
    const [row] = await db
      .select()
      .from(instanceBackup)
      .where(and(eq(instanceBackup.status, 'ready'), isNull(instanceBackup.removedAt)));
    const file = join(backupsDir(deps.root), row?.fileName as string);
    // The same archive without the entry of its last table: the manifest still lists it, so the
    // restore opens the COPY FROM for that table, then fails to open the entry.
    const source = await readZip(file, {
      entries: 10_000,
      totalBytes: Number.MAX_SAFE_INTEGER,
      compressionRatio: 10_000,
    });
    const broken = join(deps.root, 'tmp', 'missing-entry.zip');
    try {
      const manifest = JSON.parse(
        (await source.buffer('manifest.json', 64 * 1024 * 1024)).toString(),
      );
      const dropped = manifest.tables.at(-1).entry as string;
      await mkdir(join(deps.root, 'tmp'), { recursive: true });
      const writer = writeZip(broken);
      for (const name of source.names())
        if (name !== dropped) await writer.addBuffer(name, await source.buffer(name, 1024 ** 3));
      await writer.close();
    } finally {
      source.close();
    }

    const fresh = await freshDatabase(config.DATABASE_URL, 'restore_missing');
    // Before the fix the open COPY made the ROLLBACK hang or fail with COPY_IN_PROGRESS.
    await expect(
      restoreBackup({
        file: broken,
        databaseUrl: fresh,
        migrationsFolder: migrations,
        storage: deps.storage,
        tmpDir: join(deps.root, 'tmp'),
        log,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_archive', message: /Missing entry/ });
    const { sql: after } = createDatabase(fresh, 1);
    try {
      const [people] = await after<{ n: number }[]>`select count(*)::int as n from "user"`;
      expect(people?.n).toBe(0);
    } finally {
      await after.end({ timeout: 1 });
    }
  });
});

// Against RustFS or another S3 server, as the storage tests: S3_TEST_ENDPOINT and friends.
const s3Endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!url || !s3Endpoint)('backups with files in S3 (needs S3_TEST_ENDPOINT)', () => {
  it('copies the archive to backups/ in the bucket and removes it with retention', async () => {
    const config = loadConfig({
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: url as string,
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: s3Endpoint,
      S3_BUCKET: process.env.S3_TEST_BUCKET ?? 'inkadra',
      S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: 'true',
    });
    const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
    const log = pino({ level: 'silent' });
    try {
      await runMigrations(config.DATABASE_URL, migrations);
      await db.execute(sql`truncate table instance_backup`);
      const deps = {
        db,
        storage: createStorage(config),
        dataDir: testDeps(db, log).root,
        migrationsFolder: migrations,
        bucket: true,
        databaseUrl: config.DATABASE_URL,
        log,
      };
      const first = await startBackup(db, 'manual', null);
      const done = await runBackup(deps, first?.id as string);
      expect(done).toMatchObject({ status: 'ready', copiedToBucket: true });
      const key = `${BUCKET_PREFIX}${done?.fileName}`;
      expect(await deps.storage.size(key)).toBe(done?.size);

      await db
        .insert(instanceSetting)
        .values({ key: 'backup', value: { retention: 1 } })
        .onConflictDoUpdate({ target: instanceSetting.key, set: { value: { retention: 1 } } });
      const second = await startBackup(db, 'manual', null);
      const next = await runBackup(deps, second?.id as string);
      expect(await deps.storage.size(key)).toBeNull();
      await deps.storage.remove([`${BUCKET_PREFIX}${next?.fileName}`]);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
