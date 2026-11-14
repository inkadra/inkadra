import type { MyStorage, StorageFiles, StorageFull, UpdateStorageLimits } from '@inkadra/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import { boardRoles, live } from './access.ts';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting, user } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import { fileCategory } from './storage-usage.ts';

/**
 * Storage limits (decision 0081): a total for the instance, a default for each person and a
 * limit of one's own. Only new files are refused; nothing is ever deleted to make room.
 */
export interface Limits {
  total: number | null;
  perUser: number | null;
  warnPercent: number;
  locked: { total: boolean; perUser: boolean };
}

/** The variables that set limits from the server environment. */
export type StorageEnv = Pick<Config, 'STORAGE_LIMIT' | 'STORAGE_LIMIT_PER_USER'>;

const KEY = 'storage-limits';
const DEFAULT_WARN = 80;

type Reader = Pick<Database, 'select' | 'execute'>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

/** The stored choices, with the server environment winning where it is set. */
export async function readLimits(db: Reader, config: StorageEnv): Promise<Limits> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const stored = (row?.value ?? {}) as Record<string, unknown>;
  const warn = stored.warnPercent;
  const envTotal = config.STORAGE_LIMIT;
  const envPerUser = config.STORAGE_LIMIT_PER_USER;
  return {
    total: envTotal !== undefined ? positive(envTotal) : positive(stored.total),
    perUser: envPerUser !== undefined ? positive(envPerUser) : positive(stored.perUser),
    warnPercent:
      typeof warn === 'number' && Number.isInteger(warn) && warn >= 50 && warn <= 95
        ? warn
        : DEFAULT_WARN,
    locked: { total: envTotal !== undefined, perUser: envPerUser !== undefined },
  };
}

export async function saveLimits(
  db: Database | Tx,
  config: StorageEnv,
  patch: UpdateStorageLimits,
): Promise<Limits> {
  const current = await readLimits(db, config);
  // The environment decides these: a managed server's administrator cannot raise them.
  if (
    (patch.total !== undefined && current.locked.total) ||
    (patch.perUser !== undefined && current.locked.perUser) ||
    (patch.warnPercent !== undefined && (current.locked.total || current.locked.perUser))
  )
    throw new HttpError('forbidden', 'These limits are set by the server environment.');
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const value = { ...(row?.value ?? {}), ...patch };
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
  return readLimits(db, config);
}

/**
 * The limit of one person: their own (`override`, 0 for none) or the instance default. Under a
 * limit set by the environment an override can only lower it.
 */
export function personLimit(limits: Limits, override: number | null): number | null {
  if (override === null) return limits.perUser;
  const own = override > 0 ? override : null;
  if (!limits.locked.perUser || limits.perUser === null) return own;
  return own === null ? limits.perUser : Math.min(own, limits.perUser);
}

/** Whether an administrator may give this override to a person. */
export function overrideAllowed(limits: Limits, override: number | null): boolean {
  if (override === null || !limits.locked.perUser || limits.perUser === null) return true;
  return override > 0 && override <= limits.perUser;
}

/** Originals and the copies and previews made of them, as Settings → Storage counts them. */
export async function usedBytes(
  db: Reader,
  opts: { userId?: string } = {},
): Promise<{ originals: number; derived: number }> {
  const where: SQL[] = [sql`a.status in ('processing', 'ready', 'failed')`];
  if (opts.userId) where.push(sql`a.created_by = ${opts.userId}`);
  const condition = sql.join(where, sql` and `);
  const [row] = await db.execute<{ originals: string; derived: string }>(sql`select
    (select coalesce(sum(a.size), 0) from asset a where ${condition})::text as originals,
    ((select coalesce(sum(v.bytes), 0) from asset_variant v join asset a on a.id = v.asset_id
      where ${condition})
      + ${
        // The rungs of video ladders count in the instance total only, never in a person's
        // space: one upload would grow with every rung (decision 0128).
        opts.userId
          ? sql`0`
          : sql`(select coalesce(sum(r.bytes), 0) from asset_rendition r
              join asset a on a.id = r.asset_id where ${condition})`
      })::text as derived`);
  return { originals: Number(row?.originals ?? 0), derived: Number(row?.derived ?? 0) };
}

const total = (u: { originals: number; derived: number }) => u.originals + u.derived;

/**
 * What a new file is weighed against (#799): the running totals of `storage_total`, files in
 * every status at their declared size, so parallel uploads cannot pass a limit together. With
 * `userId`, that person's originals and copies; without, the instance with ladder rungs too.
 * `exclude` leaves out one file (the upload being finished) with its copies.
 */
