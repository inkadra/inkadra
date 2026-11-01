import {
  API_PREFIX,
  Id,
  INBOX_ALWAYS,
  MarkAllRead,
  NotificationChannelType,
  type NotificationPreferences,
  NotificationQuery,
  readUserPreferences,
  type UnreadCount,
  UpdateNotificationPreferences,
  UpdateUserPreferences,
  type UserPreferences,
  z,
} from '@inkadra/shared';
import { and, desc, eq, getTableColumns, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { notificationAccess } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { notification, notificationPreference, userPreference } from '../db/schema.ts';
import { renderNotifications, unreadCount, visibility } from '../notifications.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { afterCursor, atText, decodeCursor, pageOf } from './keyset.ts';

interface Deps {
  db: Database;
  auth: Auth;
}

const NotificationParams = z.object({ notificationId: Id });

export function registerNotificationRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/me/notifications'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const q = NotificationQuery.parse(req.query ?? {});
    const cursor = decodeCursor(q.cursor);
    const rows = await db
      .select({ ...getTableColumns(notification), at: atText(notification.createdAt) })
      .from(notification)
      .where(
        and(
          eq(notification.userId, actor.id),
          q.unread === 'true' ? isNull(notification.readAt) : undefined,
          cursor ? afterCursor(notification.createdAt, notification.id, cursor) : undefined,
        ),
      )
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(q.limit + 1);
    const page = pageOf(rows, q.limit);
    // Filtered after paging, so the cursor stays stable: a page can be short.
    const visible = await visibility(db, actor.id, page.rows);
    return {
      items: await renderNotifications(db, actor.id, page.rows.filter(visible)),
      nextCursor: page.nextCursor,
    };
  });

  app.get(v1('/me/notifications/unread-count'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const body: UnreadCount = { unread: await unreadCount(db, actor.id) };
    return body;
  });

  for (const action of ['read', 'unread'] as const) {
    app.post(v1(`/me/notifications/:notificationId/${action}`), async (req, reply) => {
      const actor = await requireActor(auth, req, db);
      const { notificationId } = NotificationParams.parse(req.params);
      const [candidate] = await db
        .select()
        .from(notification)
        .where(and(eq(notification.id, notificationId), eq(notification.userId, actor.id)));
      if (!candidate || !(await visibility(db, actor.id, [candidate]))(candidate))
        throw new HttpError('not_found', 'Notification not found.');
      const [row] = await db
        .update(notification)
        .set({ readAt: action === 'read' ? new Date() : null })
        .where(and(eq(notification.id, notificationId), eq(notification.userId, actor.id)))
        .returning({ id: notification.id });
      if (!row) throw new HttpError('not_found', 'Notification not found.');
      return reply.status(204).send();
    });
  }

  app.post(v1('/me/notifications/read-all'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const input = MarkAllRead.parse(req.body ?? {});
    const before = input.before ? new Date(input.before) : new Date();
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, actor.id),
          isNull(notification.readAt),
          lte(notification.createdAt, before),
          notificationAccess(actor.id),
        ),
      );
    const body: UnreadCount = { unread: await unreadCount(db, actor.id) };
    return body;
  });

  async function preferences(userId: string): Promise<NotificationPreferences> {
    const [row] = await db
      .select({
        email: notificationPreference.email,
        inboxOff: notificationPreference.inboxOff,
        emailOff: notificationPreference.emailOff,
      })
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));
    const known = (types: string[] | undefined) =>
      (types ?? []).filter(
        (t): t is NotificationChannelType => NotificationChannelType.safeParse(t).success,
      );
    return {
      email: row?.email ?? 'immediate',
      inboxOff: known(row?.inboxOff),
      emailOff: known(row?.emailOff),
    };
  }

  app.get(v1('/me/notification-preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    return preferences(actor.id);
  });

  app.patch(v1('/me/notification-preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const patch = UpdateNotificationPreferences.parse(req.body ?? {});
    if (patch.inboxOff || patch.emailOff) {
      await db.insert(notificationPreference).values({ userId: actor.id }).onConflictDoNothing();
      await db
        .update(notificationPreference)
        .set({
          // Mentions always reach the Inbox, whatever a client sends.
          ...(patch.inboxOff && {
            inboxOff: [...new Set(patch.inboxOff)].filter((t) => !INBOX_ALWAYS.includes(t)),
          }),
          ...(patch.emailOff && { emailOff: [...new Set(patch.emailOff)] }),
          updatedAt: new Date(),
        })
        .where(eq(notificationPreference.userId, actor.id));
    }
    if (patch.email) {
      const email = patch.email;
      await db.transaction(async (tx) => {
        await tx.insert(notificationPreference).values({ userId: actor.id }).onConflictDoNothing();
        const [previous] = await tx
          .select()
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, actor.id))
          .for('update');
        if (previous?.email === email) return;
        if (previous?.email === 'off' && email !== 'off') {
          // The preference lock serializes switches; only future notifications become mail.
          await tx
            .update(notification)
            .set({ emailedAt: sql`now()` })
            .where(
              and(
                eq(notification.userId, actor.id),
                isNull(notification.emailedAt),
                lte(notification.createdAt, sql`now()`),
              ),
            );
        }
        await tx
          .update(notificationPreference)
          .set({ email, updatedAt: new Date() })
          .where(eq(notificationPreference.userId, actor.id));
      });
    }
    return preferences(actor.id);
  });

  async function userPreferences(userId: string): Promise<UserPreferences> {
    const [row] = await db
      .select({ preferences: userPreference.preferences })
      .from(userPreference)
      .where(eq(userPreference.userId, userId));
    return readUserPreferences(row?.preferences);
  }

  app.get(v1('/me/preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    return userPreferences(actor.id);
  });

  app.patch(v1('/me/preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const patch = UpdateUserPreferences.parse(req.body ?? {});
    await db.transaction(async (tx) => {
      await tx.insert(userPreference).values({ userId: actor.id }).onConflictDoNothing();
      const [row] = await tx
        .select({ preferences: userPreference.preferences })
        .from(userPreference)
        .where(eq(userPreference.userId, actor.id))
        .for('update');
      // Fields this server does not know are kept for the clients that wrote them.
      await tx
        .update(userPreference)
        .set({ preferences: { ...row?.preferences, ...patch }, updatedAt: new Date() })
        .where(eq(userPreference.userId, actor.id));
    });
    return userPreferences(actor.id);
  });
}
