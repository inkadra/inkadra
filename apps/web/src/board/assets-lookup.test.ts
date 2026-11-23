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

const asset = (id: string) => ({ id: id.toLowerCase(), status: 'ready', kind: 'image' }) as Asset;
const uuid = (i: number) => `0193f0a4-6c1e-7b9a-9c51-${i.toString(16).padStart(12, '0')}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i));
const lookupAnswers = () =>
  api.post.mockImplementation(async (_path: string, body: { ids: string[] }) => ({
    items: body.ids.map(asset),
  }));
const fail = (status: number) => new RequestError(status, 'error', 'Refused');
const flushed = () => new Promise((done) => setTimeout(done, 20));

beforeEach(() => {
  resetAssetCache();
  setAssetLoader(null);
  setAssetLookup(true);
  api.get.mockReset().mockImplementation(async (path: string) => asset(path.split('/')[2] ?? ''));
  api.post.mockReset();
});

describe('batched asset lookup', () => {
  it('asks a board of 450 files in 3 lookups of at most 200 ids instead of 450 requests', async () => {
    lookupAnswers();
    await Promise.all(ids(450).map(loadAsset));
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post.mock.calls.map(([, body]) => body.ids.length)).toEqual([200, 200, 50]);
    expect(api.post).toHaveBeenCalledWith('/assets/lookup', expect.anything());
    expect(getCachedAsset(uuid(449))).toEqual(asset(uuid(449)));
  });

  it('asks an id that is not a UUID alone, so the others still go together', async () => {
    lookupAnswers();
    await Promise.all([...ids(3), 'pasted-from-html'].map(loadAsset));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0]?.[1]).toEqual({ ids: ids(3) });
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/assets/pasted-from-html');
    expect(getCachedAsset(uuid(0))).toEqual(asset(uuid(0)));
  });

  it('answers ids written in capitals and asked twice', async () => {
    lookupAnswers();
    const upper = uuid(1).toUpperCase();
    await Promise.all([uuid(1), upper, uuid(1)].map(loadAsset));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(getCachedAsset(upper)).toEqual(asset(uuid(1)));
    expect(api.get).not.toHaveBeenCalled();
  });

  it('asks a file left out alone: missing on a 404, unknown on a 403', async () => {
    api.post.mockResolvedValue({ items: [asset(uuid(0))] });
    api.get.mockImplementation(async (path: string) => {
      throw fail(path.endsWith(uuid(1)) ? 404 : 403);
    });
    await Promise.all(ids(3).map(loadAsset));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(getCachedAsset(uuid(0))).toEqual(asset(uuid(0)));
    expect(getCachedAsset(uuid(1))).toBe('missing');
    expect(getCachedAsset(uuid(2))).toBeUndefined();
  });

  it.each([new TypeError('Failed to fetch'), fail(401), fail(429), fail(500)])(
    'leaves the cards unknown for the poller after a lookup error (%s)',
    async (err) => {
      api.post.mockRejectedValue(err);
      await Promise.all(ids(2).map(loadAsset));
      expect(getCachedAsset(uuid(0))).toBeUndefined();
      expect(api.get).not.toHaveBeenCalled();
    },
  );

  it.each([400, 413])(
    'asks the files alone when the lookup body is refused (%i)',
    async (status) => {
      api.post.mockRejectedValue(fail(status));
      await Promise.all(ids(2).map(loadAsset));
      expect(getCachedAsset(uuid(1))).toEqual(asset(uuid(1)));
      expect(api.get).toHaveBeenCalledTimes(2);
      await loadAsset(uuid(5));
      expect(api.post).toHaveBeenCalledTimes(2);
    },
  );

  it('uses the single route on servers without the capability', async () => {
    setAssetLookup(false);
    await Promise.all(ids(3).map(loadAsset));
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('falls back to the single route for good when the lookup answers 404', async () => {
    api.post.mockRejectedValue(fail(404));
    await Promise.all(ids(2).map(loadAsset));
    expect(getCachedAsset(uuid(1))).toEqual(asset(uuid(1)));
    await loadAsset(uuid(2));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('polls a file already known on the single route', async () => {
    lookupAnswers();
    await loadAsset(uuid(0));
    await loadAsset(uuid(0));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('sends no lookup for files queued before a reset', async () => {
    lookupAnswers();
    const pending = Promise.all(ids(2).map(loadAsset));
    resetAssetCache();
    await pending;
    await flushed();
    expect(api.post).not.toHaveBeenCalled();
    expect(getCachedAsset(uuid(0))).toBeUndefined();
  });

  it('asks no account route after a reset during a lookup', async () => {
    let answer!: (err: unknown) => void;
    api.post.mockReturnValue(new Promise((_, reject) => (answer = reject)));
    const pending = Promise.all(ids(2).map(loadAsset));
    await flushed();
    expect(api.post).toHaveBeenCalledTimes(1);
    resetAssetCache();
    setAssetLoader(async () => null);
    answer(fail(404));
    await pending;
    expect(api.get).not.toHaveBeenCalled();
    expect(getCachedAsset(uuid(0))).toBeUndefined();
    // The lookup still counts as available: a reset is not an older server.
    setAssetLoader(null);
    lookupAnswers();
    await loadAsset(uuid(3));
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