export async function reservedBytes(
  db: Reader,
  opts: { userId?: string; exclude?: string } = {},
): Promise<number> {
  const [row] = await db.execute<{ used: string }>(
    opts.userId
      ? sql`select coalesce((select bytes from storage_total where user_id = ${opts.userId}), 0)
          ::text as used`
      : sql`select coalesce(sum(bytes + rendition_bytes), 0)::text as used from storage_total`,
  );
  let used = Number(row?.used ?? 0);
  if (opts.exclude) {
    const [own] = await db.execute<{ bytes: string }>(sql`select (a.size
        + coalesce((select sum(v.bytes) from asset_variant v where v.asset_id = a.id), 0)
        + ${
          opts.userId
            ? sql`0`
            : sql`coalesce((select sum(r.bytes) from asset_rendition r where r.asset_id = a.id), 0)`
        })::text as bytes
      from asset a where a.id = ${opts.exclude}
        ${opts.userId ? sql`and a.created_by = ${opts.userId}` : sql``}`);
    used -= Number(own?.bytes ?? 0);
  }
  return used;
}

/** Why `bytes` more do not fit, or null when they do. The instance total goes first. */
export async function refusal(
  db: Reader,
  limits: Limits,
  person: { id: string; limit: number | null },
  bytes: number,
  exclude?: string,
): Promise<StorageFull | null> {
  if (limits.total !== null) {
    const used = await reservedBytes(db, { exclude });
    if (used + bytes > limits.total)
      return {
        code: 'storage_full',
        scope: 'instance',
        remaining: Math.max(0, limits.total - used),
        limit: limits.total,
      };
  }
  if (person.limit !== null) {
    const used = await reservedBytes(db, { userId: person.id, exclude });
    if (used + bytes > person.limit)
      return {
        code: 'storage_full',
        scope: 'user',
        remaining: Math.max(0, person.limit - used),
        limit: person.limit,
      };
  }
  return null;
}

/**
 * Sets each person's running total to the sum of their files (daily): a total that drifted,
 * through a write the triggers do not see (a restore, a manual edit), heals within a day. One
 * short transaction per person, holding only that person's row.
 */
export async function reconcileStorageTotals(db: Database): Promise<{ corrected: number }> {
  const owners = await db.execute<{ user_id: string | null }>(sql`select user_id from storage_total
    union select distinct created_by from asset`);
  let corrected = 0;
  for (const { user_id: owner } of owners) {
    const who = owner === null ? sql`is null` : sql`= ${owner}`;
    const changed = await db.transaction(async (tx) => {
      const [row] = await tx.execute<{ bytes: string; rendition_bytes: string }>(
        sql`select bytes::text, rendition_bytes::text from storage_total
          where user_id ${who} for update`,
      );
      const [sum] = await tx.execute<{ bytes: string; rendition_bytes: string }>(sql`select
        (coalesce(sum(a.size), 0) + coalesce((select sum(v.bytes) from asset_variant v
          join asset a on a.id = v.asset_id where a.created_by ${who}), 0))::text as bytes,
        coalesce((select sum(r.bytes) from asset_rendition r
          join asset a on a.id = r.asset_id where a.created_by ${who}), 0)::text as rendition_bytes
        from asset a where a.created_by ${who}`);
      const bytes = sum?.bytes ?? '0';
      const renditionBytes = sum?.rendition_bytes ?? '0';
      if (row?.bytes === bytes && row?.rendition_bytes === renditionBytes) return false;
      if (!row && bytes === '0' && renditionBytes === '0') return false;
      if (row)
        await tx.execute(sql`update storage_total set bytes = ${bytes}::bigint,
          rendition_bytes = ${renditionBytes}::bigint where user_id ${who}`);
      else
        await tx.execute(sql`insert into storage_total (user_id, bytes, rendition_bytes)
          select ${owner}::uuid, ${bytes}::bigint, ${renditionBytes}::bigint
          where ${owner}::uuid is null or exists (select 1 from "user" where id = ${owner}::uuid)
          on conflict (user_id) do nothing`);
      return true;
    });
    if (changed) corrected += 1;
  }
  return { corrected };
}

export class StorageFullError extends HttpError {
  constructor(readonly refused: StorageFull) {
    super('payload_too_large', 'There is not enough space for this file.', refused);
  }
}

async function limitOf(db: Reader, limits: Limits, userId: string) {
  const [row] = await db
    .select({ override: user.storageLimit })
    .from(user)
    .where(eq(user.id, userId));
  return personLimit(limits, row?.override ?? null);
}

/**
 * Throws StorageFullError unless `bytes` more fit, holding the storage lock until `tx` ends:
 * two files arriving together are counted one after the other.
 */
