// @vitest-environment happy-dom
import type { Asset } from '@inkadra/shared';
import { act, type ReactNode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from '../lib/api.ts';
import { primeAsset, resetAssetCache, setAssetLoader, useAsset } from './assets.ts';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api,
}));

const asset: Asset = {
  id: 'upload',
  projectId: 'project',
  kind: 'video',
  filename: 'take.mov',
  mime: 'video/quicktime',
  size: 2600000000,
  sha256: null,
  width: null,
  height: null,
  durationMs: null,
  videoCodec: null,
  audioCodec: null,
  frameRate: null,
  pageCount: null,
  proxy: null,
  animated: false,
  status: 'pending',
  url: '/api/v1/assets/upload/file',
  variants: [],
  exif: null,
  palette: [],
  sourceUrl: null,
  createdAt: '2026-10-26T00:00:00Z',
};

function Card({ id = asset.id }: { id?: string }) {
  const value = useAsset(id);
  return <span>{value === 'missing' ? value : (value?.status ?? 'loading')}</span>;
}

function GuestPage() {
  useEffect(() => {
    setAssetLoader(async () => null);
    return () => {
      setAssetLoader(null);
      resetAssetCache();
    };
  }, []);
  return <Card />;
}
function controlled<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let online: boolean;
let visibility: DocumentVisibilityState;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const render = (children: ReactNode = <Card />) => act(async () => root.render(children));
const event = (target: Window | Document, type: string) =>
  act(async () => {
    target.dispatchEvent(new Event(type));
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  online = true;
  visibility = 'visible';
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  resetAssetCache();
  setAssetLoader(null);
  api.get.mockReset().mockResolvedValue(asset);
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetAssetCache();
  setAssetLoader(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mounted asset polling', () => {
  it('recovers after a network error without ever rendering missing', async () => {
    api.get
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ ...asset, status: 'ready' });
    await render();
    expect(container.textContent).toBe('loading');
    await advance(4000);
    expect(container.textContent).toBe('ready');
    await advance(60_000);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429, 500, 503])(
    'backs off HTTP %i without caching missing',
    async (status) => {
      primeAsset(asset);
      api.get.mockRejectedValue(new RequestError(status, 'error', 'Failed'));
      await render();
      await advance(3600_000);
      expect(container.textContent).toBe('pending');
      expect(api.get.mock.calls.length).toBeLessThan(70);
    },
  );

  it('stops polling a verified 404, including after online and visibility events', async () => {
    api.get.mockRejectedValue(new RequestError(404, 'not_found', 'Not found'));
    await render();
    expect(container.textContent).toBe('missing');
    await advance(3600_000);
    await event(window, 'online');
    await event(document, 'visibilitychange');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'hidden'])(
    'pauses many mounted cards while %s and resumes on return',
    async (state) => {
      if (state === 'offline') online = false;
      else visibility = 'hidden';
      await render(
        Array.from({ length: 50 }, (_, i) => `asset-${i}`).map((id) => <Card key={id} id={id} />),
      );
      await advance(3600_000);
      expect(api.get.mock.calls.length).toBe(0);
      online = true;
      visibility = 'visible';
      await event(
        state === 'offline' ? window : document,
        state === 'offline' ? 'online' : 'visibilitychange',
      );
      expect(api.get).toHaveBeenCalledTimes(50);
    },
  );

  it('shares one polling cadence across cards mounted at different times', async () => {
    await render(<Card key="one" />);
    await advance(1000);
    await render(
      <>
        <Card key="one" />
        <Card key="two" />
      </>,
    );
    await advance(9000);
    expect(api.get).toHaveBeenCalledTimes(6);
  });

  it('pauses an existing poll and online immediately retries unknown and pending assets only', async () => {
    primeAsset({ ...asset, id: 'orphan' });
    primeAsset({ ...asset, id: 'ready', status: 'ready' });
    api.get.mockRejectedValueOnce(new TypeError('offline'));
    await render(
      <>
        <Card />
        <Card id="ready" />
      </>,
    );
    online = false;
    await event(window, 'offline');
    await advance(12_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    online = true;
    api.get.mockResolvedValue({ ...asset, status: 'processing' });
    await event(window, 'online');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('processingready');
    api.get.mockResolvedValue({ ...asset, status: 'ready' });
    await advance(2000);
    expect(container.textContent).toBe('readyready');
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('removes browser listeners and never refetches unmounted pending cards', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    await render();
    await render(null);
    await event(window, 'online');
    await event(document, 'visibilitychange');
    await advance(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('does not start account requests during guest page cleanup', async () => {
    primeAsset({ ...asset, status: 'ready' });
    await render(<GuestPage />);
    await render(null);
    await advance(0);
    expect(api.get.mock.calls.length).toBe(0);
  });

  it('isolates cache generations and in-flight bookkeeping when switching to a guest loader', async () => {
    const old = controlled<Asset>();
    const current = controlled<Asset | null>();
    api.get.mockReturnValue(old.promise);
    await render();
    const guest = vi.fn(() => current.promise);
    await act(async () => {
      setAssetLoader(guest);
      resetAssetCache();
    });
    expect(guest).toHaveBeenCalledTimes(1);
    await act(async () => old.resolve({ ...asset, status: 'ready' }));
    expect(container.textContent).toBe('loading');
    await event(window, 'online');
    expect(guest).toHaveBeenCalledTimes(1);
    await act(async () => current.resolve(null));
    expect(container.textContent).toBe('missing');
    await advance(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(guest).toHaveBeenCalledTimes(1);
  });
});
