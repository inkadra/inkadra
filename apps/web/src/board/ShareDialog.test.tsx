// @vitest-environment happy-dom
import type { BoardAccess, BoardDetail } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ShareDialog } from './ShareDialog.tsx';

// One `t` for every render, as the real one: effects that depend on it run once.
const { t } = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t }),
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

it('shows people as plain rows, with nothing to press beside the controls', () => {
  const rows = [...host.querySelectorAll<HTMLLIElement>('.share__row')];
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain('Ada Owner');
  expect(rows[1]?.textContent).toContain('share.you');
  // The old matrix highlight is gone: no pressed state, no hidden hint.
  expect(host.querySelector('[aria-pressed]')).toBeNull();
  expect(host.querySelector('.share__person')?.tagName).toBe('SPAN');
});

it('explains the roles in a closed legend that only holds text', () => {
  const legend = host.querySelector<HTMLDetailsElement>('details.share__legend');
  expect(legend?.open).toBe(false);
  expect(legend?.querySelector('summary')?.textContent).toBe('share.legend.title');
  expect([...(legend?.querySelectorAll('dt') ?? [])].map((dt) => dt.textContent)).toEqual([
    'roles.viewer',
    'roles.commenter',
    'roles.editor',
    'roles.owner',
  ]);
  expect([...(legend?.querySelectorAll('dd') ?? [])].map((dd) => dd.textContent)).toEqual([
    'share.legend.viewer',
    'share.legend.commenter',
    'share.legend.editor',
    'share.legend.owner',
  ]);
  expect(legend?.querySelector('button, input, a, [tabindex]')).toBeNull();
});

it('describes the role chosen for an invitation under the invite field', async () => {
  // happy-dom has no popover: the list opens in place.
  HTMLElement.prototype.showPopover ??= () => {};
  HTMLElement.prototype.hidePopover ??= () => {};
  vi.mocked(api.get).mockImplementation(((url: string) =>
    Promise.resolve(
      url.startsWith('/invitations') ? { items: [] } : { ...access, canManage: true },
    )) as never);
  await act(async () =>
    root.render(
      <ShareDialog open board={{ ...board, id: 'b2' }} subBoards={0} onClose={() => {}} />,
    ),
  );
  const hint = host.querySelector('.share__hint');
  expect(hint?.textContent).toBe('roles.commenter: share.roleHint.commenter');
  const role = host.querySelector<HTMLButtonElement>(
    '.share__invite [aria-label="share.inviteRole"]',
  );
  expect(role?.getAttribute('aria-describedby')).toBe(hint?.id);
  await act(async () => role?.click());
  const viewer = document.querySelector<HTMLElement>('[role="option"][data-value="viewer"]');
  await act(async () => viewer?.click());
  expect(host.querySelector('.share__hint')?.textContent).toBe(
    'roles.viewer: share.roleHint.viewer',
  );
});

it('offers no share link on the Production board (decision 0123)', async () => {
  // An editor of an ordinary board has the guests tab.
  expect(host.querySelector('[data-tour="share-tabs"]')).not.toBeNull();
  await act(async () =>
    root.render(
      <ShareDialog
        open
        board={{ ...board, kind: 'production' }}
        subBoards={0}
        onClose={() => {}}
      />,
    ),
  );
  expect(host.querySelector('[data-tour="share-tabs"]')).toBeNull();
});