export async function assertSpace(
  tx: Reader,
  env: StorageEnv,
  userId: string,
  bytes: number,
  exclude?: string,
  known?: Limits,
) {
  const limits = known ?? (await readLimits(tx, env));
  const limit = await limitOf(tx, limits, userId);
  if (limits.total === null && limit === null) return;
  // An instance total needs every upload in turn; a person's limit only theirs (#799). Both
  // hold the lock for a few index lookups, and the pool's lock timeout bounds the wait (#800).
  const key = limits.total !== null ? 'storage-limits' : `storage-limits:${userId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  const refused = await refusal(tx, limits, { id: userId, limit }, bytes, exclude);
  if (refused) throw new StorageFullError(refused);
}

/**
 * Runs `insert` (which writes the asset row) only if `bytes` more fit, under the storage lock
 * (assertSpace). Without any limit it runs straight away.
 */
export async function reserveSpace<T>(
  db: Database | Tx,
  env: StorageEnv,
  userId: string,
  bytes: number,
  insert: (tx: Tx | Database) => Promise<T>,
  exclude?: string,
): Promise<T> {
  const limits = await readLimits(db, env);
  if (limits.total === null && (await limitOf(db, limits, userId)) === null) return insert(db);
  return db.transaction(async (tx) => {
    await assertSpace(tx, env, userId, bytes, exclude, limits);
    return insert(tx);
  });
}

/**
 * The 50 largest files `ownerId` uploaded, with their copies. Files in projects `viewerId`
 * cannot open are counted, never named, as in Settings → Storage. Each listed file says where
 * a card shows it, on a board the viewer can open, and has the thumbnail the viewer may load.
 */
export async function largestFiles(
  db: Reader,
  ownerId: string,
  viewerId: string,
): Promise<StorageFiles> {
  const visible = sql`(exists(select 1 from project_member m
      where m.project_id = a.project_id and m.user_id = ${viewerId} and ${live('m')})
    or exists(select 1 from board_grant g join board b on b.id = g.board_id
      where b.project_id = a.project_id and b.deleted_at is null and g.user_id = ${viewerId}
        and ${live('g')}))`;
  const files = sql`select a.id, a.filename, a.mime, a.project_id, a.created_at,
      ${visible} as visible,
      a.size + coalesce((select sum(v.bytes) from asset_variant v where v.asset_id = a.id), 0)
        as bytes
    from asset a
    where a.created_by = ${ownerId} and a.status in ('processing', 'ready', 'failed')`;
  const rows = [
    ...(await db.execute<{
      id: string;
      filename: string;
      mime: string;
      project_id: string;
      project_name: string;
      project_color: NonNullable<StorageFiles['items'][number]['projectColor']>;
      created_at: Date | string;
      bytes: string;
      thumbnail: boolean;
    }>(sql`select f.id, f.filename, f.mime, f.project_id, p.name as project_name,
      p.icon_color as project_color, f.created_at, f.bytes::text as bytes,
      exists(select 1 from asset_variant v where v.asset_id = f.id and v.size = '256')
        as thumbnail
    from (${files}) f join project p on p.id = f.project_id
    where f.visible order by f.bytes desc, f.id limit 50`)),
  ];
  const [hidden] = await db.execute<{ n: string; bytes: string }>(sql`select count(*)::text as n,
      coalesce(sum(f.bytes), 0)::text as bytes from (${files}) f where not f.visible`);
  const used = await usedBytes(db, { userId: ownerId });
  // The cards showing each file, most recently changed first; only boards the viewer opens.
  const cards =
    rows.length === 0
      ? []
      : [
          ...(await db.execute<{ asset_id: string; board_id: string; element_id: string }>(
            sql`select e.asset_id, e.board_id, e.element_id from board_element_index e
              where e.asset_id in (${sql.join(
                rows.map((r) => sql`${r.id}::uuid`),
                sql`, `,
              )})
              order by e.updated_at desc, e.board_id, e.element_id`,
          )),
        ];
  const open = await boardRoles(
    db,
    { id: viewerId },
    cards.map((c) => c.board_id),
  );
  const cardOf = new Map<string, { boardId: string; cardId: string }>();
  for (const c of cards)
    if (open.has(c.board_id) && !cardOf.has(c.asset_id))
      cardOf.set(c.asset_id, { boardId: c.board_id, cardId: c.element_id });
  return {
    items: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      bytes: Number(r.bytes),
      projectId: r.project_id,
      projectName: r.project_name,
      createdAt: new Date(r.created_at).toISOString(),
      kind: fileCategory(r.mime),
      ...(r.thumbnail && { thumbnailUrl: `/api/v1/assets/${r.id}/variants/256` }),
      ...cardOf.get(r.id),
      projectColor: r.project_color,
    })),
    hiddenCount: Number(hidden?.n ?? 0),
    hiddenBytes: Number(hidden?.bytes ?? 0),
    totalBytes: total(used),
  };
}

/** The space of one person, for their own Settings → Account. */
export async function myStorage(db: Reader, env: StorageEnv, userId: string): Promise<MyStorage> {
  const limits = await readLimits(db, env);
  const mine = await usedBytes(db, { userId });
  const instanceFull = limits.total !== null && (await reservedBytes(db)) >= limits.total;
  return {
    originalBytes: mine.originals,
    derivedBytes: mine.derived,
    limit: await limitOf(db, limits, userId),
    warnPercent: limits.warnPercent,
    instanceFull,
  };
}
