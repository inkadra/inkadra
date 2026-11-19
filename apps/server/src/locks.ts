import { type SQL, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The instance's scoped locks (decision 0134), which replaced the single administration lock
 * (the one-key 10892): one transaction-level lock per invariant. Each is a two-key lock whose
 * first key is its class, so a lock of one class never meets one of another, and the two-key
 * space never meets the one-key locks still in use. A transaction takes them only in this order,
 * may skip any, and never takes an earlier one after a later one; no advisory lock after its first
 * row lock, except the storage lock:
 *
 * 1. `classification-uses`, shared or exclusive: `lockUses` in classifications.ts (0126).
 * 2. `classifications` (10892, 1): the catalog and its removed values (`lockCatalog`).
 * 3. `account:<user>` (10894, hashtext(id)): anything that creates for, adds, changes or deletes
 *    that person (`lockAccount`). Several go in ascending key, never by id.
 * 4. The idempotency key: `rememberedCreation` in idempotency.ts.
 * 5. `instance-roles` (10892, 2): exclusive to change a role or deactivate, or to delete an
 *    administrator's account; shared for every admin-only write (`lockRoles`).
 * 6. `setting:<key>` (10892, 3–5): the read-modify-write of one `instance_setting` row.
 * 7. Rows, `FOR UPDATE`: `user`, then `project` by id, `project_member`, other rows.
 * 8. `storage-limits[:user]`: `assertSpace` in storage-limits.ts (#799), then only `asset` by id
 *    and `storage_total` (#879). A leaf: whoever holds it waits for no row another path holds
 *    first, so an import takes it at the end, held only for its files.
 *
 * A wait is bounded by the pool's `lock_timeout` (#800).
 */
const CLASS = { instance: 10892, account: 10894 } as const;

const lock = (
  tx: Tx | Database,
  key1: number,
  key2: number | SQL,
  mode: 'shared' | 'exclusive' = 'exclusive',
) =>
  tx.execute(
    mode === 'shared'
      ? sql`select pg_advisory_xact_lock_shared(${key1}::int, ${key2}::int)`
      : sql`select pg_advisory_xact_lock(${key1}::int, ${key2}::int)`,
  );

/** The `classifications` and `classifications_deleted` settings rows (decision 0126). */
export const lockCatalog = (tx: Tx | Database) => lock(tx, CLASS.instance, 1);

/** One person: their creations, imports, memberships, deletion and role. */
export const lockAccount = (tx: Tx | Database, userId: string) =>
  lock(tx, CLASS.account, sql`hashtext(${userId})`);

/** Who is an active administrator. */
export const lockRoles = (tx: Tx | Database, mode: 'shared' | 'exclusive') =>
  lock(tx, CLASS.instance, 2, mode);

const SETTINGS = { administration: 3, storage: 4, backup: 5 } as const;

/** One `instance_setting` row, for a read-modify-write. */
export const lockSetting = (tx: Tx | Database, key: keyof typeof SETTINGS) =>
  lock(tx, CLASS.instance, SETTINGS[key]);
