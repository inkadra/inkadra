import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

it('turns a proxy’s HTML error page into a RequestError with its status (#821)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })),
  );
  const error = await api.get('/instance').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RequestError);
  expect((error as RequestError).status).toBe(502);
});
