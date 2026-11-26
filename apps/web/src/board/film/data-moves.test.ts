// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { sceneMoveGate } from './data-moves.ts';

describe('sceneMoveGate', () => {
  it('lets one move through per board until it is released', () => {
    const gate = sceneMoveGate('board-a');
    expect(gate.claim()).toBe(true);
    // A second move, or Undo, while the first runs: refused; another board is free.
    expect(gate.claim()).toBe(false);
    expect(sceneMoveGate('board-b').claim()).toBe(true);
    sceneMoveGate('board-b').release();
    gate.release();
    expect(gate.claim()).toBe(true);
    gate.release();
  });

  it('outlives the canvas: a remount finds it busy, a late release is heard', () => {
    const first = sceneMoveGate('board-c');
    first.claim();
    // The canvas is unmounted by a view switch and mounted again: same gate.
    const again = sceneMoveGate('board-c');
    expect(again.busy).toBe(true);
    expect(again.claim()).toBe(false);
    // The ⋯ menu listens; the move ends after the canvas is gone.
    const menu = vi.fn();
    const stop = sceneMoveGate('board-c').subscribe(menu);
    first.release();
    expect(menu).toHaveBeenCalledOnce();
    expect(sceneMoveGate('board-c').busy).toBe(false);
    stop();
  });
});
