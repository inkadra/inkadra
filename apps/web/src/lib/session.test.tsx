// @vitest-environment happy-dom
import type { Instance, User } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.ts';
import { api } from './api.ts';
import { SessionProvider, useSession } from './session.tsx';

const instance = {} as Instance;
const user = (locale: string | null) => ({ id: 'u1', locale }) as User;

function respond(me: User) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path === '/me' ? me : instance));
}

let latestRefresh: () => Promise<void> = async () => {};
function Probe() {
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
