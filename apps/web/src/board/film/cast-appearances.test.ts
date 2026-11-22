// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', () => ({ api: { get } }));

import { loadCastAppearances } from './cast-appearances.ts';

afterEach(() => get.mockReset());

describe('loadCastAppearances', () => {
  it('keeps an answer, and asks again after a failure', async () => {
    const items = [{ name: 'marta', frames: 2, scenes: ['1'] }];
    get.mockResolvedValueOnce({ items });
    expect(await loadCastAppearances('project-1', 'board-1')).toEqual(items);
    expect(await loadCastAppearances('project-1', 'board-1')).toEqual(items);
    expect(get).toHaveBeenCalledTimes(1);

    // The server is busy: nothing to show, and nothing kept for the next card.
    get.mockRejectedValueOnce(new Error('unavailable'));
    expect(await loadCastAppearances('project-2', 'board-1')).toEqual([]);
    get.mockResolvedValueOnce({ items });
    expect(await loadCastAppearances('project-2', 'board-1')).toEqual(items);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
