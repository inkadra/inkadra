// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { Join } from './Join.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({
    user: null,
    instance: { name: 'Inkadra', auth: { emailPassword: true } },
    refresh: vi.fn(),
  }),
}));
vi.mock('./SignInOptions.tsx', () => ({
  SignInOptions: () => <form data-testid="sign-up" />,
}));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), post: vi.fn() },
  authApi: { signOut: vi.fn(async () => {}) },
}));

const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});

// R2-02: a sign-up posted before the claim cookie was set was refused as "registration closed".
it('shows the sign-up form only once the invitation is claimed', async () => {
  let finishClaim = () => {};
  vi.mocked(api.get).mockResolvedValue({
    status: 'valid',
    instanceName: 'Inkadra',
    projectName: 'Ultima corsa',
    role: 'editor',
  });
  vi.mocked(api.post).mockReturnValue(new Promise<void>((resolve) => (finishClaim = resolve)));
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/join/abc']}>
        <Routes>
          <Route path="/join/:token" element={<Join />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  expect(api.post).toHaveBeenCalledWith('/invitations/by-token/abc/claim', {});
  expect(host.querySelector('[data-testid="sign-up"]')).toBeNull();
  await act(async () => finishClaim());
  expect(host.querySelector('[data-testid="sign-up"]')).not.toBeNull();
});

it('still lets the person sign up when the claim fails', async () => {
  vi.mocked(api.get).mockResolvedValue({ status: 'valid', instanceName: 'Inkadra' });
  vi.mocked(api.post).mockRejectedValue(new Error('offline'));
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/join/abc']}>
        <Routes>
          <Route path="/join/:token" element={<Join />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('[data-testid="sign-up"]')).not.toBeNull();
});
