import type { Board } from '@inkadra/shared';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { loadBoards, refreshBoards } from './boards.ts';

vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn() } }));

it('waits for the list already on its way instead of reading an empty cache', async () => {
  let arrive: (page: { items: Board[] }) => void = () => {};
  vi.mocked(api.get).mockReturnValueOnce(new Promise((done) => (arrive = done)));
  // The sidebar asked first; a tour started from Settings asks while that is in flight.
  void refreshBoards('p');
  const loaded = loadBoards('p');
  arrive({ items: [{ id: 'story', kind: 'storyboard' } as Board] });
  expect((await loaded)?.map((b) => b.id)).toEqual(['story']);
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('gives no list when the request failed', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
  expect(await loadBoards('q')).toBeNull();
});
