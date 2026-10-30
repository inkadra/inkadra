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
        { boardId: 'a', seed: 'storyboard', userId: 'u' },
        { boardId: 'b', seed: 'moodboard', userId: 'u' },
      ]),
    );
    expect(shown()).toBe('a');
    await act(async () => queueSeeds([{ boardId: 'c', links: [], userId: 'u' }]));
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
    await act(async () => queueSeeds([{ boardId: 's', seed: 'storyboard', userId: 'u' }]));
    expect(shown.get('s')?.frameCount).toBe(0);
    // The Canvas menu's storyboard: a scene and three frames.
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
