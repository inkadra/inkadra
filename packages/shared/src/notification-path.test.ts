// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { notificationPath } from './notifications.ts';

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
