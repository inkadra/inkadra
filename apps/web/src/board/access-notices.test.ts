import { describe, expect, it } from 'vitest';
import { accessNotices } from './access-notices.ts';

describe('accessNotices', () => {
  it('reports each access change once', () => {
    const next = accessNotices();
    expect(next({ accessChangedAt: null, readOnly: false })).toBeNull();
    expect(next({ accessChangedAt: 1, readOnly: true })).toEqual({ readOnly: true });
    // Same change again: a language switch re-renders, a reconnection repeats the role.
    expect(next({ accessChangedAt: 1, readOnly: true })).toBeNull();
    expect(next({ accessChangedAt: 1, readOnly: false })).toBeNull();
    expect(next({ accessChangedAt: 2, readOnly: false })).toEqual({ readOnly: false });
  });
});
