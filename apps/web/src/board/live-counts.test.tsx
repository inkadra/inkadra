// @vitest-environment happy-dom
import type { Board, BoardCount } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RELEASED_HOLD_MS } from '../routes/seed-queue.tsx';
import type { BoardConnection } from './connection.ts';
import { useBoardCounts, useLiveBoardCounts } from './live-counts.ts';

const counts = vi.hoisted(() => ({ items: [] as BoardCount[] }));
const get = vi.hoisted(() => vi.fn(async () => ({ items: counts.items })));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: { get },
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const boards = [{ id: 'b', editedAt: '2026-11-21T10:00:00.000Z' }] as unknown as Board[];
let shown: Map<string, BoardCount> = new Map();
function Navigation() {
  shown = useBoardCounts('p', boards);
  return null;
}
// A synced board holding two frames.
const snapshot = {
  byId: new Map(
    ['f1', 'f2'].map((id) => [id, { id, type: 'frame', status: 'todo', parent: null }]),
  ),
};
const conn = {
  status: 'synced',
  store: { subscribe: () => () => {}, getSnapshot: () => snapshot },
} as unknown as BoardConnection;
function Open() {
  useLiveBoardCounts(conn, 'b');
  return null;
}

it('counts a board again after it closes, keeping its own counts until the server has them', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = createRoot(host);
  // What the server stored before the visit: one frame.
  counts.items = [{ boardId: 'b', elementCount: 1, frameCount: 1, framesToShoot: 1 }];
  try {
    await act(async () =>
      root.render(
        <>
          <Navigation />
          <Open />
        </>,
      ),
    );
    expect(shown.get('b')?.frameCount).toBe(2);
    const asked = get.mock.calls.length;
    await act(async () => root.render(<Navigation />));
    expect(shown.get('b')?.frameCount).toBe(2);
    // Not stored yet when counted again: still ours.
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(get.mock.calls.length).toBe(asked + 1);
    expect(shown.get('b')?.frameCount).toBe(2);
    // Stored: the server's counts, asked for without any change to the board list.
    counts.items = [{ boardId: 'b', elementCount: 2, frameCount: 2, framesToShoot: 2 }];
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    // The one that found the server caught up, and one more for the other views.
    expect(get.mock.calls.length).toBe(asked + 3);
    expect(shown.get('b')?.frameCount).toBe(2);
    // The server caught up: nothing more to count again.
    await act(async () => vi.advanceTimersByTimeAsync(RELEASED_HOLD_MS));
    expect(get.mock.calls.length).toBe(asked + 3);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it('counts a closed board again while its store is retried, and gives up on its counts in the end', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = createRoot(host);
  // The server never stores the visit: it keeps its one frame.
  counts.items = [{ boardId: 'b', elementCount: 1, frameCount: 1, framesToShoot: 1 }];
  try {
    await act(async () =>
      root.render(
        <>
          <Navigation />
          <Open />
        </>,
      ),
    );
    const asked = get.mock.calls.length;
    await act(async () => root.render(<Navigation />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    // 3 s, 15 s and 45 s after closing; still ours.
    expect(get.mock.calls.length).toBe(asked + 3);
    expect(shown.get('b')?.frameCount).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(RELEASED_HOLD_MS));
    // 90 s, 120 s, and once more for the other views when the local counts give way.
    expect(get.mock.calls.length).toBe(asked + 6);
    expect(shown.get('b')?.frameCount).toBe(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it('counts again in every view once one of them finds the server caught up', async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement('div'));
  // What the server stored before the visit: one frame.
  counts.items = [{ boardId: 'b', elementCount: 1, frameCount: 1, framesToShoot: 1 }];
  let cards: Map<string, BoardCount> = new Map();
  function Cards() {
    cards = useBoardCounts('p', boards);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <>
          <Navigation />
          <Open />
        </>,
      ),
    );
    await act(async () => root.render(<Navigation />));
    expect(shown.get('b')?.frameCount).toBe(2);
    // Stored at once; another view (the board cards of the next board) asks first and finds
    // the server's counts matching: the local ones go, for the navigation too.
    counts.items = [{ boardId: 'b', elementCount: 2, frameCount: 2, framesToShoot: 2 }];
    await act(async () =>
      root.render(
        <>
          <Navigation />
          <Cards />
        </>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(cards.get('b')?.frameCount).toBe(2);
    // The navigation does not keep its counts from before the visit.
    expect(shown.get('b')?.frameCount).toBe(2);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
