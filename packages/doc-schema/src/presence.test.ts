// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { presenceColor, readPresence } from './index.ts';

const user = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', name: 'Giulia', image: null };

describe('presence', () => {
  it('reads a complete state', () => {
    const state = { user, readOnly: false, cursor: { x: 10, y: -4 }, selection: [], editing: null };
    expect(readPresence(state)).toEqual(state);
  });

  it('ignores malformed states', () => {
    expect(readPresence(null)).toBeNull();
    expect(readPresence({ user })).toBeNull();
    expect(
      readPresence({ user, readOnly: false, cursor: { x: Number.NaN, y: 0 }, selection: [] }),
    ).toBeNull();
  });

  it('gives each person a stable colour', () => {
    expect(presenceColor(user.id, 8)).toBe(presenceColor(user.id, 8));
    expect(presenceColor(user.id, 8)).toBeGreaterThanOrEqual(0);
    expect(presenceColor(user.id, 8)).toBeLessThan(8);
  });
});
