import type { GuestBoard, GuestElementReview, GuestPick } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../lib/api.ts';
import {
  boardPath,
  boardTree,
  canWithdraw,
  cardLabel,
  failureOf,
  isPicture,
  knownRole,
  rightsOf,
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
    expect(failureOf(new Error('offline'))).toEqual({ kind: 'stop', stop: 'error' });
    expect(failureOf(denied(400))).toEqual({ kind: 'other' });
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
