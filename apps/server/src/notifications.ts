import { createHash } from 'node:crypto';
import {
  type Notification,
  NotificationChannelType,
  type NotificationType,
  type ReviewStatus,
  renderMentions,
} from '@inkadra/shared';
import { and, asc, eq, getTableColumns, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { boardRoles, boardRolesForPeople, touchesProject } from './access.ts';
import type { Database } from './db/client.ts';
import {
  board,
  comment,
  notification,
  notificationPreference,
  project,
  user,
} from './db/schema.ts';
import { authorOf, labelOf, loadPeople } from './http/authors.ts';
import { afterCursor, atText, type Keyset } from './http/keyset.ts';
import { RateLimiter } from './http/link-previews.ts';
import type { Mailer } from './mailer.ts';
import { notificationMail } from './mails.ts';

/**
 * Notifications are written by the server when something happens (decision 0013): the actor is
 * never notified, one event gives one notification per person, and everything that shows or
 * sends them (list, badge, email) leaves out boards the person can no longer open, checked at
 * the time it runs.
 */

export type NotificationRow = typeof notification.$inferSelect;

/** Kept 90 days. */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** Email of `immediate` waits this long after the first unread one, to group what follows. */
export const EMAIL_GROUP_DELAY_MS = 3 * 60_000;
const MAX_PER_EMAIL = 50;
/**
 * A claimed email waits this long before another run may send it again (#812): a worker that
 * died between the claim and the send leaves it to the next run, so it goes out at least once.
 * Longer than the SMTP timeouts of the mailer.
 */
export const EMAIL_LEASE_MS = 10 * 60_000;
/** Failed sends of a notification before it is given up (#812). */
export const MAX_EMAIL_ATTEMPTS = 6;
/** People handled at once by the email jobs (#812). */
const EMAIL_BATCH = 8;
// Like the write limiters, per process. Bound amplification from large threads as well as edits.
const fanoutLimiters = new WeakMap<Database, RateLimiter>();

/** Post-commit effects are best effort: never invite a retry of a write already saved. */
export async function afterCommit(log: Pick<Logger, 'error'>, work: () => unknown) {
  try {
    await work();
  } catch (err) {
    log.error({ err }, 'post-commit notification failed');
  }
}
const EXCERPT_LENGTH = 280;
const iso = (d: Date) => d.toISOString();

export interface NotificationEvent {
  /** Who did it: an account or a guest of a share link. */
  actor: { userId?: string | null; guestId?: string | null };
  projectId: string | null;
  boardId: string | null;
  elementId?: string | null;
  commentId?: string | null;
  reviewStatus?: ReviewStatus | null;
  /** For `link_opened`: the link a guest opened. */
  shareLinkId?: string | null;
}

/**
 * The people an event concerns, each once: the first type given for a person wins, so callers
 * add the most specific first (a mention in a reply is a `mention`). The actor is skipped.
 */
export class Recipients {
  readonly types = new Map<string, NotificationType>();
  constructor(private readonly actorUserId: string | null | undefined) {}
  add(userId: string | null | undefined, type: NotificationType) {
    if (!userId || userId === this.actorUserId || this.types.has(userId)) return this;
    this.types.set(userId, type);
    return this;
  }
}

/**
 * Whether a person may see notifications about these places, by the same rules as the board
 * itself: a board they still have a role on (not in the trash), or a project they still touch
 * when there is no board. Notifications about neither are about the instance and always shown.
 */
type Placed = Pick<NotificationRow, 'boardId' | 'projectId'> &
  Partial<Pick<NotificationRow, 'subjectUserId'>>;

export async function visibility(
  db: Database,
  userId: string,
  rows: ReadonlyArray<Placed>,
): Promise<(row: Placed) => boolean> {
  const boardIds = rows.flatMap((r) => (r.boardId ? [r.boardId] : []));
  const readable = await boardRoles(db, { id: userId }, boardIds);
  const projectIds = [
    ...new Set(rows.flatMap((r) => (!r.boardId && r.projectId ? [r.projectId] : []))),
  ];
  const touched = new Set<string>();
  for (const p of projectIds) if (await touchesProject(db, { id: userId }, p)) touched.add(p);
  return (r) => {
    // People keep hearing about the end of their own access (decision 0041).
    if (r.subjectUserId === userId) return true;
    if (r.boardId) return readable.has(r.boardId);
    if (r.projectId) return touched.has(r.projectId);
    return true;
  };
}

/** Writes the notifications of an event, leaving out people who cannot open its board. */
export async function notify(
  db: Database,
  event: NotificationEvent,
  recipients: Recipients,
): Promise<number> {
  const values: Array<typeof notification.$inferInsert> = [];
  let limiter = fanoutLimiters.get(db);
  if (!limiter) {
    limiter = new RateLimiter(300, 60_000, 'notifications:limiter');
    fanoutLimiters.set(db, limiter);
  }
  const roles = event.boardId
    ? await boardRolesForPeople(db, event.boardId, [...recipients.types.keys()])
    : null;
  const actorKey = event.actor.userId ?? event.actor.guestId;
  // Types people turned off in their Inbox (#302) are not written at all; only the types of
  // the notification matrix can be.
  const people = [...recipients.types].flatMap(([userId, type]) =>
    NotificationChannelType.safeParse(type).success ? [userId] : [],
  );
  const inboxOff = new Map(
    people.length === 0
      ? []
      : (
          await db
            .select({ userId: notificationPreference.userId, off: notificationPreference.inboxOff })
            .from(notificationPreference)
            .where(inArray(notificationPreference.userId, people))
        ).map((p) => [p.userId, p.off] as const),
  );
  for (const [userId, type] of recipients.types) {
    if (inboxOff.get(userId)?.includes(type)) continue;
    const visible = roles ? roles.has(userId) : (await visibility(db, userId, [event]))(event);
    if (!visible) continue;
    if (actorKey && !(await limiter.take(actorKey))) break;
    values.push({
      userId,
      type,
      actorId: event.actor.userId ?? null,
      actorGuestId: event.actor.guestId ?? null,
      projectId: event.projectId,
      boardId: event.boardId,
      elementId: event.elementId ?? null,
      commentId: event.commentId ?? null,
      reviewStatus: event.reviewStatus ?? null,
      shareLinkId: event.shareLinkId ?? null,
    });
  }
  if (values.length > 0) await db.insert(notification).values(values);
  return values.length;
}

/** Start of a comment as it is now, mentions as names; null once it is deleted. */
function excerpt(body: string, names: ReadonlyMap<string, string>): string {
  const text = renderMentions(body, names).replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

/** The answer shape of a person's notification rows, with names and excerpts as they are now. */
export async function renderNotifications(
  db: Database,
  userId: string,
  rows: NotificationRow[],
): Promise<Notification[]> {
  if (rows.length === 0) return [];
  const commentIds = [...new Set(rows.flatMap((r) => (r.commentId ? [r.commentId] : [])))];
  const boardIds = [...new Set(rows.flatMap((r) => (r.boardId ? [r.boardId] : [])))];
  const projectIds = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
  const [comments, boards, projects] = await Promise.all([
    commentIds.length === 0
      ? []
      : db
          .select({
            id: comment.id,
            boardId: comment.boardId,
            body: comment.body,
            mentions: comment.mentions,
            deletedAt: comment.deletedAt,
            threadId: comment.threadId,
          })
          .from(comment)
          .where(inArray(comment.id, commentIds)),
    boardIds.length === 0
      ? []
      : db
          .select({ id: board.id, title: board.title })
          .from(board)
          .where(inArray(board.id, boardIds)),
    projectIds.length === 0
      ? []
      : db
          .select({ id: project.id, name: project.name })
          .from(project)
          .where(inArray(project.id, projectIds)),
  ]);
  const people = await loadPeople(
    db,
    { id: userId },
    [...rows.map((r) => r.actorId), ...comments.flatMap((c) => c.mentions)],
    rows.map((r) => r.actorGuestId),
    rows.map((r) => r.shareLinkId),
  );
  const subjectIds = [...new Set(rows.flatMap((r) => (r.subjectUserId ? [r.subjectUserId] : [])))];
  const subjects = new Map(
    (subjectIds.length === 0
      ? []
      : await db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(inArray(user.id, subjectIds))
    ).map((u) => [u.id, u]),
  );
  const names = new Map([...people.users].map(([id, u]) => [id, u.name]));
  const readableNames = new Map<string, Map<string, string>>();
  for (const boardId of new Set(comments.map((c) => c.boardId))) {
    const ids = comments.filter((c) => c.boardId === boardId).flatMap((c) => c.mentions);
    const roles = await boardRolesForPeople(db, boardId, ids);
    readableNames.set(
      boardId,
      new Map(
        [...roles.keys()].flatMap((id) => (names.has(id) ? [[id, names.get(id) as string]] : [])),
      ),
    );
  }
  const byComment = new Map(comments.map((c) => [c.id, c]));
  const titles = new Map(boards.map((b) => [b.id, b.title]));
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  return rows.map((r) => {
    const c = r.commentId ? byComment.get(r.commentId) : undefined;
    return {
      id: r.id,
      type: r.type,
      // Every event has an actor; once their account is gone the actor shows as deleted.
      actor: r.type === 'link_opened' ? null : authorOf(people, r.actorId, r.actorGuestId),
      projectId: r.projectId,
      projectName: r.projectId ? (projectNames.get(r.projectId) ?? null) : null,
      boardId: r.boardId,
      boardTitle: r.boardId ? (titles.get(r.boardId) ?? null) : null,
      elementId: r.elementId,
      commentId: r.commentId,
      // The thread's start comment: the start itself has no parent, replies point to the start.
      threadId: c ? (c.threadId ?? c.id) : null,
      excerpt:
        c && !c.deletedAt ? excerpt(c.body, readableNames.get(c.boardId) ?? new Map()) : null,
      reviewStatus: r.reviewStatus,
      subject: r.subjectUserId ? (subjects.get(r.subjectUserId) ?? null) : null,
      accessExpiresAt: r.accessExpiresAt ? iso(r.accessExpiresAt) : null,
      shareLinkLabel: r.shareLinkId ? labelOf(people, r.shareLinkId) : null,
      ...(r.type === 'server_alert' ? { serverAlert: r.serverAlert ?? null } : {}),
      readAt: r.readAt ? iso(r.readAt) : null,
      createdAt: iso(r.createdAt),
    };
  });
}

/** Unread notifications the list would show, at most `cap`. */
export async function unreadCount(db: Database, userId: string, cap = 1000): Promise<number> {
  const groups = await db
    .select({
      boardId: notification.boardId,
      projectId: notification.projectId,
      subjectUserId: notification.subjectUserId,
      n: sql<number>`count(*)::int`,
    })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .groupBy(notification.boardId, notification.projectId, notification.subjectUserId);
  const visible = await visibility(db, userId, groups);
  let total = 0;
  for (const g of groups) if (visible(g)) total += g.n;
  return Math.min(total, cap);
}

// Email ----------------------------------------------------------------------

export interface NotificationMailDeps {
  db: Database;
  mailer: Mailer;
  log: Logger;
  publicUrl: string;
  instanceName: string;
}

/** Hidden mail is handled once, even if access comes back later. Keep the in-app row. */
async function skipHiddenMail(
  db: Database,
  rows: NotificationRow[],
  visible: (row: NotificationRow) => boolean,
) {
  const ids = rows.filter((r) => !visible(r)).map((r) => r.id);
  if (ids.length)
    await db
      .update(notification)
      .set({ emailedAt: new Date() })
      .where(and(inArray(notification.id, ids), isNull(notification.emailedAt)));
}

/**
 * Sends one email with the pending notifications of a person, after checking again that they
 * can open each board. The rows are claimed before sending, so two workers never send them
 * twice; if sending fails they are released for the next run.
 */
async function sendTo(
  deps: NotificationMailDeps,
  userId: string,
  pending: NotificationRow[],
  kind: 'immediate' | 'daily',
  now: Date,
) {
  const { db, mailer } = deps;
  const [preference] = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, userId));
  if ((preference?.email ?? 'immediate') !== kind) return false;
  // Types turned off for email (#302) count as sent, so they never wait for a later email.
  const emailOff = new Set(preference?.emailOff ?? []);
  const seen = await visibility(db, userId, pending);
  const visible = (row: NotificationRow) => seen(row) && !emailOff.has(row.type);
  await skipHiddenMail(db, pending, visible);
  const shown = pending.filter(visible);
  if (shown.length === 0) return false;
  // A lease, not the final mark (#812): marked sent only once the server took the email.
  const claimed = await db
    .update(notification)
    .set({ emailLeaseUntil: new Date(+now + EMAIL_LEASE_MS) })
    .where(
      and(
        inArray(
          notification.id,
          shown.map((n) => n.id),
        ),
        isNull(notification.emailedAt),
        isNull(notification.readAt),
        unleased(now),
      ),
    )
    .returning({ id: notification.id });
  const ids = new Set(claimed.map((c) => c.id));
  const rows = shown.filter((n) => ids.has(n.id));
  if (rows.length === 0) return false;
  try {
    const [me] = await db
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, userId));
    if (!me) return false;
    const items = await renderNotifications(db, userId, rows);
    await mailer.send({
      ...notificationMail({
        to: me.email,
        recipient: { id: userId, locale: me.locale },
        notifications: items,
        daily: kind === 'daily',
        instance: deps,
      }),
      messageId: notificationMessageId([...ids], deps.publicUrl),
    });
  } catch (err) {
    // Tried again after 2, 4, 8… minutes (at most an hour); given up after MAX_EMAIL_ATTEMPTS.
    const attempts = sql`${notification.emailAttempts} + 1`;
    await db
      .update(notification)
      .set({
        emailAttempts: attempts,
        emailLeaseUntil: sql`${now.toISOString()}::timestamptz + make_interval(mins => least(60, power(2, ${attempts})::int))`,
        emailedAt: sql`case when ${attempts} >= ${MAX_EMAIL_ATTEMPTS} then ${now.toISOString()}::timestamptz end`,
      })
      .where(and(inArray(notification.id, [...ids]), isNull(notification.emailedAt)));
    throw err;
  }
  await db
    .update(notification)
    .set({ emailedAt: now, emailLeaseUntil: null })
    .where(inArray(notification.id, [...ids]));
  return true;
}

