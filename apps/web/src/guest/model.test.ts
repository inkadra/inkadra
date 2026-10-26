import type {
  GuestBoard,
  GuestBoardSnapshot,
  GuestElement,
  GuestElementReview,
  GuestPick,
} from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../lib/api.ts';
import {
  boardPath,
  boardTree,
  COOKIE_CHECK_MS,
  canWithdraw,
  cardLabel,
  failureOf,
  isPicture,
  knownRole,
  needsSession,
  onNoSession,
  retryAfterMs,
  rightsOf,
  SESSION_REFRESH_MS,
  shotLabels,
  shownStatus,
  togglePick,
  toggleStars,
} from './model.ts';

const denied = (status: number, reason?: string) =>
  new RequestError(status, 'forbidden', 'x', reason ? { reason } : undefined);

describe('guest failures', () => {
  it('maps the reasons of the server to what the page shows', () => {
    expect(failureOf(denied(403, 'password_required'))).toEqual({ kind: 'password', wrong: false });
    expect(failureOf(denied(403, 'wrong_password'))).toEqual({ kind: 'password', wrong: true });
    expect(failureOf(denied(403, 'name_required'))).toEqual({ kind: 'name' });
    expect(failureOf(denied(403, 'revoked'))).toEqual({ kind: 'stop', stop: 'revoked' });
    expect(failureOf(denied(403, 'expired'))).toEqual({ kind: 'stop', stop: 'expired' });
    expect(failureOf(denied(403, 'unavailable'))).toEqual({ kind: 'stop', stop: 'unavailable' });
    expect(failureOf(denied(401, 'no_session'))).toEqual({ kind: 'stop', stop: 'no_session' });
    expect(failureOf(denied(404))).toEqual({ kind: 'stop', stop: 'not_found' });
    expect(failureOf(denied(429))).toEqual({ kind: 'stop', stop: 'rate_limited' });
  });

  it('shows a reason it does not know as a generic error', () => {
    expect(failureOf(denied(403, 'something_new'))).toEqual({ kind: 'stop', stop: 'error' });
    expect(failureOf(denied(400))).toEqual({ kind: 'other' });
  });

  it('treats no answer and server errors as temporary', () => {
    expect(failureOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'transient' });
    expect(failureOf(denied(500))).toEqual({ kind: 'transient' });
    expect(failureOf(denied(503))).toEqual({ kind: 'transient' });
  });
});

describe('Retry-After', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(retryAfterMs('30', now)).toBe(30_000);
    expect(retryAfterMs('Sat, 24 Oct 2026 10:01:00 GMT', now)).toBe(60_000);
    expect(retryAfterMs('Sat, 24 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs(null, now)).toBeUndefined();
    expect(retryAfterMs('soon', now)).toBeUndefined();
  });
});

describe('lost session', () => {
  it('opens the link again once, then asks for cookies', () => {
    expect(onNoSession(null, 1000)).toBe('reopen');
    expect(onNoSession(1000, 1000 + COOKIE_CHECK_MS - 1)).toBe('cookies');
    // A session that lasted, then expired, is opened again.
    expect(onNoSession(1000, 1000 + COOKIE_CHECK_MS)).toBe('reopen');
    expect(onNoSession(null, 1000, false)).toBe('cookies');
  });
});

describe('session refresh', () => {
  const board: GuestBoard = {
    id: 'b1',
    parentBoardId: null,
    kind: 'board',
    title: 'Set',
    coverUrl: null,
  } as GuestBoard;
  const snap = (version: string, title = 'Set', elements: unknown[] = []) =>
    ({
      board: { ...board, title, aspect: null },
      breadcrumb: [],
      elements,
      assets: [],
      reviews: [],
      commentCounts: [],
      picks: [],
      version,
      generatedAt: version,
    }) as unknown as GuestBoardSnapshot;
  const session = { boards: [board] };

  it('asks only when the link may have changed', () => {
    const now = 10_000;
    // Content changed: the snapshot explains the new version.
    expect(needsSession(snap('1'), snap('2', 'Set', [{ id: 'e' }]), session, now, now)).toBe(false);
    // Same content, new version: something outside the snapshot moved, like the link.
    expect(needsSession(snap('1'), snap('2'), session, now, now)).toBe(true);
    // The board no longer matches the session.
    expect(needsSession(snap('1'), snap('2', 'Nuovo titolo'), session, now, now)).toBe(true);
    // And at least once a minute while the board changes.
    expect(
      needsSession(snap('1'), snap('2', 'Set', [{ id: 'e' }]), session, 0, SESSION_REFRESH_MS),
    ).toBe(true);
  });

  it('asks again on an unchanged board once the last check is a minute old', () => {
    // A 304 brings no snapshot: a link change seen with an earlier board change must still show.
    expect(needsSession(snap('2'), null, session, 0, SESSION_REFRESH_MS - 1)).toBe(false);
    expect(needsSession(snap('2'), null, session, 0, SESSION_REFRESH_MS)).toBe(true);
  });
});

