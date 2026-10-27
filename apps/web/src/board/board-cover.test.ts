import type { Board } from '@inkadra/shared';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { refreshBoards, setBoardCover } from './boards.ts';

vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));

const board = { id: 'b', coverAssetId: null } as Board;

it('saves the chosen cover and updates the cached board everywhere', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ items: [board] });
  await refreshBoards('p');
  vi.mocked(api.patch).mockResolvedValueOnce({ ...board, coverAssetId: 'a' });
  const saved = await setBoardCover('p', 'b', 'a');
  expect(api.patch).toHaveBeenCalledWith('/boards/b', { coverAssetId: 'a' });
  expect(saved.coverAssetId).toBe('a');
  vi.mocked(api.patch).mockResolvedValueOnce(board);
  await setBoardCover('p', 'b', null);
  expect(api.patch).toHaveBeenLastCalledWith('/boards/b', { coverAssetId: null });
});
