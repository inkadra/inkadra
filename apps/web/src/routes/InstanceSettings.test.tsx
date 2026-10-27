// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { InstanceSettings } from './InstanceSettings.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ instance: null, refresh: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn() } }));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
it('shows storage loading failures as errors, never as zero usage or perpetual loading', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/instance/settings') return { name: 'Inkadra', registration: 'open' };
    throw new Error('forbidden or offline');
  });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="workspace" />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.textContent).not.toContain('admin.storageEmpty');
  expect(host.querySelector('table')).toBeNull();
});
