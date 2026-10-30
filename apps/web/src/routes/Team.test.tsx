import { chooseSelect } from '../test/select.ts';
// @vitest-environment happy-dom
import type { InstanceMember, User } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { Team } from './Team.tsx';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('../lib/session.tsx', () => ({ useSession: vi.fn() }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  RequestError: class extends Error {},
}));
vi.mock('./AppLayout.tsx', () => ({
  useInstanceSetupState: () => ({ checks: null, error: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const people: InstanceMember[] = [
  {
    id: 'admin',
    name: 'Ada',
    email: 'ada@example.com',
    role: 'admin',
    lastActiveAt: null,
    projectsCount: 0,
    deactivatedAt: null,
  },
  {
    id: 'member',
    name: 'Bea',
    email: 'bea@example.com',
    role: 'member',
    lastActiveAt: '2026-10-27T12:00:00Z',
    projectsCount: 2,
    deactivatedAt: null,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: { id: 'admin', role: 'admin' } as User,
    instance: null,
    loading: false,
    refresh: vi.fn(async () => {}),
  });
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === '/instance/members'
      ? { items: people }
      : path === '/instance/settings'
        ? { name: 'Inkadra', registration: 'open' }
        : path === '/instance/storage'
          ? { originalBytes: 0, byType: [], byProject: [] }
          : { items: [] },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings/team']}>
        <Team />
      </MemoryRouter>,
    ),
  );
it('protects admin data and navigation for regular members', async () => {
  vi.mocked(useSession).mockReturnValue({
    user: { role: 'member' } as User,
    instance: null,
    loading: false,
    refresh: async () => {},
  });
  await render();
  expect(api.get).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('admin.forbidden');
  expect(host.querySelector('a[href="/settings?section=instance"]')).toBeNull();
});
it('renders actual members, direct project counts and pending empty state', async () => {
  await render();
  expect(host.textContent).toContain('bea@example.com');
  expect(host.textContent).toContain('admin.never');
  expect(host.textContent).toContain('admin.noInvitations');
  expect(
    host.querySelector<HTMLButtonElement>('.ink-select[aria-label="admin.roleFor"]')?.disabled,
  ).toBe(true);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
});
it('changes global roles through the instance endpoint', async () => {
  await render();
  const select = host.querySelectorAll('tbody .ink-select')[1] as HTMLButtonElement;
  await act(async () => {
    chooseSelect(select, 'admin');
  });
  expect(api.patch).toHaveBeenCalledWith('/instance/members/member', { role: 'admin' });
});
it('requires confirmation before soft deactivation', async () => {
  await render();
  const button = [...host.querySelectorAll('tbody button:not([role=combobox])')].find(
    (b) => !b.hasAttribute('disabled'),
  ) as HTMLButtonElement;
  await act(async () => button.click());
  expect(api.patch).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'admin.deactivate' && b.closest('dialog'),
  ) as HTMLButtonElement;
  expect(confirm).toBeTruthy();
  await act(async () => confirm.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/members/member', { active: false });
});
it('shows a genuine empty directory and reports loading failures', async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  await render();
  expect(host.textContent).toContain('admin.noMembers');
  expect(host.textContent).not.toContain('bea@example.com');
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('auth.errors.generic');
});
it('unwraps the existing invitation result and shows a private link without SMTP', async () => {
  vi.mocked(api.post).mockResolvedValue({
    status: 'invited',
    invitation: { emailSent: false, url: 'https://studio.example.com/join/private-link' },
  });
  await render();
  const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      email,
      'guest@example.com',
    );
    email.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.post).toHaveBeenCalledWith('/invitations', {
    kind: 'email',
    email: 'guest@example.com',
  });
  expect(host.textContent).toContain('admin.shareInvite');
  expect(
    [...host.querySelectorAll('input')].some(
      (input) => input.readOnly && input.value === 'https://studio.example.com/join/private-link',
    ),
  ).toBe(true);
});
it('lists pending instance invitations as table rows next to the members', async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === '/instance/members'
      ? { items: people }
      : path === '/invitations'
        ? {
            items: [
              {
                id: 'inv',
                kind: 'email',
                email: 'new@example.com',
                projectId: null,
                boardId: null,
                expiresAt: '2026-11-03T12:00:00Z',
              },
            ],
          }
        : path === '/instance/settings'
          ? { name: 'Inkadra', registration: 'invite' }
          : { originalBytes: 0, byType: [], byProject: [] },
  );
  await render();
  const pending = host.querySelector('.team-pending tr');
  expect(pending?.textContent).toContain('new@example.com');
  expect(pending?.textContent).toContain('settingsUi.members.pending');
  expect(host.textContent).not.toContain('admin.noInvitations');
  const invite = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'settingsUi.members.invite',
  );
  expect(invite?.closest('dialog')).toBeNull();
  // Registration and instance status live in their own sections, not beside the table.
  expect(host.querySelector('.settings-segmented')).toBeNull();
  expect(host.querySelector('aside')).toBeNull();
});

it('turns project creation off for members and sets a per-person exception', async () => {
  vi.mocked(api.patch).mockResolvedValue({});
  await render();
  const option = host.querySelector<HTMLInputElement>('#members-create-projects');
  expect(option?.checked).toBe(true);
  await act(async () => option?.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/settings', {
    membersCanCreateProjects: false,
  });
  // Administrators always can: no control on their row.
  expect(host.querySelector('.ink-select[aria-label="projectCreation.for"]')).not.toBeNull();
  const select = host.querySelector<HTMLButtonElement>('.ink-select[aria-label="projectCreation.for"]');
  expect(select?.getAttribute('aria-haspopup')).toBe('listbox');
  expect(host.querySelectorAll('.ink-select[aria-label="projectCreation.for"]')).toHaveLength(1);
  await act(async () => {
    if (!select) return;
    chooseSelect(select, 'yes');
  });
  expect(api.patch).toHaveBeenCalledWith('/instance/members/member', { canCreateProjects: true });
  await act(async () => {
    if (!select) return;
    chooseSelect(select, 'default');
  });
  expect(api.patch).toHaveBeenCalledWith('/instance/members/member', { canCreateProjects: null });
});
