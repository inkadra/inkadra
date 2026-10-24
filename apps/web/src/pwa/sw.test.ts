import { beforeAll, describe, expect, it, vi } from 'vitest';

// The worker's event handlers, run against small fakes of the service worker globals.
type Handler = (event: unknown) => void;
const handlers = new Map<string, Handler>();
const worker = {
  location: new URL('https://inkadra.example.com/'),
  skipWaiting: vi.fn(async () => {}),
  addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
};

const stores = new Map<string, Map<string, Response>>();
const cacheStorage = {
  open: async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    const key = (r: Request | string) =>
      new URL(typeof r === 'string' ? r : r.url, worker.location).pathname;
    return {
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(url, new Response(`cached ${url}`));
      },
      match: async (r: Request | string) => store.get(key(r))?.clone(),
    };
  },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
};
const network = vi.fn(async (_: Request) => new Response('from network'));

async function dispatch(type: string, data: Record<string, unknown> = {}) {
  let waited: Promise<unknown> | undefined;
  let response: Promise<Response> | undefined;
  handlers.get(type)?.({
    ...data,
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
    respondWith: (p: Promise<Response>) => {
      response = p;
    },
  });
  await waited;
  return response;
}

const get = (path: string, mode: RequestMode = 'cors') => {
  const request = new Request(`https://inkadra.example.com${path}`);
  // Node's Request does not allow mode "navigate"; the worker only reads it.
  Object.defineProperty(request, 'mode', { value: mode });
  return dispatch('fetch', { request });
};

beforeAll(async () => {
  vi.stubGlobal('self', worker);
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('__PRECACHE__', ['/offline.html', '/assets/index-abc.js']);
  vi.stubGlobal('__CACHE_VERSION__', 'v2');
  await import('./sw.ts');
});

describe('service worker', () => {
  it('precaches the build and removes the caches of older versions', async () => {
    stores.set('inkadra-v1', new Map());
    stores.set('someone-else', new Map());
    await dispatch('install');
    expect([...(stores.get('inkadra-v2')?.keys() ?? [])]).toEqual([
      '/offline.html',
      '/assets/index-abc.js',
    ]);
    // A new version waits for the page to ask.
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    await dispatch('activate');
    expect([...stores.keys()].sort()).toEqual(['inkadra-v2', 'someone-else']);
  });

  it('answers build files from the cache', async () => {
    const response = await get('/assets/index-abc.js');
    expect(await response?.text()).toBe('cached /assets/index-abc.js');
    expect(network).not.toHaveBeenCalled();
  });

  it('does not answer API requests at all', async () => {
    expect(await get('/api/v1/me')).toBeUndefined();
    expect(await get('/api/auth/callback/google?code=x', 'navigate')).toBeUndefined();
  });

  it('fetches navigations from the network, never from the cache', async () => {
    const response = await get('/p/1', 'navigate');
    expect(await response?.text()).toBe('from network');
  });

  it('shows the offline page when a navigation cannot reach the server', async () => {
    network.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const response = await get('/p/1', 'navigate');
    expect(await response?.text()).toBe('cached /offline.html');
  });

  it('activates a waiting version only when the page asks', async () => {
    handlers.get('message')?.({ data: { type: 'other' } });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    handlers.get('message')?.({ data: { type: 'skip-waiting' } });
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });
});
