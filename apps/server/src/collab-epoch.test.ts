import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import IORedis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  CollabLeaseLostError,
  fenceCollabWrite,
  StaleCollabEpochError,
  takeCollabEpoch,
} from './collab-epoch.ts';
import { createDatabase } from './db/client.ts';
import { acquireLease, leaseKey } from './lease.ts';
import { lockCollabEpoch } from './locks.ts';
import { freshDatabase } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));

describe.skipIf(!url)('collab epoch (needs DATABASE_URL)', () => {
  it('upgrades a database of the last release: boards kept, the first start takes epoch 1', async () => {
    // The migrations up to 0057, as a database made before this one has them.
    const before = mkdtempSync(join(tmpdir(), 'inkadra-0058-'));
    cpSync(folder, before, { recursive: true });
    const journal = JSON.parse(readFileSync(join(before, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 58);
    writeFileSync(join(before, 'meta/_journal.json'), JSON.stringify(journal));
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epoch0058'), 1);
    try {
      await migrate(db, { migrationsFolder: before });
      await db.execute(sql`
        with p as (insert into project (name, position) values ('P', 'a0') returning id),
        b as (insert into board (project_id, title, position) select id, 'B', 'a0' from p returning id)
        insert into board_doc (board_id, state, schema_version, size)
        select id, '\\x00'::bytea, 1, 1 from b`);
      await migrate(db, { migrationsFolder: folder });
      expect((await db.execute(sql`select count(*)::int as n from board_doc`))[0]).toEqual({
        n: 1,
      });
      const first = await takeCollabEpoch(db);
      expect(first).toBe(1);
      await db.transaction((tx) => fenceCollabWrite(tx, first));
      expect(await takeCollabEpoch(db)).toBe(2);
      await expect(db.transaction((tx) => fenceCollabWrite(tx, first))).rejects.toThrow(
        StaleCollabEpochError,
      );
    } finally {
      await client.end({ timeout: 1 });
      rmSync(before, { recursive: true, force: true });
    }
  });

  it('makes a newer epoch wait for a write in flight, and refuses the older one after it', async () => {
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epochlock'), 3);
    try {
      await migrate(db, { migrationsFolder: folder });
      const old = await takeCollabEpoch(db);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // A store of the old holder, between its fence and its commit.
      const write = db.transaction(async (tx) => {
        await fenceCollabWrite(tx, old);
        locked();
        await held;
      });
      await isLocked;
      let taken: number | undefined;
      const newer = takeCollabEpoch(db).then((e) => {
        taken = e;
        return e;
      });
      await new Promise((r) => setTimeout(r, 300));
      // The new holder waits: whatever the old one is writing lands before it opens any board.
      expect(taken).toBeUndefined();
      release();
      await write;
      expect(await newer).toBe(old + 1);
      await expect(db.transaction((tx) => fenceCollabWrite(tx, old))).rejects.toThrow(
        StaleCollabEpochError,
      );
      await db.transaction((tx) => fenceCollabWrite(tx, old + 1));
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('refuses a write when the epoch row is missing or older than its own (a restored database)', async () => {
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epochclosed'), 1);
    try {
      await migrate(db, { migrationsFolder: folder });
      await takeCollabEpoch(db);
      await takeCollabEpoch(db);
      const mine = await takeCollabEpoch(db);
      await db.transaction((tx) => fenceCollabWrite(tx, mine));
      await db.execute(sql`delete from collab_epoch`);
      await expect(db.transaction((tx) => fenceCollabWrite(tx, mine))).rejects.toThrow(
        StaleCollabEpochError,
      );
      await db.execute(sql`insert into collab_epoch (id, epoch) values (1, ${mine - 2})`);
      await expect(db.transaction((tx) => fenceCollabWrite(tx, mine))).rejects.toThrow(
        StaleCollabEpochError,
      );
      // The next start takes a newer one and writes again.
      const next = await takeCollabEpoch(db);
      await db.transaction((tx) => fenceCollabWrite(tx, next));
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('makes a write wait for a newer epoch being taken, then refuses it', async () => {
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epochwait'), 3);
    try {
      await migrate(db, { migrationsFolder: folder });
      const old = await takeCollabEpoch(db);
      let commit = () => {};
      const committed = new Promise<void>((resolve) => {
        commit = resolve;
      });
      let bumped = () => {};
      const isBumped = new Promise<void>((resolve) => {
        bumped = resolve;
      });
      // A newer process taking its epoch, not committed yet.
      const taking = db.transaction(async (tx) => {
        await lockCollabEpoch(tx, 'exclusive');
        await tx.execute(sql`update collab_epoch set epoch = epoch + 1 where id = 1`);
        bumped();
        await committed;
      });
      await isBumped;
      let settled = false;
      const write = db
        .transaction((tx) => fenceCollabWrite(tx, old))
        .finally(() => {
          settled = true;
        });
      write.catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      commit();
      await taking;
      await expect(write).rejects.toThrow(StaleCollabEpochError);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('takes its epoch past writes that outlast the pool lock timeout, ending an idle one', async () => {
    const target = await freshDatabase(url ?? '', 'epochslow');
    const setup = createDatabase(target, 1);
    await migrate(setup.db, { migrationsFolder: folder });
    await setup.sql.end({ timeout: 1 });
    // The server's pool: a lock waited for longer than 200 ms fails (55P03).
    const { db, sql: client } = createDatabase(target, 3, { lockMs: 200 });
    try {
      const old = await takeCollabEpoch(db);
      // A write of the old holder that was paused after its fence: its session is ended once
      // idle for longer than the fenced limit, which frees the epoch row.
      let locked = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const paused = db.transaction(async (tx) => {
        await fenceCollabWrite(tx, old, 800);
        locked();
        await new Promise((r) => setTimeout(r, 3000));
        await tx.execute(sql`select 1`);
      });
      paused.catch(() => {});
      await isLocked;
      const log = { warn: vi.fn() };
      const started = Date.now();
      expect(await takeCollabEpoch(db, { log, lockMs: 300 })).toBe(old + 1);
      expect(Date.now() - started).toBeLessThan(2500);
      expect(log.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/waiting for the board writes of the previous collab process/),
      );
      await expect(paused).rejects.toThrow();
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('confirms its lease before every try, taking no epoch once it was lost while waiting', async () => {
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epochretry'), 3);
    try {
      await migrate(db, { migrationsFolder: folder });
      const old = await takeCollabEpoch(db);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const write = db.transaction(async (tx) => {
        await fenceCollabWrite(tx, old, 5000);
        locked();
        await held;
      });
      await isLocked;
      // Held at the first try, lost by the second (the write still holds the lock).
      const lease = { confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false) };
      const taking = takeCollabEpoch(db, { lease, lockMs: 200 });
      taking.catch(() => {});
      await vi.waitFor(() => expect(lease.confirm).toHaveBeenCalledTimes(2), { timeout: 3000 });
      release();
      await write;
      await expect(taking).rejects.toThrow(CollabLeaseLostError);
      const [row] = await db.execute<{ epoch: number }>(sql`select epoch from collab_epoch`);
      expect(row?.epoch).toBe(old);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('takes its epoch while fenced writes keep overlapping, instead of waiting behind them', async () => {
    const target = await freshDatabase(url ?? '', 'epochbusy');
    const setup = createDatabase(target, 1);
    await migrate(setup.db, { migrationsFolder: folder });
    await setup.sql.end({ timeout: 1 });
    // The server's pool limits, short: a start never waits on its statement timeout.
    const { db, sql: client } = createDatabase(target, 6, { statementMs: 2000, lockMs: 500 });
    let busy = true;
    try {
      const old = await takeCollabEpoch(db);
      // Three stores of the old holder that always overlap, each holding the fence 200 ms.
      const writer = async (delay: number) => {
        await new Promise((r) => setTimeout(r, delay));
        while (busy)
          await db
            .transaction(async (tx) => {
              await fenceCollabWrite(tx, old);
              await new Promise((r) => setTimeout(r, 200));
            })
            .catch(() => new Promise((r) => setTimeout(r, 50)));
      };
      const writers = Promise.all([writer(0), writer(70), writer(140)]);
      await new Promise((r) => setTimeout(r, 300));
      const started = Date.now();
      expect(await takeCollabEpoch(db, { lockMs: 500 })).toBe(old + 1);
      expect(Date.now() - started).toBeLessThan(1500);
      // Every later write of the old holder is refused.
      await expect(db.transaction((tx) => fenceCollabWrite(tx, old))).rejects.toThrow(
        StaleCollabEpochError,
      );
      busy = false;
      await writers;
    } finally {
      busy = false;
      await client.end({ timeout: 1 });
    }
  });
});

describe.skipIf(!url || !process.env.REDIS_URL)('collab epoch and lease (needs Valkey)', () => {
  it('takes no epoch once another process took its lease while it started', async () => {
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'epochlease'), 1);
    const redis = new IORedis(process.env.REDIS_URL!);
    // A role name of its own, so parallel runs on one Valkey never meet.
    const role = `collab-${randomUUID()}` as 'collab';
    try {
      await migrate(db, { migrationsFolder: folder });
      const before = await takeCollabEpoch(db);
      const lease = await acquireLease(
        redis,
        role,
        { warn: vi.fn(), error: vi.fn() },
        {
          host: 'a',
          onLost: vi.fn(),
        },
      );
      // While it waited for the migrations, it was cut off long enough for another to start.
      await redis.set(leaseKey(role), 'newer/1/x');
      await expect(takeCollabEpoch(db, { lease })).rejects.toThrow(CollabLeaseLostError);
      const [row] = await db.execute<{ epoch: number }>(sql`select epoch from collab_epoch`);
      expect(row?.epoch).toBe(before);
      await lease.release();
      await redis.del(leaseKey(role));
      const own = await acquireLease(
        redis,
        role,
        { warn: vi.fn(), error: vi.fn() },
        {
          host: 'b',
          onLost: vi.fn(),
        },
      );
      expect(await takeCollabEpoch(db, { lease: own })).toBe(before + 1);
      await own.release();
    } finally {
      await redis.del(leaseKey(role));
      redis.disconnect();
      await client.end({ timeout: 1 });
    }
  });
});

describe.skipIf(!url || !process.env.REDIS_URL)('a start that fails (needs Valkey)', () => {
  it('releases its lease instead of leaving it for the next start to wait out', async () => {
    // A Valkey database of its own, so the fixed key of the web lease meets no other run.
    const isolated = new URL(process.env.REDIS_URL!);
    isolated.pathname = `/${1 + Math.floor(Math.random() * 15)}`;
    const redis = new IORedis(isolated.toString());
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-start-'));
    try {
      expect(await redis.exists(leaseKey('web'))).toBe(0);
      // A backup folder that cannot be made fails the start right after the lease (#899).
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./main.ts', import.meta.url)), 'web'],
        {
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            LOG_LEVEL: 'fatal',
            PUBLIC_URL: 'http://localhost:3000',
            DATABASE_URL: url,
            REDIS_URL: isolated.toString(),
            AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
            DATA_DIR: dir,
            BACKUP_DIR: '/dev/null/backups',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let out = '';
      child.stdout.on('data', (d) => {
        out += String(d);
      });
      child.stderr.on('data', (d) => {
        out += String(d);
      });
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
      expect(code, out).toBe(1);
      expect(out).toContain('/dev/null/backups cannot be written');
      expect(await redis.exists(leaseKey('web'))).toBe(0);
    } finally {
      await redis.del(leaseKey('web'));
      redis.disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
