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
    user: { id: 'member', name: 'Member', email: 'member@example.com' },
    instance: {
      name: 'Inkadra',
      publicUrl: window.location.origin,
      auth: { emailPassword: true, oidc: [] },
    },
  }),
}));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: { post: vi.fn(), get: vi.fn(async () => ({ id: 'member' })) },
  authApi: {
    verifyTotp: vi.fn(async () => ({})),
    signIn: vi.fn(async () => ({})),
    signOut: vi.fn(async () => {}),
  },
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  sessionStorage.clear();
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
  expect(authApi.signOut).not.toHaveBeenCalled();
  expect(host.textContent).toContain('auth.signIn');
  expect(assign).not.toHaveBeenCalled();
  expect(host.textContent).toContain('auth.errors.reauthRequired');
  vi.mocked(api.post).mockResolvedValueOnce({ redirectTo: 'inkadra://callback?code=ok' });
  const form = host.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () =>
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(authApi.signIn).toHaveBeenCalledWith('member@example.com', '');
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.post).mock.calls[1]).toEqual(vi.mocked(api.post).mock.calls[0]);
  expect(assign).toHaveBeenCalledWith('inkadra://callback?code=ok');
});

it('names the clipper once next to its device', async () => {
  const path =
    '/authorize?client_id=clipper&redirect_uri=https%3A%2F%2Fa.chromiumapp.org%2Fauth&code_challenge=abc&code_challenge_method=S256&device_name=Inkadra%20Clipper%20%C2%B7%20Chrome%20%C2%B7%20Linux';
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Authorize />
      </MemoryRouter>,
    ),
  );
  expect(host.textContent).toContain('authorize.clients.clipper · Chrome · Linux');
});

it('resumes a pending provider sign-in once, without authorizing a different account', async () => {
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  const key = `inkadra:reauth:${window.location.pathname}${window.location.search}`;
  const path =
    '/authorize?client_id=mobile&redirect_uri=inkadra%3A%2F%2Fcallback&code_challenge=abc&code_challenge_method=S256';
  sessionStorage.setItem(key, JSON.stringify({ userId: 'member', input: null, at: Date.now() }));
  vi.mocked(api.get).mockResolvedValueOnce({ id: 'another-member' });
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Authorize />
      </MemoryRouter>,
    ),
  );
  expect(api.post).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(host.textContent).toContain('authorize.failed');
});

it('retries the pending authorization after returning from the provider', async () => {
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  const key = `inkadra:reauth:${window.location.pathname}${window.location.search}`;
  sessionStorage.setItem(key, JSON.stringify({ userId: 'member', input: null, at: Date.now() }));
  vi.mocked(api.post).mockResolvedValueOnce({ redirectTo: 'inkadra://callback?code=ok' });
  const path =
    '/authorize?client_id=mobile&redirect_uri=inkadra%3A%2F%2Fcallback&code_challenge=abc&code_challenge_method=S256';
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Authorize />
      </MemoryRouter>,
    ),
  );
  expect(api.post).toHaveBeenCalledOnce();
  expect(assign).toHaveBeenCalledWith('inkadra://callback?code=ok');
  expect(sessionStorage.getItem(key)).toBeNull();
});

it('does not retry before the second factor is confirmed', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(
    new RequestError(403, 'forbidden', '', { reason: 'reauth_required' }),
  );
  vi.mocked(authApi.signIn).mockResolvedValueOnce({ twoFactorRedirect: true });
  const path =
    '/authorize?client_id=mobile&redirect_uri=inkadra%3A%2F%2Fcallback&code_challenge=abc&code_challenge_method=S256';
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Authorize />
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'authorize.allow')?.click(),
  );
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(host.textContent).toContain('auth.twoFactor.body');
  expect(api.post).toHaveBeenCalledOnce();
  vi.mocked(api.post).mockResolvedValueOnce({ redirectTo: 'inkadra://callback?code=ok' });
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(authApi.verifyTotp).toHaveBeenCalledOnce();
  expect(assign).toHaveBeenCalledWith('inkadra://callback?code=ok');
});
