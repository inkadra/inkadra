import {
  AUDIT_GROUPS,
  AUDIT_RETENTION_DAYS,
  type AuditAction,
  type AuditEvent,
  type AuditEvents,
  type AuditGroup,
} from '@inkadra/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
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

/** For actions outside a transaction (sign-ins): a failed record is logged, never thrown. */
export function recordAuditDetached(
  db: Pick<Database, 'insert'>,
  input: AuditInput,
  log?: Pick<Logger, 'error'>,
) {
  recordAudit(db, input).catch((err) => log?.error({ err }, 'audit event not recorded'));
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
        actor:
          r.actorId || r.actorName ? { id: r.actorId, name: r.actorName } : null,
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
          db.select({ id: auditEvent.id }).from(auditEvent).where(lt(auditEvent.at, cutoff)).limit(1000),
        ),
      );
    count = result.count;
    removed += count;
  } while (count === 1000);
  return { removed };
}
