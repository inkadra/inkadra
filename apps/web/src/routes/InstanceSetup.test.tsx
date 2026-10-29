// @vitest-environment happy-dom
import type { Instance, User } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { InstanceChecklist, useInstanceSetup } from './InstanceSetup.tsx';

vi.mock('../lib/session.tsx', () => ({ useSession: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let socket: { onopen?: () => void; onerror?: () => void; close: () => void };
const instance: Instance = {
  name: 'Inkadra',
  setupRequired: false,
  registration: 'invite',
  media: { videoPosters: false, rawPreviews: false },
  limits: { uploadMaxBytes: 0 },
  serverTime: '2026-10-27T00:00:00Z',
  auth: { emailPassword: true, magicLink: false, email: true, google: false, oidc: [] },
  collabPath: '/collab',
  publicUrl: window.location.origin,
};
function Harness() {
  return <InstanceChecklist {...useInstanceSetup()} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        socket = this;
      }
      close() {}
    },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    ),
  );
it('never requests installation diagnostics for a regular member', async () => {
  vi.mocked(useSession).mockReturnValue({
    user: { role: 'member' } as User,
    loading: false,
    refresh: async () => {},
    instance,
  } as ReturnType<typeof useSession>);
  await render();
  expect(api.get).not.toHaveBeenCalled();
  expect(host.textContent).toBe('');
});
it('shows incomplete checks for admin and hides the checklist when all are ready', async () => {
  const checks = [
    'storage',
    'data_dir_writable',
    'public_url_https',
    'public_url_matches_request',
  ].map((id) => ({ id, status: 'ok' }));
  vi.mocked(api.get).mockResolvedValue({ checks });
  vi.mocked(useSession).mockReturnValue({
    user: { role: 'admin' } as User,
    loading: false,
    refresh: async () => {},
    instance: { ...instance, auth: { ...instance.auth, email: false } },
  });
  await render();
  await act(async () => socket.onopen?.());
  expect(host.textContent).toContain('onboarding.needsSetup');
  vi.mocked(useSession).mockReturnValue({
    user: { role: 'admin' } as User,
    loading: false,
    refresh: async () => {},
    instance,
  } as ReturnType<typeof useSession>);
  await render();
  await act(async () => socket.onopen?.());
  expect(host.textContent).toBe('');
});
