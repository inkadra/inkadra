// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', () => ({ api: { get } }));

import { loadOtherKits } from './project-kit.ts';

const entry = (kind: string, make: string) => ({
  key: `${kind}:${make}`,
  icon: { kind, make },
  modifiers: [],
  lenses: [],
});

describe('loadOtherKits (decision 0114)', () => {
  it('asks for the other boards, leaving out kinds this build does not know', async () => {
    get.mockResolvedValueOnce({ items: [entry('cob', 'Aputure'), entry('hologram', 'Future')] });
    const kit = await loadOtherKits('project-1', 'board-1');
    expect(get).toHaveBeenCalledWith('/projects/project-1/plan-kit?excludeBoardId=board-1');
    expect(kit?.map((e) => e.icon.make)).toEqual(['Aputure']);
  });

  it('answers null when it cannot be read, and asks again the next time', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    expect(await loadOtherKits('project-2', 'board-1')).toBeNull();
    get.mockResolvedValueOnce({ items: [entry('cob', 'Aputure')] });
    expect((await loadOtherKits('project-2', 'board-1'))?.length).toBe(1);
  });
});
