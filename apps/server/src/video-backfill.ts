import { VIDEO_RUNGS, type VideoBackfill } from '@inkadra/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import type { Jobs } from './jobs.ts';
import type { Recipes } from './media/ladder.ts';

type Reader = Pick<Database, 'select' | 'execute'>;

/** Key of the regeneration in `instance_setting` (decision 0128). */
const KEY = 'video-backfill';
/** Assets queued at a time; the next block waits for the queue to drain. */
export const BACKFILL_BLOCK = 200;
/** Queued regenerations past which the next block waits. */
const BACKLOG = 50;

interface State {
  scope: 'missing' | 'outdated';
  status: 'running' | 'stopped' | 'done';
  total: number;
  queued: number;
  startedAt: string;
  /** The last asset id queued: blocks go by id. */
  cursor: string | null;
}

/**
 * Videos whose copies are missing although they would get the ladder now: none was made
 * (skipped by an older limit, failed, restored from a backup), or a heavy original that plays.
 * The worker decides for good (videoPlan); this only chooses whom to ask.
 */
const missing = (recipes: Recipes) => sql`(a.kind = 'video' and a.status = 'ready'
  and not exists(select 1 from asset_rendition r
    where r.asset_id = a.id and r.status = 'ready' and ${sameRecipe(recipes)})
  and not exists(select 1 from asset_variant v where v.asset_id = a.id and v.size = 'proxy')
  and (a.proxy_status in ('skipped', 'failed') or (a.proxy_status is null and (
    least(a.width, a.height) > 1080 or a.frame_rate > 60
    or (a.duration_ms > 0 and a.size * 8000.0 / a.duration_ms > 12000000)))))`;

/**
 * Videos with copies made otherwise: a single copy of before the ladder (not a remux of light
 * H.264, which stays as it is), or rungs of another recipe; and the missing ones.
 */
const outdated = (recipes: Recipes) => sql`(a.kind = 'video' and a.status = 'ready' and (
  ${missing(recipes)}
  or (exists(select 1 from asset_variant v where v.asset_id = a.id and v.size = 'proxy')
    and not (a.video_codec = 'h264' and least(a.width, a.height) <= 1080))
  or exists(select 1 from asset_rendition r where r.asset_id = a.id and not ${sameRecipe(recipes)})))`;

/** The rung `r` was made with the recipe of its name (custom values differ by rung). */
const sameRecipe = (recipes: Recipes) =>
  sql`(r.recipe = case r.name ${sql.join(
    VIDEO_RUNGS.map((name) => sql`when ${name} then ${recipes[name]}`),
    sql` `,
  )} end)`;

export const needsCopies = (scope: State['scope'], recipes: Recipes): SQL =>
  scope === 'missing' ? missing(recipes) : outdated(recipes);

export async function countNeeding(db: Reader, scope: State['scope'], recipes: Recipes) {
  const [row] = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from asset a where ${needsCopies(scope, recipes)}`,
  );
  return Number(row?.n ?? 0);
}

async function readState(db: Pick<Database, 'select'>): Promise<State | null> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const v = row?.value as Partial<State> | undefined;
  if (!v || (v.scope !== 'missing' && v.scope !== 'outdated') || typeof v.status !== 'string')
    return null;
  return {
    scope: v.scope,
    status: v.status === 'running' || v.status === 'stopped' ? v.status : 'done',
    total: Number(v.total) || 0,
    queued: Number(v.queued) || 0,
    startedAt: typeof v.startedAt === 'string' ? v.startedAt : new Date(0).toISOString(),
    cursor: typeof v.cursor === 'string' ? v.cursor : null,
  };
}

async function writeState(db: Pick<Database, 'insert'>, state: State) {
  const value = { ...state };
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
}

/** Starts a regeneration (an admin's action, never automatic); 409 while one runs. */
export async function startBackfill(
  db: Database,
  jobs: Jobs,
  scope: State['scope'],
  recipes: Recipes,
) {
  if (!jobs.makeProxy || !jobs.runVideoBackfill)
    throw new HttpError('conflict', 'This server makes no video copies.');
  if ((await readState(db))?.status === 'running')
    throw new HttpError('conflict', 'A regeneration is already running.');
  await writeState(db, {
    scope,
    status: 'running',
    total: await countNeeding(db, scope, recipes),
    queued: 0,
    startedAt: new Date().toISOString(),
    cursor: null,
  });
  await jobs.runVideoBackfill();
}

/** Stops it: nothing more is queued and the regenerations still waiting are dropped. */
export async function stopBackfill(db: Database, jobs: Jobs) {
  const state = await readState(db);
  if (state?.status !== 'running') return;
  await writeState(db, { ...state, status: 'stopped' });
  await jobs.cancelRegenerations?.();
}

/**
 * One step of the regeneration (job `maintenance:video-backfill`): queues the next block of
 * assets at a low priority, so uploads go first, once fewer than 50 wait. Returns whether it
 * should run again.
 */
export async function stepBackfill(db: Database, jobs: Jobs, recipes: Recipes) {
  const state = await readState(db);
  if (state?.status !== 'running' || !jobs.makeProxy) return false;
  const waiting = (await jobs.regenerationsWaiting?.()) ?? 0;
  if (waiting >= BACKLOG) return true;
  const rows = await db.execute<{ id: string }>(
    sql`select a.id from asset a where ${needsCopies(state.scope, recipes)}
      ${state.cursor ? sql`and a.id > ${state.cursor}` : sql``}
      order by a.id limit ${BACKFILL_BLOCK}`,
  );
  for (const { id } of rows) await jobs.makeProxy(id, { regenerate: true });
  const next: State = {
    ...state,
    queued: state.queued + rows.length,
    cursor: rows.at(-1)?.id ?? state.cursor,
  };
  // Every block queued and none left waiting: done.
  if (rows.length === 0 && waiting === 0) {
    await writeState(db, { ...next, status: 'done' });
    return false;
  }
  await writeState(db, next);
  return true;
}

/** The regeneration as the Video page shows it, or null when none ever ran. */
export async function readBackfill(db: Reader, jobs?: Jobs): Promise<VideoBackfill | null> {
  const state = await readState(db);
  if (!state) return null;
  const waiting = state.status === 'running' ? ((await jobs?.regenerationsWaiting?.()) ?? 0) : 0;
  return {
    scope: state.scope,
    status: state.status,
    total: Math.max(state.total, state.queued),
    done: Math.max(0, state.queued - waiting),
    startedAt: state.startedAt,
  };
}
