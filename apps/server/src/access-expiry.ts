import { ProjectCreationDenied, type ProjectRole } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import { type Actor, higher } from './access.ts';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { notification, user } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import { readInstanceSettings } from './instance-settings.ts';

/** Decision 0041: end dates are at most this far ahead. */
export const MAX_EXPIRY_DAYS = 366;
/** The "expires soon" notification goes out this long before the end. */
export const EXPIRY_WARNING_MS = 3 * 86_400_000;

/**
 * An end date from a request: undefined when left out (keep the stored one), null to remove
 * it. Refuses a time in the past, too far ahead, or on an owner role.
 */
export function readExpiry(
  value: string | null | undefined,
  role: string | null,
  now = new Date(),
): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const at = new Date(value);
  if (role === 'owner')
    throw new HttpError('bad_request', 'Owners have no end date: a project always keeps one.');
  if (at.getTime() <= now.getTime())
    throw new HttpError('bad_request', 'The end date must be in the future.');
  if (at.getTime() > now.getTime() + MAX_EXPIRY_DAYS * 86_400_000)
    throw new HttpError(
      'bad_request',
      `The end date can be at most ${MAX_EXPIRY_DAYS} days ahead.`,
    );
  return at;
}

/** A role on one membership or grant and when it ends (null: never). */
export interface Held {
  role: ProjectRole;
  expiresAt: Date | null;
}

/**
 * What an invitation does to the role a person already holds on the same membership or grant
 * (decision 0041), or null when nothing changes. It only raises the role, never replaces a
 * permanent role with a temporary one, and never removes or extends an end date: of two, the
 * earlier stays. Owners never end.
 */
export function mergeInvitedRole(current: Held | null, incoming: Held): Held | null {
  if (!current) return incoming.role === 'owner' ? { ...incoming, expiresAt: null } : incoming;
  if (!higher(incoming.role, current.role)) return null;
  if (incoming.role === 'owner') return { role: 'owner', expiresAt: null };
  if (current.expiresAt === null && incoming.expiresAt !== null) return null;
  const expiresAt =
    current.expiresAt === null
      ? null
      : incoming.expiresAt === null || current.expiresAt < incoming.expiresAt
        ? current.expiresAt
        : incoming.expiresAt;
  return { role: incoming.role, expiresAt };
}

/** Whether going from one end date to another gives more access: removing or extending it. */
export function widensEnd(current: Date | null | undefined, next: Date | null): boolean {
  if (!current) return false;
  return next === null || next.getTime() > current.getTime();
}

/** Whether a person can create and import projects: administrators always can. */
export async function canCreateProjects(
  db: Database,
  config: Config,
  actor: Pick<Actor, 'id' | 'role'>,
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  const [row] = await db
    .select({ can: user.canCreateProjects })
    .from(user)
    .where(eq(user.id, actor.id));
  if (row?.can !== null && row?.can !== undefined) return row.can;
  return (await readInstanceSettings(db, config)).membersCanCreateProjects;
}

export async function requireProjectCreation(
  db: Database,
  config: Config,
  actor: Pick<Actor, 'id' | 'role'>,
) {
  if (!(await canCreateProjects(db, config, actor)))
    throw new HttpError(
      'forbidden',
      'An administrator decides who can create projects on this instance.',
      ProjectCreationDenied.parse({ reason: 'project_creation_disabled' }),
    );
}

type Ending = {
  user_id: string;
  project_id: string;
  board_id: string | null;
  expires_at: Date;
};

/**
 * Notifications about the end of someone's access: to them and to the active owners of the
 * project, each once.
 */
async function notifyEnding(
  tx: Pick<Database, 'execute' | 'insert'>,
  type: 'access_expiring' | 'access_expired',
  rows: readonly Ending[],
) {
  for (const r of rows) {
    const owners = await tx.execute<{ user_id: string }>(sql`
      select user_id from project_member
      where project_id = ${r.project_id} and role = 'owner' and user_id <> ${r.user_id}`);
    const recipients = [r.user_id, ...owners.map((o) => o.user_id)];
    await tx.insert(notification).values(
      recipients.map((userId) => ({
        userId,
        type,
        projectId: r.project_id,
        boardId: r.board_id,
        subjectUserId: r.user_id,
        accessExpiresAt: new Date(r.expires_at),
      })),
    );
  }
}

/**
 * Warns about access ending within three days and removes access that has ended (decision
 * 0041). Idempotent: each row is claimed with `for update skip locked` and changed in the same
 * transaction as its notifications, so parallel runs and retries never notify twice. Access
 * checks already ignore ended rows; this only cleans up and tells people.
 */
export async function sweepAccessExpiry(db: Database, now = new Date()) {
  const at = sql`${now.toISOString()}::timestamptz`;
  const warnBefore = sql`${new Date(now.getTime() + EXPIRY_WARNING_MS).toISOString()}::timestamptz`;
  return db.transaction(async (tx) => {
    const warnedMembers = await tx.execute<Ending>(sql`
      update project_member m set expiry_warned_at = ${at}
      where (m.project_id, m.user_id) in (
        select project_id, user_id from project_member
        where expires_at is not null and expires_at > ${at} and expires_at <= ${warnBefore}
          and expiry_warned_at is null
        for update skip locked)
      returning m.user_id, m.project_id, null::uuid as board_id, m.expires_at`);
    const warnedGrants = await tx.execute<Ending>(sql`
      update board_grant g set expiry_warned_at = ${at}
      from board b
      where b.id = g.board_id and b.deleted_at is null and (g.board_id, g.user_id) in (
        select board_id, user_id from board_grant
        where expires_at is not null and expires_at > ${at} and expires_at <= ${warnBefore}
          and expiry_warned_at is null
        for update skip locked)
      returning g.user_id, b.project_id, g.board_id, g.expires_at`);
    const endedMembers = await tx.execute<Ending>(sql`
      delete from project_member m
      where (m.project_id, m.user_id) in (
        select project_id, user_id from project_member
        where expires_at is not null and expires_at <= ${at}
        for update skip locked)
      returning m.user_id, m.project_id, null::uuid as board_id, m.expires_at`);
    const endedGrants = await tx.execute<Ending>(sql`
      with gone as (
        delete from board_grant g
        where (g.board_id, g.user_id) in (
          select board_id, user_id from board_grant
          where expires_at is not null and expires_at <= ${at}
          for update skip locked)
        returning g.user_id, g.board_id, g.expires_at
      )
      select gone.user_id, b.project_id, gone.board_id, gone.expires_at, b.deleted_at
      from gone join board b on b.id = gone.board_id`);
    await notifyEnding(tx, 'access_expiring', [...warnedMembers, ...warnedGrants]);
    await notifyEnding(tx, 'access_expired', [
      ...endedMembers,
      // A grant on a board in the trash ends silently.
      ...endedGrants.filter((g) => !(g as Ending & { deleted_at: Date | null }).deleted_at),
    ]);
    return {
      warned: warnedMembers.length + warnedGrants.length,
      expired: endedMembers.length + endedGrants.length,
    };
  });
}

/** Without a worker the web process runs the sweep itself, every minute. */
export function startInlineExpirySweep(
  db: Database,
  log: { error: (obj: unknown, msg: string) => void },
  everyMs = 60_000,
) {
  const run = () =>
    sweepAccessExpiry(db).catch((err) => log.error({ err }, 'access expiry sweep failed'));
  // At once too: rows that ended while the server was down are cleaned up and notified.
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
