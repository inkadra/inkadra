// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { isChunkError, lazyRoute } from './chunks.ts';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('recognises a module missing after a deploy in each browser', () => {
  expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: /a.js'))).toBe(
    true,
  );
  expect(isChunkError(new TypeError('error loading dynamically imported module: /a.js'))).toBe(
    true,
  );
  expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isChunkError(new Error('boom'))).toBe(false);
});

it('reloads once for a missing route module, then lets the error page explain', async () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const missing = () => Promise.reject(new TypeError('Importing a module script failed.'));
  void lazyRoute(missing);
  await Promise.resolve();
  await Promise.resolve();
  expect(reload).toHaveBeenCalledOnce();
  await expect(lazyRoute(missing)).rejects.toThrow('Importing a module script failed.');
  expect(reload).toHaveBeenCalledOnce();
  await expect(lazyRoute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
});
