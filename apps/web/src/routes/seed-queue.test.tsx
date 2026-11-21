// @vitest-environment happy-dom

import type { BoardCount } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  forgetSeededCounts,
  mergeSeededCounts,
  queueSeeds,
  releaseLiveCounts,
  type SeededCounts,
  SeedQueue,
  STORED_WITHIN_MS,
  setLiveCounts,
  useSeededCounts,
} from './seed-queue.tsx';

const finish: { done?: (counts?: SeededCounts) => void; failed?: () => void } = {};
vi.mock('./ProjectSetupSeed.tsx', () => ({
  ProjectSetupSeed: (props: {
    boardId: string;
    done: (counts?: SeededCounts) => void;
    failed: () => void;
  }) => {
    finish.done = props.done;
    finish.failed = props.failed;
    return <i data-board={props.boardId} />;
  },
}));

it('seeds queued boards one at a time and moves on when one fails', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const shown = () => host.querySelector('i')?.dataset.board ?? null;
  try {
    await act(async () => root.render(<SeedQueue />));
    expect(shown()).toBeNull();
    await act(async () =>
      queueSeeds([
        { boardId: 'a', userId: 'u' },
        { boardId: 'b', userId: 'u' },
      ]),
    );
    expect(shown()).toBe('a');
    await act(async () => queueSeeds([{ boardId: 'c', userId: 'u' }]));
    expect(shown()).toBe('a');
    await act(async () => finish.done?.());
    expect(shown()).toBe('b');
    await act(async () => finish.failed?.());
    expect(shown()).toBe('c');
    await act(async () => finish.done?.());
    expect(shown()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

const server = new Map<string, BoardCount>();
let shown = new Map<string, BoardCount>();
function Counts() {
  shown = mergeSeededCounts(server, useSeededCounts());
  return null;
}

it('counts a seeded board in the navigation until the server has stored it', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  server.set('s', { boardId: 's', elementCount: 0, frameCount: 0, framesToShoot: 0 });
  try {
    await act(async () =>
      root.render(
        <>
          <SeedQueue />
          <Counts />
        </>,
      ),
    );
    await act(async () => queueSeeds([{ boardId: 's', userId: 'u' }]));
    expect(shown.get('s')?.frameCount).toBe(0);
    // A screenplay import: a scene and three frames.
    await act(async () => finish.done?.({ elementCount: 4, frameCount: 3, framesToShoot: 3 }));
    expect(shown.get('s')).toEqual({
      boardId: 's',
      elementCount: 4,
      frameCount: 3,
      framesToShoot: 3,
    });
    // Once stored, the server's counts win, also when they change afterwards.
    server.set('s', { boardId: 's', elementCount: 5, frameCount: 3, framesToShoot: 2 });
    await act(async () => forgetSeededCounts(server));
    server.set('s', { boardId: 's', elementCount: 0, frameCount: 0, framesToShoot: 0 });
    await act(async () => root.render(<Counts />));
    expect(shown.get('s')?.elementCount).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('counts the board open in a Canvas from its doc, also when the server still has old counts', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  server.set('o', { boardId: 'o', elementCount: 4, frameCount: 3, framesToShoot: 3 });
  try {
    await act(async () => root.render(<Counts />));
    // A screenplay imported into the storyboard: the server still stores three frames.
    await act(async () => setLiveCounts('o', { elementCount: 6, frameCount: 5, framesToShoot: 5 }));
    expect(shown.get('o')?.frameCount).toBe(5);
    await act(async () => forgetSeededCounts(server));
    expect(shown.get('o')?.frameCount).toBe(5);
    await act(async () => setLiveCounts('o', { elementCount: 5, frameCount: 4, framesToShoot: 4 }));
    expect(shown.get('o')?.frameCount).toBe(4);
  } finally {
    releaseLiveCounts('o');
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps the counts of a closed board until the server has stored them, not for a set time', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const stale = { boardId: 'c', elementCount: 4, frameCount: 3, framesToShoot: 3 };
  const stored = { boardId: 'c', elementCount: 6, frameCount: 5, framesToShoot: 5 };
  server.set('c', stale);
  try {
    await act(async () => root.render(<Counts />));
    await act(async () => setLiveCounts('c', { elementCount: 6, frameCount: 5, framesToShoot: 5 }));
    await act(async () => releaseLiveCounts('c'));
    // Counted again while the server still holds the counts from before the visit.
    await act(async () => forgetSeededCounts(server));
    expect(shown.get('c')?.frameCount).toBe(5);
    await act(async () => vi.advanceTimersByTime(10_500));
    await act(async () => root.render(<Counts />));
    expect(shown.get('c')?.frameCount).toBe(5);
    // The server has stored the board: its counts win from now on.
    server.set('c', stored);
    await act(async () => forgetSeededCounts(server));
    server.set('c', { ...stored, frameCount: 7 });
    await act(async () => root.render(<Counts />));
    expect(shown.get('c')?.frameCount).toBe(7);

    // A new board, empty on the server until stored, is not counted as empty meanwhile.
    server.set('n', { boardId: 'n', elementCount: 0, frameCount: 0, framesToShoot: 0 });
    await act(async () => setLiveCounts('n', { elementCount: 2, frameCount: 2, framesToShoot: 2 }));
    await act(async () => releaseLiveCounts('n'));
    await act(async () => vi.advanceTimersByTime(10_500));
    await act(async () => root.render(<Counts />));
    expect(shown.get('n')?.frameCount).toBe(2);
    // Someone else changed it meanwhile: counts fetched once the server must have stored our
    // edits are the truth, even when they differ from ours.
    server.set('n', { boardId: 'n', elementCount: 1, frameCount: 1, framesToShoot: 1 });
    await act(async () => vi.advanceTimersByTime(STORED_WITHIN_MS));
    await act(async () => forgetSeededCounts(server));
    expect(shown.get('n')?.frameCount).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
