// SPDX-License-Identifier: AGPL-3.0-only
import type { Notification } from '@inkadra/shared';

export const KNOWN_TYPES = [
  'mention',
  'reply',
  'comment',
  'review',
  'invitation_accepted',
  'export_ready',
  'import_ready',
  'access_expiring',
  'access_expired',
  'link_opened',
] as const;

/** Where a notification leads: the board, with the card selected and the thread open. */
export function notificationPath(
  item: Pick<Notification, 'projectId' | 'boardId' | 'elementId' | 'commentId' | 'threadId'>,
): string | null {
  if (!item.projectId) return null;
  const path = item.boardId ? `/p/${item.projectId}/b/${item.boardId}` : `/p/${item.projectId}`;
  if (!item.boardId) return path;
  const params = new URLSearchParams();
  if (item.elementId) {
    params.set('el', item.elementId);
    params.set('view', 'canvas');
  }
  if (item.commentId) {
    // The thread's start; for a thread start it is the comment itself, so no comment param.
    const thread = item.threadId ?? item.commentId;
    params.set('thread', thread);
    if (thread !== item.commentId) params.set('comment', item.commentId);
  }
  return params.size ? `${path}?${params}` : path;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday" or the date, in the local time zone. */
export function dayLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: 'notifications.today' | 'notifications.yesterday') => string,
): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return t('notifications.today');
  if (days === 1) return t('notifications.yesterday');
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export type InboxFilter = 'all' | 'mentions' | 'approvals';
export function filterNotifications<T extends Pick<Notification, 'type'>>(
  items: T[],
  filter: InboxFilter,
): T[] {
  return items.filter(
    (item) => filter === 'all' || item.type === (filter === 'mentions' ? 'mention' : 'review'),
  );
}
/** The badge comes from the API total, never from the currently loaded page. */
export function unreadBadge(unread: number): string | null {
  return unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;
}
