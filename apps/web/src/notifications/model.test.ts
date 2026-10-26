// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dayLabel, filterNotifications, notificationPath, unreadBadge } from './model.ts';

describe('notificationPath', () => {
  it('opens the board on the card and the thread', () => {
    expect(
      notificationPath({ projectId: 'p', boardId: 'b', elementId: 'card', commentId: 'c' }),
    ).toBe('/p/p/b/b?el=card&view=canvas&thread=c');
    expect(
      notificationPath({ projectId: 'p', boardId: 'b', elementId: null, commentId: 'c' }),
    ).toBe('/p/p/b/b?thread=c');
  });

  it('locates a reply by its thread and the comment, and a thread start by itself', () => {
    expect(
      notificationPath({
        projectId: 'p',
        boardId: 'b',
        elementId: 'card',
        commentId: 'r',
        threadId: 't',
      }),
    ).toBe('/p/p/b/b?el=card&view=canvas&thread=t&comment=r');
    expect(
      notificationPath({
        projectId: 'p',
        boardId: 'b',
        elementId: null,
        commentId: 's',
        threadId: 's',
      }),
    ).toBe('/p/p/b/b?thread=s');
  });

  it('falls back to the comment when the thread id is missing or null', () => {
    // Undefined: a notification from a server before API 0.5.0.
    expect(
      notificationPath({ projectId: 'p', boardId: 'b', elementId: null, commentId: 'c' }),
    ).toBe('/p/p/b/b?thread=c');
    expect(
      notificationPath({
        projectId: 'p',
        boardId: 'b',
        elementId: null,
        commentId: 'c',
        threadId: null,
      }),
    ).toBe('/p/p/b/b?thread=c');
  });

  it('opens the project for an accepted invitation and nothing without a project', () => {
    expect(
      notificationPath({ projectId: 'p', boardId: null, elementId: null, commentId: null }),
    ).toBe('/p/p');
    expect(
      notificationPath({ projectId: null, boardId: null, elementId: null, commentId: null }),
    ).toBeNull();
  });
});

describe('dayLabel', () => {
  const t = (key: string) => (key === 'notifications.today' ? 'Oggi' : 'Ieri');
  const now = new Date(2026, 9, 24, 9, 0);

  it('names today and yesterday by local day, not by 24 hours', () => {
    expect(dayLabel(new Date(2026, 9, 24, 0, 5), now, 'it', t)).toBe('Oggi');
    expect(dayLabel(new Date(2026, 9, 23, 23, 55), now, 'it', t)).toBe('Ieri');
  });

  it('writes older days as dates, with the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 9, 20), now, 'it', t)).toBe('20 ottobre');
    expect(dayLabel(new Date(2025, 9, 20), now, 'it', t)).toBe('20 ottobre 2025');
  });
});

describe('inbox filters and unread badge', () => {
  const items = [
    { type: 'mention' as const, readAt: null },
    { type: 'mention' as const, readAt: '2026-10-26T00:00:00Z' },
    { type: 'comment' as const, readAt: null },
    { type: 'reply' as const, readAt: null },
    { type: 'review' as const, readAt: null, reviewStatus: null },
    { type: 'invitation_accepted' as const, readAt: null, reviewStatus: null },
  ];
  it('includes only mentions, including read mentions, in the mentions list', () => {
    expect(filterNotifications(items, 'mentions')).toEqual(items.slice(0, 2));
    expect(filterNotifications(items, 'approvals')).toEqual([items[4]]);
    expect(filterNotifications(items, 'all')).toEqual(items);
  });
  it('uses the global unread total independently of read items and loaded pages', () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(1)).toBe('1');
    expect(unreadBadge(120)).toBe('99+');
    filterNotifications(items.concat(items), 'mentions');
    expect(unreadBadge(1)).toBe('1');
  });
});
