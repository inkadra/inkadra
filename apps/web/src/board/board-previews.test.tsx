// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardPreview } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetBoardPreviews, useBoardPreview } from './board-previews.ts';

const get = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.ts', async (actual) => ({
  ...(await actual<typeof import('../lib/api.ts')>()),
  api: { get },
}));

const preview = (approved: number): BoardPreview => ({
  assetIds: [],
  excerpts: [],
  elementCount: 1,
  drawing: [],
  review: { approved, changes: 0, total: 3 },
});

function Card({ id }: { id: string }) {
  const entry = useBoardPreview(id, 'v1');
  return <output>{entry?.status === 'ready' ? entry.preview.review?.approved : '-'}</output>;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let hidden = false;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  let approved = 0;
  get.mockReset();
  get.mockImplementation(async () => preview(approved++));
  resetBoardPreviews();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const minute = () => act(async () => vi.advanceTimersByTimeAsync(60_000));

it('refreshes a card that stays drawn when its preview goes stale, once per board', async () => {
  // Two cards of the same board and one of another.
  await act(async () =>
    root.render(
      <>
        <Card id="a" />
        <Card id="a" />
        <Card id="b" />
      </>,
    ),
  );
  expect(get).toHaveBeenCalledTimes(2);
  expect([...host.querySelectorAll('output')].map((o) => o.textContent)).toEqual(['0', '0', '1']);
  await act(async () => vi.advanceTimersByTimeAsync(59_000));
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  // One request a board, not a card: the new review decision shows on both cards of `a`.
  expect(get).toHaveBeenCalledTimes(4);
  expect(get.mock.calls.filter(([path]) => path === '/boards/a/preview')).toHaveLength(2);
  expect(host.querySelectorAll('output')[0]?.textContent).toBe(
    host.querySelectorAll('output')[1]?.textContent,
  );
  expect(host.querySelectorAll('output')[0]?.textContent).not.toBe('0');
  await minute();
  expect(get).toHaveBeenCalledTimes(6);

  // Nothing while the tab is hidden; once visible again, the stale previews are asked once.
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await minute();
  await minute();
  expect(get).toHaveBeenCalledTimes(6);
  hidden = false;
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(get).toHaveBeenCalledTimes(8);
  await minute();
  expect(get).toHaveBeenCalledTimes(10);

  // A card no longer drawn is not refreshed.
  await act(async () => root.render(<Card id="a" />));
  await minute();
  expect(get).toHaveBeenCalledTimes(11);
  await act(async () => root.render(null));
  await minute();
  await minute();
  expect(get).toHaveBeenCalledTimes(11);
});

it('refreshes a card drawn again while its preview was still fresh', async () => {
  await act(async () => root.render(<Card id="a" />));
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  await act(async () => root.render(<Card id="a" />));
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(get).toHaveBeenCalledTimes(2);
  expect(host.querySelector('output')?.textContent).toBe('1');
});
