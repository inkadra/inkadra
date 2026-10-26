// @vitest-environment happy-dom
import type { BoardAccess, BoardDetail } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ShareDialog } from './ShareDialog.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', name: 'Mia Rossi', image: null } }),
}));

const board = {
  id: 'b1',
  projectId: 'p1',
  parentBoardId: null,
  kind: 'board',
  title: 'Shooting plan',
  position: 'a0',
  coverAssetId: null,
  docSchemaVersion: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  myRole: 'editor',
  breadcrumb: [],
} as BoardDetail;

const access = {
  canManage: false,
  items: [
    {
      user: { id: 'u-owner', name: 'Ada Owner', image: null },
      role: 'owner',
      source: { kind: 'project' },
      projectRole: 'owner',
    },
    {
      user: { id: 'me', name: 'Mia Rossi', image: null },
      role: 'editor',
      source: { kind: 'project' },
      projectRole: 'editor',
    },
  ],
} as BoardAccess;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.mocked(api.get).mockResolvedValue(access);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<ShareDialog open board={board} subBoards={0} onClose={() => {}} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('names each person row by its visible text and describes the action with a hint', () => {
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.share__person')];
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    // No aria-label: the accessible name is the visible text (name, "(you)" and source).
    expect(row.hasAttribute('aria-label')).toBe(false);
    const hint = document.getElementById(row.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('share.highlightHint');
  }
  expect(rows[0]?.textContent).toContain('Ada Owner');
  expect(rows[1]?.textContent).toContain('Mia Rossi');
  expect(rows[1]?.textContent).toContain('share.you');
});

it('highlights the owner role from the owner row, which cannot be edited', async () => {
  // The matrix starts on the role of the current user.
  await act(async () => host.querySelector<HTMLButtonElement>('.share__matrix-toggle')?.click());
  expect(host.querySelector('.is-active th')?.textContent).toBe('roles.editor');

  const ownerRow = [...host.querySelectorAll<HTMLButtonElement>('.share__person')].find((b) =>
    b.textContent?.includes('Ada Owner'),
  );
  expect(ownerRow?.textContent).toContain('Ada Owner');
  expect(ownerRow?.getAttribute('aria-pressed')).toBe('false');
  await act(async () => ownerRow?.click());
  expect(ownerRow?.getAttribute('aria-pressed')).toBe('true');
  const active = host.querySelector('.is-active');
  expect(active?.getAttribute('aria-current')).toBe('true');
  expect(host.querySelector('.is-active th')?.textContent).toBe('roles.owner');
});
