// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authApi, RequestError } from '../lib/api.ts';
import { Authorize } from './Authorize.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({
    user: { name: 'Member', email: 'member@example.com' },
    instance: { name: 'Inkadra' },
  }),
}));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: { post: vi.fn() },
  authApi: { signOut: vi.fn(async () => {}) },
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('reauthenticates an old session and preserves the complete app authorization request', async () => {
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  vi.mocked(api.post).mockRejectedValue(
    new RequestError(403, 'forbidden', 'Sign in again.', { reason: 'reauth_required' }),
  );
  const path =
    '/authorize?client_id=mobile&redirect_uri=inkadra%3A%2F%2Fcallback&code_challenge=abc&code_challenge_method=S256&state=state';
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Authorize />
      </MemoryRouter>,
    ),
  );
  const allow = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'authorize.allow',
  );
  expect(allow).toBeDefined();
  await act(async () => allow?.click());
  expect(authApi.signOut).toHaveBeenCalledOnce();
  expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(path)}`);
  expect(host.textContent).toContain('auth.errors.reauthRequired');
});
