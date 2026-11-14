// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { authApi } from './api.ts';
import { signOut } from './sign-out.ts';

afterEach(() => vi.restoreAllMocks());

it('reloads the page only once the server has signed the person out (#831)', async () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  vi.spyOn(authApi, 'signOut').mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(signOut()).rejects.toThrow('Failed to fetch');
  expect(reload).not.toHaveBeenCalled();
  vi.spyOn(authApi, 'signOut').mockResolvedValueOnce(null);
  await signOut();
  expect(reload).toHaveBeenCalledOnce();
});
