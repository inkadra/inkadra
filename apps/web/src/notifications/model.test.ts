// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dayLabel, filterNotifications, foldReports, unreadBadge } from './model.ts';

describe('dayLabel', () => {
  const t = (key: string) => (key === 'notifications.today' ? 'Oggi' : 'Ieri');
  const now = new Date(2026, 9, 24, 9, 0);

  it('names today and yesterday by local day, not by 24 hours', () => {
    expect(dayLabel(new Date(2026, 9, 24, 0, 5), now, 'it', t)).toBe('Oggi');
    expect(dayLabel(new Date(2026, 9, 23, 23, 55), now, 'it', t)).toBe('Ieri');
  });

  it('writes older days as weekday and date, with the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 9, 20), now, 'it', t)).toBe('martedì 20 ottobre');
    expect(dayLabel(new Date(2025, 9, 20), now, 'it', t)).toBe('lunedì 20 ottobre 2025');
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

describe('foldReports', () => {
  const report = (id: string) => ({ id, type: 'feedback_received' as const });
  const comment = (id: string) => ({ id, type: 'comment' as const });

  it('folds the in-app reports of a day into one entry where the first was', () => {
    const items = [comment('a'), report('r1'), comment('b'), report('r2')];
    expect(foldReports(items)).toEqual([
      { kind: 'item', item: items[0] },
      { kind: 'reports', items: [items[1], items[3]] },
      { kind: 'item', item: items[2] },
    ]);
  });

  it('keeps a single report as a plain row', () => {
    const items = [report('r1'), comment('a')];
    expect(foldReports(items)).toEqual([
      { kind: 'item', item: items[0] },
      { kind: 'item', item: items[1] },
    ]);
  });
});
