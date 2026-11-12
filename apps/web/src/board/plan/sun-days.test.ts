// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useScheduleDays } from './sun-days.ts';

const get = vi.fn();
vi.mock('../../lib/api.ts', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

describe('useScheduleDays', () => {
  it('reads the schedule once per board, not on every render (an edit of the board)', async () => {
    get.mockReset();
    get.mockResolvedValue({ items: [], nextCursor: null });
    const host = document.createElement('div');
    const root = createRoot(host);
    for (let edit = 0; edit < 5; edit++)
      await act(async () => root.render(createElement(Probe, { boardId: 'boardA', edit })));
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Probe, { boardId: 'boardB', edit: 6 })));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('/boards/boardB/schedule');
    await act(async () => root.unmount());
  });

  it('shares one request between the parts of the editor that read the days', async () => {
    get.mockReset();
    get.mockResolvedValue({ items: [], nextCursor: null });
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement('div', null, [
          createElement(Probe, { key: 'a', boardId: 'boardC', edit: 0 }),
          createElement(Probe, { key: 'b', boardId: 'boardC', edit: 1 }),
        ]),
      ),
    );
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});

function Probe({ boardId, edit }: { boardId: string; edit: number }) {
  useScheduleDays(boardId);
  return createElement('span', null, edit);
}
