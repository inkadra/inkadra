import type { Asset } from '@inkadra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from '../lib/api.ts';
import {
  getCachedAsset,
  loadAsset,
  resetAssetCache,
  setAssetLoader,
  setAssetLookup,
} from './assets.ts';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api,
}));

const asset = (id: string) => ({ id, status: 'ready', kind: 'image' }) as Asset;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);
const lookupAnswers = () =>
  api.post.mockImplementation(async (_path: string, body: { ids: string[] }) => ({
    items: body.ids.map(asset),
  }));

beforeEach(() => {
  resetAssetCache();
  setAssetLoader(null);
  setAssetLookup(true);
  api.get.mockReset().mockImplementation(async (path: string) => asset(path.split('/')[2]!));
  api.post.mockReset();
});

describe('batched asset lookup', () => {
  it('asks a board of 450 files in 3 lookups of at most 200 ids instead of 450 requests', async () => {
    lookupAnswers();
    await Promise.all(ids(450).map(loadAsset));
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post.mock.calls.map(([, body]) => body.ids.length)).toEqual([200, 200, 50]);
    expect(api.post).toHaveBeenCalledWith('/assets/lookup', expect.anything());
    expect(getCachedAsset('a449')).toEqual(asset('a449'));
  });

  it('asks a file left out alone, so it ends missing on the single route’s 404', async () => {
    api.post.mockResolvedValue({ items: [asset('a0')] });
    api.get.mockRejectedValue(new RequestError(404, 'not_found', 'Asset not found'));
    await Promise.all(['a0', 'gone'].map(loadAsset));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/assets/gone');
    expect(getCachedAsset('a0')).toEqual(asset('a0'));
    expect(getCachedAsset('gone')).toBe('missing');
  });

  it('keeps the cards unknown after a failed lookup, for the poller to retry', async () => {
    api.post.mockRejectedValue(new TypeError('Failed to fetch'));
    await Promise.all(ids(2).map(loadAsset));
    expect(getCachedAsset('a0')).toBeUndefined();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('uses the single route on servers without the capability', async () => {
    setAssetLookup(false);
    await Promise.all(ids(3).map(loadAsset));
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('falls back to the single route for good when the lookup answers 404', async () => {
    api.post.mockRejectedValue(new RequestError(404, 'not_found', 'Not found'));
    await Promise.all(ids(2).map(loadAsset));
    expect(getCachedAsset('a1')).toEqual(asset('a1'));
    await loadAsset('a2');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('asks files over the lookup limit alone', async () => {
    api.post.mockRejectedValue(new RequestError(429, 'rate_limited', 'Too many'));
    await Promise.all(ids(2).map(loadAsset));
    expect(getCachedAsset('a0')).toEqual(asset('a0'));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('polls a file already known on the single route', async () => {
    lookupAnswers();
    await loadAsset('a0');
    await loadAsset('a0');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
