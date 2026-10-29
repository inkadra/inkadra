// @vitest-environment happy-dom
import type { Instance, User } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.ts';
import { api, RequestError } from './api.ts';
import { SessionProvider, useSession } from './session.tsx';

const instance = {} as Instance;
const user = (locale: string | null) => ({ id: 'u1', locale }) as User;

function respond(me: User) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path === '/me' ? me : instance));
}

let latestRefresh: () => Promise<void> = async () => {};
let latestVersion: string | undefined;
let snapshot: ReturnType<typeof useSession>;
function Probe() {
  snapshot = useSession();
  latestVersion = useSession().version;
  latestRefresh = useSession().refresh;
  return null;
}

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SessionProvider>{null}</SessionProvider>));
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

let unmount: (() => void) | undefined;
beforeEach(async () => {
  await i18n.changeLanguage('it');
});
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

it('applies the language saved in the profile on load', async () => {
  respond(user('en-GB'));
  unmount = await mount();
  expect(i18n.language).toBe('en');
});

it('keeps the detected language when the profile has none or an unsupported one', async () => {
  respond(user(null));
  unmount = await mount();
  expect(i18n.language).toBe('it');
  unmount();
  respond(user('fr'));
  unmount = await mount();
  expect(i18n.language).toBe('it');
});

it('ignores an older refresh that finishes after a newer one', async () => {
  let resolveFirst: (me: User) => void = () => {};
  const first = new Promise<User>((resolve) => {
    resolveFirst = resolve;
  });
  let calls = 0;
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path !== '/me') return instance;
    calls += 1;
    return calls === 1 ? first : user('en');
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    ),
  );
  await act(async () => latestRefresh());
  expect(i18n.language).toBe('en');
  await act(async () => resolveFirst(user('it')));
  expect(i18n.language).toBe('en');
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
});

it('loads software identity only from an authenticated source and clears it on sign-out', async () => {
  let signedIn = true;
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/instance') return { version: 'untrusted-public-version' };
    if (path === '/me') {
      if (!signedIn) throw new RequestError(401, 'unauthorized', 'Sign in');
      return user('it');
    }
    if (path === '/instance/version') return { version: '0.4.2' };
    throw new Error(path);
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      ),
    );
    expect(latestVersion).toBe('0.4.2');
    get.mockClear();
    signedIn = false;
    await act(async () => latestRefresh());
    expect(latestVersion).toBeUndefined();
    expect(get).not.toHaveBeenCalledWith('/instance/version');
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  [
    'enrollment',
    new RequestError(403, 'forbidden', 'Enroll', { reason: 'admin_two_factor_required' }),
    true,
  ],
  ['server error', new RequestError(503, 'internal', 'Unavailable'), false],
  ['network error', new TypeError('Network unavailable'), false],
  ['expired authorization', new RequestError(401, 'unauthorized', 'Expired'), false],
  ['unrelated forbidden response', new RequestError(403, 'forbidden', 'Denied'), false],
] as const)(
  'finishes startup with a single version probe on %s',
  async (_label, error, enrollment) => {
    const me = { ...user('it'), role: 'admin', twoFactorEnabled: false };
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/instance') return instance;
      if (path === '/me') return me;
      if (path === '/instance/version') throw error;
      throw new Error(`Unexpected request ${path}`);
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <SessionProvider>
            <Probe />
          </SessionProvider>,
        ),
      );
      expect(snapshot.loading).toBe(false);
      expect(snapshot.user).toEqual(me);
      expect(snapshot.version).toBeUndefined();
      expect(snapshot.enrollmentRequired).toBe(enrollment);
      expect(get.mock.calls.map(([path]) => path)).toEqual([
        '/instance',
        '/me',
        '/instance/version',
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it('clears enrollment after the next successful version probe', async () => {
  let required = true;
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/instance') return instance;
    if (path === '/me') return { ...user('it'), role: 'admin', twoFactorEnabled: !required };
    if (path === '/instance/version') {
      if (required)
        throw new RequestError(403, 'forbidden', 'Enroll', { reason: 'admin_two_factor_required' });
      return { version: '0.4.2' };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      ),
    );
    expect(snapshot.enrollmentRequired).toBe(true);
    required = false;
    get.mockClear();
    await act(async () => latestRefresh());
    expect(snapshot.enrollmentRequired).toBe(false);
    expect(snapshot.version).toBe('0.4.2');
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/instance', '/me', '/instance/version']);
  } finally {
    await act(async () => root.unmount());
  }
});
