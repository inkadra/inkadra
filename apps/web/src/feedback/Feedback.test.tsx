// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackLauncher } from './Feedback.tsx';
import { openFeedback } from './state.ts';

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  api: {
    get: vi.fn(async () => ({
      enabled: true,
      guest: false,
      destination: 'inbox',
      retentionDays: 30,
      deviceVideos: true,
    })),
    post: vi.fn(),
  },
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', name: 'Mia Rossi', image: null }, version: '1.0.0' }),
}));
// The automatic screenshot taken when the form opens.
vi.mock('html-to-image', () => ({ toBlob: async () => new Blob(['png']) }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('releases the screenshot it still holds when it goes away', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shot');
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <FeedbackLauncher />
      </MemoryRouter>,
    );
  });
  await act(async () => openFeedback());
  await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  expect(revoked).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(revoked).toHaveBeenCalledWith('blob:shot');
});