/** Not claimed by a run that may still be sending it (#812). */
const unleased = (now: Date) =>
  or(isNull(notification.emailLeaseUntil), lt(notification.emailLeaseUntil, now));

/**
 * The same notifications give the same Message-ID (#812): an email sent again after a crash
 * between the send and its mark is one message for clients that deduplicate.
 */
export function notificationMessageId(ids: string[], publicUrl: string) {
  const digest = createHash('sha256')
    .update([...ids].sort().join(','))
    .digest('hex')
    .slice(0, 32);
  return `<notifications.${digest}@${new URL(publicUrl).hostname}>`;
}

/** Runs `work` over `items`, `size` at a time. */
async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size)
    await Promise.all(items.slice(i, i + size).map(work));
}

/**
 * Failed sends are counted, not hidden (#812): when as many fail as go out, the job fails, so
 * the Server page shows an email problem instead of users finding out.
 */
function failIfBroken(kind: string, sent: number, failed: number, first: unknown) {
  if (failed === 0 || failed < sent) return;
  const reason = first instanceof Error ? first.message : String(first);
  throw new Error(`${failed} of ${sent + failed} ${kind} emails not sent: ${reason}`);
}

/** Pending unread mail, bounded per person and paged past inaccessible boards. */
async function pendingByPerson(
  db: Database,
  kind: 'immediate' | 'daily',
  since: Date,
  now = new Date(),
) {
  const eligible = and(
    isNull(notification.emailedAt),
    isNull(notification.readAt),
    unleased(now),
    gt(notification.createdAt, since),
    kind === 'immediate'
      ? or(isNull(notificationPreference.email), eq(notificationPreference.email, 'immediate'))
      : eq(notificationPreference.email, 'daily'),
  );
  const people = await db
    .selectDistinct({ userId: notification.userId })
    .from(notification)
    .leftJoin(notificationPreference, eq(notificationPreference.userId, notification.userId))
    .where(eligible);
  const byPerson = new Map<string, NotificationRow[]>();
  for (const { userId } of people) {
    const kept: NotificationRow[] = [];
    let cursor: Keyset | null = null;
    do {
      const rows: Array<NotificationRow & { at: string }> = await db
        .select({ ...getTableColumns(notification), at: atText(notification.createdAt) })
        .from(notification)
        .where(
          and(
            eq(notification.userId, userId),
            isNull(notification.emailedAt),
            isNull(notification.readAt),
            unleased(now),
            gt(notification.createdAt, since),
            cursor
              ? afterCursor(notification.createdAt, notification.id, cursor, 'asc')
              : undefined,
          ),
        )
        .orderBy(asc(notification.createdAt), asc(notification.id))
        .limit(500);
      const visible = await visibility(db, userId, rows);
      await skipHiddenMail(db, rows, visible);
      kept.push(...rows.filter(visible).slice(0, MAX_PER_EMAIL - kept.length));
      const last = rows.at(-1);
      cursor = rows.length === 500 && last ? { at: last.at, id: last.id } : null;
    } while (cursor && kept.length < MAX_PER_EMAIL);
    if (kept.length > 0) byPerson.set(userId, kept);
  }
  return byPerson;
}

