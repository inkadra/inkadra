// @vitest-environment happy-dom
import type { Project, ProjectMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { Projects } from './Projects.tsx';
import { refreshGroups } from './project-groups.ts';
import { deleteProject } from './projects.ts';
import { projectOverviews } from './projects-overview.ts';

const session = vi.hoisted(() => ({ role: 'member' }));
const creation = vi.hoisted(() => ({ allowed: true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { bytes?: string }) => values?.bytes ?? key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', role: session.role } }),
}));
vi.mock('./AppLayout.tsx', () => ({
  useProjects: () => ({
    openNewProject: vi.fn(),
    openImportProject: vi.fn(),
    canCreateProjects: creation.allowed,
  }),
}));
vi.mock('./BoardPreview.tsx', () => ({
  BoardPreview: ({ boardId }: { boardId: string }) => <span data-preview={boardId} />,
}));
vi.mock('./projects.ts', () => ({
  getCachedProjects: () => null,
  deleteProject: vi.fn(),
  refreshProjects: vi.fn(async () => []),
  subscribeProjects: () => () => {},
}));
vi.mock('./projects-overview.ts', async (original) => ({
  ...(await original<typeof import('./projects-overview.ts')>()),
  archivedProjects: vi.fn(async () => []),
  projectOverviews: vi.fn(),
}));

const project = {
  id: 'p1',
  name: 'Last Train',
  rootBoardId: 'root1',
  myRole: 'owner',
  type: 'short_film',
  icon: { shape: 'circle', color: 'blue', emoji: null },
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
} as Project;
const member = (id: string, name: string) =>
  ({
    user: { id, name, image: null },
    role: 'owner',
    addedAt: '2026-10-01T10:00:00Z',
  }) as ProjectMember;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({ items: [] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  creation.allowed = true;
});
async function render(members: ProjectMember[], p: Project = project) {
  vi.mocked(projectOverviews).mockResolvedValue([
    { project: p, boards: [], members, activity: p.updatedAt },
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>,
    ),
  );
}

it('shows the Home card with the actions in its menu', async () => {
  await render([member('me', 'Giulia')]);
  const card = host.querySelector('.project-card');
  expect(card?.querySelector('[data-preview="root1"]')).not.toBeNull();
  expect(card?.querySelector('h2')?.textContent).toBe('Last Train');
  // No inline type .ink-select and no button repeating the click on the card.
  expect(card?.querySelector('.ink-select')).toBeNull();
  expect(
    [...(card?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-haspopup')),
  ).toEqual(['menu']);
  await act(async () => card?.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
  ).toEqual([
    'appearance.title',
    'projectsPage.pin',
    'nav.addStoryboard',
    'nav.addMoodboard',
    'projectsPage.details',
    'transfer.exportMenu',
    'projectsPage.archive',
    'projectDelete.menu',
  ]);
  vi.mocked(api.put).mockResolvedValue({ ...project, pinned: true });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="menuitem"]:nth-child(2)')?.click(),
  );
  expect(api.put).toHaveBeenCalledWith('/projects/p1/pin', { pinned: true });
  expect(host.querySelector('.project-card__badge')?.textContent).toBe('projectsPage.pinned');
});

const menuItems = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

it.each(['editor', 'viewer'] as const)(
  'offers Delete project… to owners only, not %s',
  async (myRole) => {
    await render([member('me', 'Giulia')], { ...project, myRole });
    await act(async () => host.querySelector<HTMLButtonElement>('.project-card__options')?.click());
    expect(menuItems()).not.toContain('projectDelete.menu');
    expect(menuItems()).not.toContain('projectsPage.archive');
  },
);

it('deletes a project only once its name is typed, and keeps the dialog on an error', async () => {
  await render([member('me', 'Giulia')]);
  await act(async () => host.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].at(-1);
  expect(item?.className).toBe('ink-menu__item is-danger');
  await act(async () => item?.click());
  const dialog = host.querySelector('dialog');
  const input = dialog?.querySelector('input') as HTMLInputElement;
  const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent === 'projectDelete.confirm',
  );
  expect(dialog?.textContent).toContain('projectDelete.body');
  expect(confirm?.disabled).toBe(true);
  await act(async () => type(input, 'Last'));
  expect(confirm?.disabled).toBe(true);
  await act(async () => type(input, 'Last Train'));
  expect(confirm?.disabled).toBe(false);
  vi.mocked(deleteProject).mockRejectedValueOnce(new Error('offline'));
  await act(async () => dialog?.querySelector('form')?.requestSubmit());
  expect(deleteProject).toHaveBeenCalledWith('p1');
  expect(dialog?.querySelector('[role="alert"]')?.textContent).toBe('projectDelete.error');
  expect(host.querySelector('dialog')).toBe(dialog);
  expect(confirm?.disabled).toBe(false);
  vi.mocked(deleteProject).mockResolvedValueOnce();
  await act(async () => dialog?.querySelector('form')?.requestSubmit());
  expect(host.querySelector('.project-card')).toBeNull();
});

