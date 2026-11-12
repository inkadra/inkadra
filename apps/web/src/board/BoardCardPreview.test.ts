// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { pendingReview } from './BoardCardPreview.tsx';

it('counts what the client has not decided yet, never below zero', () => {
  expect(pendingReview({ total: 10, approved: 6, changes: 1 })).toBe(3);
  expect(pendingReview({ total: 10, approved: 10, changes: 0 })).toBe(0);
  expect(pendingReview({ total: 2, approved: 2, changes: 1 })).toBe(0);
});
