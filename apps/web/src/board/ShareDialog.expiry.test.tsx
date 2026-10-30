// @vitest-environment happy-dom
import type { BoardAccess, BoardDetail } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ShareDialog } from './ShareDialog.tsx';

// A stable function, as the real one: the dialog reloads when it changes.
const { t } = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', name: 'Mia Rossi', image: null }, instance: null }),
}));

const DAY = 86_400_000;
const board = {
  id: 'b2',
  projectId: 'p1',
  parentBoardId: 'b1',
  kind: 'board',
  title: 'Costumes',
  position: 'a0',
  coverAssetId: null,
  docSchemaVersion: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  myRole: 'owner',
  breadcrumb: [],
} as BoardDetail;

const soon = new Date(Date.now() + 2 * DAY).toISOString();
const later = new Date(Date.now() + 40 * DAY).toISOString();
const access = {
  canManage: true,
  items: [
    {
      user: { id: 'me', name: 'Mia Rossi', image: null, email: 'mia@example.com' },
      role: 'owner',
      source: { kind: 'project' },
      projectRole: 'owner',
      expiresAt: null,
    },
    {
      user: { id: 'u-anna', name: 'Anna Verdi', image: null, email: 'anna@example.com' },
      role: 'editor',
      source: { kind: 'board', boardId: 'b2', boardTitle: 'Costumes' },
      projectRole: null,
      expiresAt: soon,
    },
    {
      user: { id: 'u-luca', name: 'Luca Neri', image: null, email: 'luca@example.com' },
      role: 'viewer',
      source: { kind: 'board', boardId: 'b2', boardTitle: 'Costumes' },
      projectRole: null,
      expiresAt: later,
    },
    {
      user: { id: 'u-owner', name: 'Ada Owner', image: null, email: 'ada@example.com' },
      role: 'owner',
      source: { kind: 'board', boardId: 'b2', boardTitle: 'Costumes' },
      projectRole: null,
    },
  ],
} as BoardAccess;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path.startsWith('/invitations') ? { items: [] } : access,
  );
  vi.mocked(api.put).mockResolvedValue({});
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
  vi.clearAllMocks();
});

const rowOf = (name: string) =>
  [...host.querySelectorAll<HTMLLIElement>('.share__row')].find((r) =>
    r.textContent?.includes(name),
  );

it('shows the end date muted, in the warning colour only within three days', () => {
  const anna = rowOf('Anna Verdi')?.querySelector('.share__expiry');
  const luca = rowOf('Luca Neri')?.querySelector('.share__expiry');
  expect(anna?.textContent).toContain('share.expiry.label');
  expect(anna?.classList.contains('share__expiry--soon')).toBe(true);
  expect(luca?.classList.contains('share__expiry--soon')).toBe(false);
  expect(rowOf('Ada Owner')?.querySelector('.share__expiry')).toBeNull();
});

it('offers no end date for owners', () => {
  expect(rowOf('Ada Owner')?.querySelector('.share__expiry-btn')).toBeNull();
  expect(rowOf('Luca Neri')?.querySelector('.share__expiry-btn')).not.toBeNull();
});

it('sets and removes an end date with the role unchanged', async () => {
  const row = rowOf('Luca Neri');
  await act(async () => row?.querySelector<HTMLButtonElement>('.share__expiry-btn')?.click());
  const input = row?.querySelector<HTMLInputElement>('input[type="date"]');
  expect(input?.value).not.toBe('');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, '2027-01-15');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent === 'share.expiry.save',
  );
  await act(async () => save?.click());
  const [path, body] = vi.mocked(api.put).mock.calls[0] ?? [];
  expect(path).toBe('/boards/b2/grants/u-luca');
  expect(body).toMatchObject({ role: 'viewer' });
  const at = new Date((body as { expiresAt: string }).expiresAt);
  expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([2027, 0, 15, 23]);

  await act(async () =>
    rowOf('Luca Neri')?.querySelector<HTMLButtonElement>('.share__expiry-btn')?.click(),
  );
  const clear = [...(rowOf('Luca Neri')?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent === 'share.expiry.clear',
  );
  await act(async () => clear?.click());
  expect(vi.mocked(api.put).mock.calls[1]).toEqual([
    '/boards/b2/grants/u-luca',
    { role: 'viewer', expiresAt: null },
  ]);
});