it('shows New project off, with why, to people who cannot create projects', async () => {
  creation.allowed = false;
  await render([member('me', 'Giulia')]);
  const actions = host.querySelector('.projects-page__actions');
  const button = [...(actions?.querySelectorAll('button') ?? [])];
  // New group stays on: groups are personal (decision 0056).
  expect(button.map((b) => [b.textContent, b.disabled])).toEqual([
    ['groups.new', false],
    ['nav.newProject', true],
  ]);
  expect(button[1]?.getAttribute('aria-describedby')).toBe('projects-creation-off');
  expect(actions?.textContent).toContain('projectCreation.off');
  // No import and no guided setup either.
  expect(actions?.querySelector('a')).toBeNull();
});

it('offers the People filter only when someone else is on a project', async () => {
  await render([member('me', 'Giulia')]);
  expect(host.textContent).not.toContain('projectsPage.people');
  await act(async () => root.unmount());
  root = createRoot(host);
  await render([member('me', 'Giulia'), member('andrea', 'Andrea')]);
  expect(host.textContent).toContain('projectsPage.people');
});

it('returns focus to the title link when the keyboard menu closes', async () => {
  await render([member('me', 'Giulia')]);
  const link = host.querySelector<HTMLAnchorElement>('.project-card h2 a');
  link?.focus();
  await act(async () =>
    link?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
    ),
  );
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  expect(menu).not.toBeNull();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(link);
});

it('keeps the Project type dialog open with an error when saving fails', async () => {
  await render([member('me', 'Giulia')]);
  await act(async () => host.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'projectsPage.details')
      ?.click(),
  );
  const dialog = host.querySelector('dialog');
  expect(dialog).not.toBeNull();
  // A right-click in the dialog is the browser's, not the card's project menu.
  const select = dialog?.querySelector('.ink-select');
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => select?.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  vi.mocked(api.patch).mockRejectedValue(new Error('offline'));
  await act(async () => dialog?.querySelector('form')?.requestSubmit());
  expect(api.patch).toHaveBeenCalledWith('/projects/p1', { type: 'short_film' });
  expect(host.querySelector('dialog')).not.toBeNull();
  expect(dialog?.querySelector('[role="alert"]')?.textContent).toBe('projectsPage.saveError');
});

it('offers UTC once among the time zones, which the platform does not list', async () => {
  HTMLElement.prototype.showPopover ??= () => {};
  HTMLElement.prototype.hidePopover ??= () => {};
  await render([member('me', 'Giulia')]);
  await act(async () => host.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'projectsPage.details')
      ?.click(),
  );
  const zone = host.querySelectorAll<HTMLButtonElement>('dialog [role="combobox"]')[1];
  await act(async () => zone?.click());
  const utc = [...document.querySelectorAll('[role="option"]')].filter(
    (option) => option.textContent === 'UTC',
  );
  expect(utc).toHaveLength(1);
});

it('formats admin storage in decimal units', async () => {
  session.role = 'admin';
  vi.mocked(api.get).mockResolvedValue({ originalBytes: 11_193_874_222, items: [] });
  try {
    await render([]);
    expect(host.querySelector('.projects-page__storage')?.textContent).toBe('11.19 GB');
  } finally {
    session.role = 'member';
  }
});

it('shows each group of the person with its projects, and folds it', async () => {
  const group = {
    id: 'g1',
    name: 'Caffè Aurora',
    color: 'orange',
    position: 'a0',
    collapsed: false,
  };
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === '/project-groups' ? { items: [group] } : { items: [] },
  );
  await act(async () => refreshGroups());
  const inGroup = {
    ...project,
    id: 'p2',
    name: 'Spot Aurora',
    group: { id: 'g1', position: 'a0' },
  };
  vi.mocked(projectOverviews).mockResolvedValue([
    { project, boards: [], members: [], activity: project.updatedAt },
    { project: inGroup, boards: [], members: [], activity: project.updatedAt },
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>,
    ),
  );
  const section = host.querySelector<HTMLElement>('section[aria-label="Caffè Aurora"]');
  expect(section?.querySelector('h2')?.textContent).toBe('Spot Aurora');
  expect(host.querySelector('.projects-page__items h2')?.textContent).toBe('Last Train');
  const toggle = section?.querySelector<HTMLButtonElement>('[aria-expanded]');
  vi.mocked(api.patch).mockResolvedValue({ ...group, collapsed: true });
  await act(async () => toggle?.click());
  expect(api.patch).toHaveBeenCalledWith('/project-groups/g1', { collapsed: true });
  expect(section?.querySelector('h2')).toBeNull();
  // The project menu now offers Move to group….
  await act(async () => host.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toContain(
    'groups.moveTo',
  );
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  await act(async () => refreshGroups());
});

it('shows a single shooting date once', async () => {
  await render([], { ...project, shootingStart: '2026-11-07', shootingEnd: '2026-11-07' });
  expect(host.querySelector('.project-card')?.textContent).not.toContain(' – ');
});
