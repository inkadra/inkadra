// @vitest-environment happy-dom
import type { Project, ProjectMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { Projects } from './Projects.tsx';
import { projectOverviews } from './projects-overview.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', role: 'member' } }),
}));
vi.mock('./AppLayout.tsx', () => ({ useProjects: () => ({ openNewProject: vi.fn() }) }));
vi.mock('./BoardPreview.tsx', () => ({
  BoardPreview: ({ boardId }: { boardId: string }) => <span data-preview={boardId} />,
}));
vi.mock('./projects.ts', () => ({
  getCachedProjects: () => null,
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
});
async function render(members: ProjectMember[]) {
  vi.mocked(projectOverviews).mockResolvedValue([
    { project, boards: [], members, activity: project.updatedAt },
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
  // No inline type select and no button repeating the click on the card.
  expect(card?.querySelector('select')).toBeNull();
  expect(
    [...(card?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-haspopup')),
  ).toEqual(['menu']);
  await act(async () => card?.querySelector<HTMLButtonElement>('.project-card__options')?.click());
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
  ).toEqual(['appearance.title', 'projectsPage.pin', 'onboarding.type', 'projectsPage.archive']);
  vi.mocked(api.put).mockResolvedValue({ ...project, pinned: true });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="menuitem"]:nth-child(2)')?.click(),
  );
  expect(api.put).toHaveBeenCalledWith('/projects/p1/pin', { pinned: true });
  expect(host.querySelector('.project-card__badge')?.textContent).toBe('projectsPage.pinned');
});

it('offers the People filter only when someone else is on a project', async () => {
  await render([member('me', 'Giulia')]);
  expect(host.textContent).not.toContain('projectsPage.people');
  await act(async () => root.unmount());
  root = createRoot(host);
  await render([member('me', 'Giulia'), member('andrea', 'Andrea')]);
  expect(host.textContent).toContain('projectsPage.people');
});