describe('guest rights', () => {
  it('treats an unknown role like guest_view', () => {
    expect(knownRole('guest_owner')).toBe('guest_view');
    expect(rightsOf({ role: 'guest_owner', proofing: false, allowDownload: false })).toEqual({
      comments: false,
      review: false,
      pick: false,
      download: false,
    });
  });

  it('follows the role and the options of the link', () => {
    expect(rightsOf({ role: 'guest_comment', proofing: true, allowDownload: true })).toEqual({
      comments: true,
      review: false,
      pick: true,
      download: true,
    });
    expect(rightsOf({ role: 'guest_approve', proofing: false, allowDownload: false }).review).toBe(
      true,
    );
  });

  it('picks only pictures', () => {
    expect(isPicture({ type: 'image', assetId: 'a' })).toBe(true);
    expect(isPicture({ type: 'frame', assetId: 'a' })).toBe(true);
    expect(isPicture({ type: 'frame' })).toBe(false);
    expect(isPicture({ type: 'file', assetId: 'a' })).toBe(false);
  });
});

const review = (status: string, isYou: boolean): GuestElementReview =>
  ({
    elementId: 'el-000001',
    status,
    note: null,
    changedBy: { kind: isYou ? 'guest' : 'team', name: 'Ada', isYou },
    changedAt: new Date().toISOString(),
  }) as GuestElementReview;

describe('guest reviews', () => {
  it('withdraws only a decision the guest made and still sees', () => {
    expect(canWithdraw(review('approved', true))).toBe(true);
    expect(canWithdraw(review('changes_requested', true))).toBe(true);
    expect(canWithdraw(review('approved', false))).toBe(false);
    expect(canWithdraw(review('none', true))).toBe(false);
    expect(canWithdraw(undefined)).toBe(false);
  });

  it('shows unknown statuses like in_review', () => {
    expect(shownStatus('approved')).toBe('approved');
    expect(shownStatus('on_hold')).toBe('in_review');
    expect(shownStatus('none')).toBe('none');
    expect(shownStatus(undefined)).toBe('none');
  });
});

describe('guest picks', () => {
  const current = { pick: 'picked', stars: 3 } as GuestPick;
  it('clears the current choice on a second click', () => {
    expect(togglePick(current, 'picked')).toEqual({ pick: null });
    expect(togglePick(current, 'rejected')).toEqual({ pick: 'rejected' });
    expect(togglePick(undefined, 'picked')).toEqual({ pick: 'picked' });
    expect(toggleStars(current, 3)).toEqual({ stars: null });
    expect(toggleStars(current, 5)).toEqual({ stars: 5 });
  });
});

describe('guest boards', () => {
  const b = (id: string, parentBoardId: string | null): GuestBoard => ({
    id,
    parentBoardId,
    kind: 'board',
    title: id,
    coverUrl: null,
  });
  const boards = [b('top', null), b('a', 'top'), b('a1', 'a'), b('b', 'top')];

  it('walks the tree from the board of the link', () => {
    expect(boardTree(boards, 'top').map((x) => [x.board.id, x.depth])).toEqual([
      ['top', 0],
      ['a', 1],
      ['a1', 2],
      ['b', 1],
    ]);
    expect(boardPath(boards, 'a1').map((x) => x.id)).toEqual(['top', 'a', 'a1']);
  });

  it('survives a cycle', () => {
    expect(boardPath([b('x', 'y'), b('y', 'x')], 'x').map((x) => x.id)).toEqual(['y', 'x']);
  });
});

describe('card labels', () => {
  it('names a card from its text', () => {
    expect(cardLabel({ type: 'image', caption: 'Alba' })).toBe('Alba');
    expect(
      cardLabel({
        type: 'note',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ciao' }] }],
        },
      }),
    ).toBe('Ciao');
    expect(cardLabel({ type: 'image' })).toBeNull();
    expect(cardLabel({ type: 'note', body: {} }, 5)).toBeNull();
    expect(cardLabel({ type: 'link', title: 'x'.repeat(80) }, 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('shot labels', () => {
  const el = (over: Record<string, unknown>): GuestElement =>
    ({
      id: 'e0000001',
      type: 'note',
      x: 0,
      y: 0,
      w: 10,
      z: '1',
      parent: null,
      createdBy: null,
      createdAt: 0,
      ...over,
    }) as GuestElement;

  it('names each frame as the canvas does: scene number plus letter, a number when loose', () => {
    const labels = shotLabels([
      el({ id: 's0000001', type: 'scene', number: '2', title: 'Il ponte', z: '1' }),
      el({ id: 'f0000001', type: 'frame', parent: 's0000001', z: '1' }),
      el({ id: 'f0000002', type: 'frame', parent: 's0000001', z: '2', label: 'X' }),
      el({ id: 'f0000003', type: 'frame', parent: null, z: '3' }),
      el({ id: 'f0000004', type: 'frame', parent: 'unsorted', z: '4' }),
      { id: 'broken', type: 'frame' } as GuestElement,
    ]);
    expect(labels.get('f0000001')).toBe('2A');
    expect(labels.get('f0000002')).toBe('X');
    expect(labels.get('f0000003')).toBe('1');
    expect(labels.get('f0000004')).toBe('2');
    expect(labels.has('broken')).toBe(false);
  });

  it('is empty without frames', () => {
    expect(shotLabels([el({})])).toEqual(new Map());
  });
});
