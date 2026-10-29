// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { queueSeeds, SeedQueue } from './seed-queue.tsx';

const finish: { done?: () => void; failed?: () => void } = {};
vi.mock('./ProjectSetupSeed.tsx', () => ({
  ProjectSetupSeed: (props: { boardId: string; done: () => void; failed: () => void }) => {
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
