import type { GuestElement, GuestElementReview, GuestVersion } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { framesBefore, linkDecisions } from './model.ts';

const review = (elementId: string, status: string, kind: 'guest' | 'team') =>
  ({ elementId, status, changedBy: { kind, name: 'X', isYou: false } }) as GuestElementReview;

describe('the guest review on a phone (#110)', () => {
  it('sums up only the decisions of the link on the shots', () => {
    const reviews = new Map([
      ['a', review('a', 'approved', 'guest')],
      ['b', review('b', 'changes_requested', 'guest')],
      ['c', review('c', 'approved', 'team')],
      ['d', review('d', 'approved', 'guest')],
    ]);
    expect(linkDecisions(reviews, ['a', 'b', 'c'])).toEqual({ approved: 1, changes: 1 });
  });

  it('offers the versions where the shot looked different, newest first', () => {
    const now = { id: 'f1', type: 'frame', assetId: 'new', action: 'Neon' } as GuestElement;
    const version = (id: string, frames: GuestElement[]) =>
      ({ id, name: id, createdAt: '2026-11-01T00:00:00.000Z', frames }) as GuestVersion;
    const versions = [
      version('v3', [{ ...now }]),
      version('v2', [{ ...now, assetId: 'old' }]),
      version('v1', [{ id: 'f2', type: 'frame' } as GuestElement]),
    ];
    expect(framesBefore(versions, now).map((b) => b.version.id)).toEqual(['v2']);
  });
});
