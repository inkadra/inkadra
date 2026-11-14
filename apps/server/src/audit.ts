import { randomUUID } from 'node:crypto';
import {
  AUDIT_GROUPS,
  AUDIT_RETENTION_DAYS,
  type AuditAction,
  type AuditEvent,
  type AuditEvents,
  type AuditGroup,
} from '@inkadra/shared';
import { and, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { auditEvent } from './db/schema.ts';
import { afterCursor, atText, decodeCursor, pageOf } from './http/keyset.ts';

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  ip?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Records one action (#806). Called with the transaction of the change, so the change and its
 * record are written together or not at all. The actor's name is copied as it is now.
 */
export async function recordAudit(db: Pick<Database, 'insert'>, input: AuditInput) {
  await db.insert(auditEvent).values({
    action: input.action,
    actorId: input.actorId ?? null,
    actorName: input.actorId
      ? sql`(select name from "user" where id = ${input.actorId}::uuid)`
      : null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    projectId: input.projectId ?? null,
    ip: input.ip ?? null,
    details: input.details ?? {},
  });
}

/** Failed sign-ins of one account from one address within this time are one row (#806). */
export const SIGN_IN_AUDIT_WINDOW_S = 15 * 60;
/** Rows of failed sign-ins and lockouts per hour; past it one summary row counts the rest. */
export const SIGN_IN_AUDIT_PER_HOUR = 200;

/**
 * Records a failed sign-in or a lockout of an existing account (#806), bounded: the same
 * account and address within `SIGN_IN_AUDIT_WINDOW_S` add to one row's `count`, and past
 * `SIGN_IN_AUDIT_PER_HOUR` rows an hour the rest only add to one `rateLimited` summary row.
 * Attempts on addresses with no account are not recorded at all: rotating addresses or
 * guessing emails cannot grow the table, which is kept a year.
 */
export async function recordSignInEvent(
  db: Pick<Database, 'insert' | 'select' | 'update'>,
  input: {
    action: 'auth.sign_in_failed' | 'auth.locked_out';
    userId: string;
    ip: string;
    details?: Record<string, unknown>;
  },
  limits = { windowS: SIGN_IN_AUDIT_WINDOW_S, perHour: SIGN_IN_AUDIT_PER_HOUR },
): Promise<'added' | 'counted' | 'rate_limited'> {
  const bump = sql`jsonb_set(${auditEvent.details}, '{count}', to_jsonb(coalesce((${auditEvent.details}->>'count')::int, 1) + 1))`;
  const since = (secs: number) => gt(auditEvent.at, sql`now() - make_interval(secs => ${secs})`);
  const [same] = await db
    .update(auditEvent)
    .set({ details: bump })
    .where(
      and(
        eq(auditEvent.action, input.action),
        eq(auditEvent.targetId, input.userId),
        eq(auditEvent.ip, input.ip),
        since(limits.windowS),
      ),
    )
    .returning({ id: auditEvent.id });
  if (same) return 'counted';
  const [recent] = await db
    .select({ n: count() })
    .from(auditEvent)
    .where(and(inArray(auditEvent.action, SIGN_IN_ACTIONS), since(3600)));
  if ((recent?.n ?? 0) >= limits.perHour) {
    const [summed] = await db
      .update(auditEvent)
      .set({ details: bump })
      .where(
        and(
          eq(auditEvent.action, 'auth.sign_in_failed'),
          sql`${auditEvent.details}->>'rateLimited' = 'true'`,
          since(3600),
        ),
      )
      .returning({ id: auditEvent.id });
    if (!summed)
      await recordAudit(db, {
        action: 'auth.sign_in_failed',
        details: { rateLimited: true, count: 1 },
      });
    return 'rate_limited';
  }
  await recordAudit(db, {
    action: input.action,
    targetType: 'user',
    targetId: input.userId,
    ip: input.ip,
    details: { ...input.details, count: 1 },
  });
  return 'added';
}
const SIGN_IN_ACTIONS = ['auth.sign_in_failed', 'auth.locked_out'];

/**
 * Pseudonymizes the events of an account being deleted (#806): its name, addresses and the IPs
 * of its actions or sign-in attempts go; the action, the time and one opaque id stay, the same
 * on every event of that person, so the history still reads as one (deleted) account.
 */
export async function pseudonymizeAudit(db: Pick<Database, 'update'>, userId: string) {
  const opaque = `deleted-${randomUUID().slice(0, 8)}`;
  const strip = sql`(${auditEvent.details} - 'email' - 'name')`;
  await db
    .update(auditEvent)
    .set({
      actorName: null,
      ip: null,
      details: sql`${strip} || jsonb_build_object('actor', ${opaque}::text)`,
    })
    .where(eq(auditEvent.actorId, userId));
  await db
    .update(auditEvent)
    .set({
      targetId: opaque,
      ip: sql`case when ${auditEvent.action} like 'auth.%' then null else ${auditEvent.ip} end`,
      details: strip,
    })
    .where(and(eq(auditEvent.targetType, 'user'), eq(auditEvent.targetId, userId)));
  return opaque;
}

/** The fields of `patch` that change `before`, as `{ field: [before, after] }`. */
export function changes(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(patch))
    if (value !== undefined && JSON.stringify(before[key]) !== JSON.stringify(value))
      out[key] = [before[key] ?? null, value];
  return out;
}

export async function listAudit(
  db: Database,
  q: {
    group?: AuditGroup;
    action?: AuditAction;
    actorId?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<AuditEvents> {
  const limit = q.limit ?? 50;
  const cursor = decodeCursor(q.cursor);
  const rows = await db
    .select({
      id: auditEvent.id,
      at: atText(auditEvent.at),
      when: auditEvent.at,
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      actorName: auditEvent.actorName,
      targetType: auditEvent.targetType,
      targetId: auditEvent.targetId,
      projectId: auditEvent.projectId,
      ip: auditEvent.ip,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .where(
      and(
        q.group ? inArray(auditEvent.action, [...AUDIT_GROUPS[q.group]]) : undefined,
        q.action ? eq(auditEvent.action, q.action) : undefined,
        q.actorId ? eq(auditEvent.actorId, q.actorId) : undefined,
        cursor ? afterCursor(auditEvent.at, auditEvent.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(auditEvent.at), desc(auditEvent.id))
    .limit(limit + 1);
  const page = pageOf(rows, limit);
  return {
    items: page.rows.map(
      (r): AuditEvent => ({
        id: r.id,
        at: r.when.toISOString(),
        action: r.action as AuditAction,
        actor: r.actorId || r.actorName ? { id: r.actorId, name: r.actorName } : null,
        targetType: r.targetType,
        targetId: r.targetId,
        projectId: r.projectId,
        ip: r.ip,
        details: r.details,
      }),
    ),
    nextCursor: page.nextCursor,
    retentionDays: AUDIT_RETENTION_DAYS,
  };
}

/** Retention: events go after `AUDIT_RETENTION_DAYS`, a thousand at a time. */
export async function purgeAudit(db: Database, now = new Date()) {
  const cutoff = new Date(+now - AUDIT_RETENTION_DAYS * 86_400_000);
  let removed = 0;
  let count: number;
  do {
    const result = await db
      .delete(auditEvent)
      .where(
        inArray(
          auditEvent.id,
          db
            .select({ id: auditEvent.id })
            .from(auditEvent)
            .where(lt(auditEvent.at, cutoff))
            .limit(1000),
        ),
      );
    count = result.count;
    removed += count;
  } while (count === 1000);
  return { removed };
}
