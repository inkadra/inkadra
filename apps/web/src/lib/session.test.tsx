// @vitest-environment happy-dom
import type { Instance, User } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.ts';
import { api } from './api.ts';
import { SessionProvider } from './session.tsx';

const instance = {} as Instance;
const user = (locale: string | null) => ({ id: 'u1', locale }) as User;

function respond(me: User) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path === '/me' ? me : instance));
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