/**
 * `immediate`: one email per person with what arrived since the last one, a few minutes after
 * the first unread notification. Run every minute by the worker.
 */
export async function sendImmediateEmails(deps: NotificationMailDeps, now = new Date()) {
  if (!deps.mailer.enabled) return { sent: 0, failed: 0 };
  const byPerson = await pendingByPerson(
    deps.db,
    'immediate',
    new Date(+now - NOTIFICATION_RETENTION_DAYS * 86_400_000),
    now,
  );
  let sent = 0;
  let failed = 0;
  let firstError: unknown;
  await inBatches([...byPerson], EMAIL_BATCH, async ([userId, pending]) => {
    // Grouping waits from the first notification the person may see: `pendingByPerson` keeps
    // only those, oldest first.
    const first = pending[0];
    if (!first || +now - +first.createdAt < EMAIL_GROUP_DELAY_MS) return;
    try {
      if (await sendTo(deps, userId, pending, 'immediate', now)) sent += 1;
    } catch (err) {
      failed += 1;
      firstError ??= err;
      deps.log.error({ err }, 'notification email not sent');
    }
  });
  failIfBroken('notification', sent, failed, firstError);
  return { sent, failed };
}

/** `daily`: one digest a day of what is still unread. Run every hour by the worker. */
export async function sendDigests(deps: NotificationMailDeps, now = new Date()) {
  if (!deps.mailer.enabled) return { sent: 0, failed: 0 };
  const byPerson = await pendingByPerson(
    deps.db,
    'daily',
    new Date(+now - NOTIFICATION_RETENTION_DAYS * 86_400_000),
    now,
  );
  let sent = 0;
  let failed = 0;
  let firstError: unknown;
  await inBatches([...byPerson], EMAIL_BATCH, async ([userId, pending]) => {
    // A digest at most every 24 hours, give or take the hourly run.
    const due = new Date(+now - 24 * 3_600_000);
    const claimed = await deps.db
      .update(notificationPreference)
      .set({ lastDigestAt: now })
      .where(
        and(
          eq(notificationPreference.userId, userId),
          or(
            isNull(notificationPreference.lastDigestAt),
            lt(notificationPreference.lastDigestAt, due),
          ),
        ),
      )
      .returning({ userId: notificationPreference.userId });
    if (claimed.length === 0) return;
    let delivered = false;
    try {
      delivered = await sendTo(deps, userId, pending, 'daily', now);
      if (delivered) sent += 1;
    } catch (err) {
      failed += 1;
      firstError ??= err;
      deps.log.error({ err }, 'notification digest not sent');
    } finally {
      if (!delivered)
        await deps.db
          .update(notificationPreference)
          .set({ lastDigestAt: null })
          .where(
            and(
              eq(notificationPreference.userId, userId),
              eq(notificationPreference.lastDigestAt, now),
            ),
          );
    }
  });
  failIfBroken('digest', sent, failed, firstError);
  return { sent, failed };
}

/** Retention: notifications go after 90 days. */
export async function purgeNotifications(db: Database, now = new Date()) {
  const cutoff = new Date(+now - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  let removed = 0;
  let count: number;
  do {
    const result = await db
      .delete(notification)
      .where(
        inArray(
          notification.id,
          db
            .select({ id: notification.id })
            .from(notification)
            .where(lt(notification.createdAt, cutoff))
            .limit(1000),
        ),
      );
    count = result.count;
    removed += count;
  } while (count === 1000);
  return { removed };
}
