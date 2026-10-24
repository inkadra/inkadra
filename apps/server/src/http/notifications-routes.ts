import {
  API_PREFIX,
  Id,
  MarkAllRead,
  type NotificationPreferences,
  NotificationQuery,
  type UnreadCount,
  UpdateNotificationPreferences,
  z,
} from '@inkadra/shared';
import { and, desc, eq, getTableColumns, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { notification, notificationPreference } from '../db/schema.ts';
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
      items: await renderNotifications(db, page.rows.filter(visible)),
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
    const pending = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, actor.id),
          isNull(notification.readAt),
          lte(notification.createdAt, before),
        ),
      );
    const visible = await visibility(db, actor.id, pending);
    const ids = pending.filter(visible).map((n) => n.id);
    if (ids.length > 0)
      await db
        .update(notification)
        .set({ readAt: new Date() })
        .where(and(eq(notification.userId, actor.id), inArray(notification.id, ids)));
    const body: UnreadCount = { unread: await unreadCount(db, actor.id) };
    return body;
  });

  async function preferences(userId: string): Promise<NotificationPreferences> {
    const [row] = await db
      .select({ email: notificationPreference.email })
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));
    return { email: row?.email ?? 'immediate' };
  }

  app.get(v1('/me/notification-preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    return preferences(actor.id);
  });

  app.patch(v1('/me/notification-preferences'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const patch = UpdateNotificationPreferences.parse(req.body ?? {});
    if (patch.email)
      await db
        .insert(notificationPreference)
        .values({ userId: actor.id, email: patch.email })
        .onConflictDoUpdate({
          target: notificationPreference.userId,
          set: { email: patch.email, updatedAt: new Date() },
        });
    return preferences(actor.id);
  });
}
