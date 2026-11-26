// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { oneAtATime } from './data-moves.ts';

describe('oneAtATime', () => {
  it('lets one move through until it is released', () => {
    const gate = oneAtATime();
    expect(gate.claim()).toBe(true);
    expect(gate.busy).toBe(true);
    // A second move, or Undo, while the first runs: refused.
    expect(gate.claim()).toBe(false);
    gate.release();
    expect(gate.claim()).toBe(true);
  });
});
