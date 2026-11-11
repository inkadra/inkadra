// @vitest-environment happy-dom
import type { BoardDetail, ShareLink } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { GuestLinks } from './GuestLinks.tsx';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', name: 'Mia Rossi', image: null } }),
}));

const board = { id: 'b1', projectId: 'p1', title: 'Spot', myRole: 'owner' } as BoardDetail;
const link = (id: string, extra: Partial<ShareLink>): ShareLink => ({
  id,
  projectId: 'p1',
  boardId: 'b1',
  boardTitle: 'Spot',
  includeSubBoards: false,
  role: 'guest_comment',
  label: `Link ${id}`,
  hasPassword: false,
  allowDownload: false,
  proofing: false,
  url: `https://example.com/g/${id}`,
  status: 'active',
  createdBy: { id: 'me', name: 'Mia', image: null },
  createdAt: '2026-11-10T08:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  guestCount: 0,
  viewCount: 0,
  lastUsedAt: null,
  ...extra,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.mocked(api.get).mockReset();
});

it('counts only the links that still work and refreshes while it is open', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(api.get).mockResolvedValue({
    items: [link('a', { status: 'revoked', revokedAt: '2026-11-10T09:00:00.000Z' })],
  });
  await act(async () => root.render(<GuestLinks board={board} userId="me" subBoards={0} />));
  expect(host.querySelector('.share__count')?.textContent).toBe('0');
  expect(api.get).toHaveBeenCalledTimes(1);
  // A guest opens a link meanwhile: the list is asked again while the dialog is in view.
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(api.get).toHaveBeenCalledTimes(2);
});
