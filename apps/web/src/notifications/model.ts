// SPDX-License-Identifier: AGPL-3.0-only
import type { Notification } from '@inkadra/shared';
import { formatDateTime } from '../lib/datetime.ts';

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
  'task_assigned',
  'feedback_received',
  'review_submitted',
  'server_alert',
  'update_available',
] as const;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday" or the weekday and date, in the local time zone. */
export function dayLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: 'notifications.today' | 'notifications.yesterday') => string,
): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return t('notifications.today');
  if (days === 1) return t('notifications.yesterday');
  return formatDateTime(
    date,
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    },
    undefined,
    locale,
  );
}

export type InboxFilter = 'all' | 'mentions' | 'approvals' | 'tasks';
export function filterNotifications<T extends Pick<Notification, 'type'>>(
  items: T[],
  filter: InboxFilter,
): T[] {
  return items.filter(
    (item) =>
      filter === 'all' ||
      item.type ===
        (filter === 'mentions' ? 'mention' : filter === 'tasks' ? 'task_assigned' : 'review'),
  );
}
/** The badge comes from the API total, never from the currently loaded page. */
export function unreadBadge(unread: number): string | null {
  return unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;
}

/** A row of a day in the Inbox: one notification, or several in-app reports folded into one. */
export type InboxEntry<T> = { kind: 'item'; item: T } | { kind: 'reports'; items: T[] };

/**
 * Folds the in-app reports of one day into a single entry where the first of them was; one
 * report alone stays a plain row. Only the view changes: every notification stays in the list.
 */
export function foldReports<T extends Pick<Notification, 'type'>>(items: T[]): InboxEntry<T>[] {
  const reports = items.filter((item) => item.type === 'feedback_received');
  if (reports.length < 2) return items.map((item) => ({ kind: 'item', item }));
  const entries: InboxEntry<T>[] = [];
  for (const item of items) {
    if (item.type !== 'feedback_received') entries.push({ kind: 'item', item });
    else if (item === reports[0]) entries.push({ kind: 'reports', items: reports });
  }
  return entries;
}
