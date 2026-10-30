// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearConnection,
  forgetBoard,
  getLastBoard,
  getRecentBoards,
  refreshClipBoards,
  rememberBoard,
  setConnection,
} from './storage.ts';

const board = { id: 'board', title: 'Board', projectId: 'project', projectName: 'Project' };
let stored: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  stored = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, items);
        },
        remove: async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete stored[key];
        },
      },
    },
  });
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  await setConnection({
    serverUrl: 'https://ink.example',
    token: 'test-token',
    tokenId: 'test',
    user: { name: 'Test', email: 'test@example.com' },
    uploadMaxBytes: 0,
  });
  await rememberBoard(board);
});
afterEach(() => vi.unstubAllGlobals());

describe('server clip history with a local cache', () => {
  it('replaces cache with server ordering and derives last from the first item', async () => {
    const remote = { ...board, id: 'remote' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [remote, board] })));
    expect(await refreshClipBoards()).toEqual([remote, board]);
    expect(await getLastBoard()).toEqual(remote);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ink.example/api/v1/me/clip-boards');
  });
  it('lets an empty server history win, without importing the old browser list', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    expect(await refreshClipBoards()).toEqual([]);
    expect(await getLastBoard()).toBeNull();
  });
  it('falls back to cached history offline or with an old server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await refreshClipBoards()).toEqual([board]);
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await refreshClipBoards()).toEqual([board]);
  });
  it('forgets locally and on the server', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await forgetBoard(board.id);
    expect(await getRecentBoards()).toEqual([]);
    expect(await getLastBoard()).toBeNull();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
  it('does not overwrite a just remembered board with an older request', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refreshing = refreshClipBoards();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const newer = { ...board, id: 'new' };
    await rememberBoard(newer);
    finish(new Response(JSON.stringify({ items: [] })));
    await refreshing;
    expect(await getLastBoard()).toEqual(newer);
  });
  it('does not restore a cache after disconnecting during a refresh', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refreshing = refreshClipBoards();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await clearConnection();
    finish(new Response(JSON.stringify({ items: [board] })));
    expect(await refreshing).toEqual([]);
    expect(await getRecentBoards()).toEqual([]);
  });

  it('clears personal cache on disconnect', async () => {
    await clearConnection();
    expect(await getRecentBoards()).toEqual([]);
  });
});
