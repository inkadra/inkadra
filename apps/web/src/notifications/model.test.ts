// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dayLabel, notificationPath } from './model.ts';

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
