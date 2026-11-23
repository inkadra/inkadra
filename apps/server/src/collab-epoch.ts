import { sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { collabEpoch } from './db/schema.ts';
import { lockCollabEpoch } from './locks.ts';

/**
 * Fencing token of the collab lease (lease.ts). A collab process cut off from Valkey, or paused,
 * keeps its boards in memory while a newer process may already have taken the lease and serve
 * the same boards: both would write whole documents over each other. Each collab process takes
 * a new epoch at start, after its lease and before opening any board, and every board write
 * takes the epoch lock shared (level 0 in locks.ts) in its own transaction and goes on only while
 * its own epoch is the one recorded. Taking an epoch holds that lock exclusively, so it waits for
 * the writes in flight, and every later write of an older process is refused by the database
 * itself. An advisory lock rather than the row's own: a start waiting for it is queued in front
 * of later writers (a `FOR SHARE` row lock lets them join and keeps the update waiting).
 *
 * The epoch lives in PostgreSQL, next to the documents it guards, rather than in Valkey: Valkey
 * may run without persistence, and a counter that starts again from zero would refuse every write.
 */
export class StaleCollabEpochError extends Error {}

/** This process lost its lease before it took an epoch: another collab process took over. */
export class CollabLeaseLostError extends Error {}

/**
 * The longest a fenced write may hold the epoch row: each statement, and each idle moment in its
 * transaction (a process paused in the middle of a write has its session ended), as a board store.
 */
export const FENCED_WRITE_MS = 15_000;

/** How long a start waits, in total, for the epoch row behind the writes of a previous process. */
const TAKE_EPOCH_MS = 5 * 60_000;

/** PostgreSQL's lock_not_available, raised by `lock_timeout`. */
const lockTimedOut = (err: unknown) => {
  for (let e = err; e; e = (e as { cause?: unknown }).cause)
    if ((e as { code?: string }).code === '55P03') return true;
  return false;
};

/**
 * Takes the next epoch, newer than every collab process before this one. `lease`, when this
 * process holds one, is confirmed before and after: a process that lost it while starting (cut
 * off during a long wait for the migrations) takes no epoch and must not serve, or it would fence
 * out the process that holds the lease now. A confirmation that fails after the epoch was taken
 * stops both processes (their writes are refused) until one starts again; nothing is overwritten.
 *
 * Writes of a previous process in flight hold the lock shared, each at most `FENCED_WRITE_MS`:
 * the start waits for them a while (`lockMs`, above that limit, whatever the pool's
 * `lock_timeout`; never cut by its `statement_timeout`) and tries again, confirming its lease
 * before each try, until `TAKE_EPOCH_MS` passed.
 */
export async function takeCollabEpoch(
  db: Pick<Database, 'transaction'>,
  opts: {
    lease?: { confirm(): Promise<boolean> };
    log?: { warn: (obj: object, msg: string) => void };
    lockMs?: number;
  } = {},
): Promise<number> {
  const confirm = async () => {
    if (opts.lease && !(await opts.lease.confirm()))
      throw new CollabLeaseLostError(
        'Another collab process took the lease while this one was starting: this one stops.',
      );
  };
  const lockMs = opts.lockMs ?? FENCED_WRITE_MS + 5_000;
  const giveUp = Date.now() + TAKE_EPOCH_MS;
  for (;;) {
    await confirm();
    try {
      const epoch = await db.transaction(async (tx) => {
        await tx.execute(sql.raw('set local statement_timeout = 0'));
        await tx.execute(sql.raw(`set local lock_timeout = ${lockMs}`));
        await lockCollabEpoch(tx, 'exclusive');
        const [row] = await tx.execute<{ epoch: number }>(sql`
          insert into ${collabEpoch} (id, epoch) values (1, 1)
          on conflict (id) do update set epoch = ${collabEpoch}.epoch + 1
          returning epoch`);
        if (!row) throw new Error('no collab epoch taken');
        return row.epoch;
      });
      await confirm();
      return epoch;
    } catch (err) {
      if (!lockTimedOut(err) || Date.now() >= giveUp) throw err;
      opts.log?.warn(
        { lockMs },
        'waiting for the board writes of the previous collab process to end before serving boards',
      );
    }
  }
}

/**
 * Inside a write transaction, first: limits how long it may hold the epoch lock
 * (`FENCED_WRITE_MS`), holds it shared until the commit and throws `StaleCollabEpochError` unless
 * the recorded epoch is this process's own. A missing row or an older epoch (a database restored
 * under a running process) refuses too. Without an epoch (tests, tools that write boards on their
 * own) it checks nothing.
 */
export async function fenceCollabWrite(
  tx: Pick<Database, 'execute'>,
  epoch: number | undefined,
  limitMs = FENCED_WRITE_MS,
) {
  if (epoch === undefined) return;
  await tx.execute(sql.raw(`set local statement_timeout = ${limitMs}`));
  await tx.execute(sql.raw(`set local idle_in_transaction_session_timeout = ${limitMs}`));
  await lockCollabEpoch(tx, 'shared');
  const [row] = await tx.execute<{ epoch: number }>(
    sql`select epoch from ${collabEpoch} where id = 1`,
  );
  if (row?.epoch !== epoch)
    throw new StaleCollabEpochError(
      `the collab epoch recorded is ${row ? row.epoch : 'missing'}, not this process's ${epoch}: ` +
        'another collab process took over',
    );
}
