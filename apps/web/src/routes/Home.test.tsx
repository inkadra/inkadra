// @vitest-environment happy-dom
import type { Notification, PlannedShootingDay, Project, RecentBoard } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { useProjects } from './AppLayout.tsx';
import { Home } from './Home.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { name: 'Giulia Bianchi' } }) }));
vi.mock('./AppLayout.tsx', () => ({ useProjects: vi.fn() }));

const project = {
  icon: { shape: 'circle', color: 'blue' },
  id: 'p1',
  name: 'Last run',
  rootBoardId: 'root1',
  myRole: 'owner',
  updatedAt: '2026-10-20T10:00:00Z',
} as Project;

function context(overrides: Partial<ReturnType<typeof useProjects>> = {}) {
  vi.mocked(useProjects).mockReturnValue({
    projects: [project],
    shared: [],
    openNewProject: vi.fn(),
    openImportProject: vi.fn(),
    canCreateProjects: true,
    openSearch: vi.fn(),
    openInbox: vi.fn(),
    unread: 0,
    refreshUnread: vi.fn(async () => {}),
    ...overrides,
  });
}

function respond(data: {
  days?: PlannedShootingDay[];
  boards?: RecentBoard[];
  notifications?: Notification[];
}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.endsWith('/preview'))
      return { assetIds: [], excerpts: ['Location notes'], elementCount: 2, drawing: [] };
    if (path === '/me/tasks') return { items: [] };
    if (path.startsWith('/me/shooting-days')) return { items: data.days ?? [], nextCursor: null };
    if (path.startsWith('/me/recent-boards')) return { items: data.boards ?? [], nextCursor: null };
    if (path.startsWith('/me/notifications'))
      return { items: data.notifications ?? [], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
}

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
});
const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    ),
  );

it('opens the shared New project dialog with the chosen template', async () => {
  const openNewProject = vi.fn();
  context({ openNewProject });
  respond({});
  await render();
  const moodboard = [...host.querySelectorAll<HTMLButtonElement>('.home__template')].find(
    (b) => b.querySelector('.home__name')?.textContent === 'onboarding.templates.moodboard.name',
  );
  await act(async () => moodboard?.click());
  expect(openNewProject).toHaveBeenCalledExactlyOnceWith('moodboard');
  // Home mounts no dialog of its own: the app header's one is reused.
  expect(host.querySelector('dialog')).toBeNull();
});

it('shows clean empty states and no Today card without data', async () => {
  context({ projects: [{ ...project, myRole: 'viewer' }] });
  respond({});
  await render();
  const text = host.textContent ?? '';
  expect(text).not.toContain('home.today.title');
  expect(text).toContain('home.noRecentBoards');
  expect(text).toContain('home.activity.empty');
  // The project templates of New project: they need no project to start from.
  const templates = host.querySelectorAll<HTMLButtonElement>('.home__template');
  expect([...templates].map((b) => b.querySelector('.home__name')?.textContent)).toEqual(
    ['production', 'moodboard', 'storyboard', 'shotlist', 'pitch', 'blank'].map(
      (c) => `onboarding.templates.${c}.name`,
    ),
  );
  expect([...templates].every((b) => !b.disabled)).toBe(true);
  expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^\/me\/shooting-days\?from=(\d{4}-\d\d-\d\d)&to=\1$/),
    ]),
  );
});

it('offers no templates to people who cannot create projects', async () => {
  context({ canCreateProjects: false });
  respond({});
  await render();
  expect(host.querySelector('#home-templates')).toBeNull();
  expect(host.querySelectorAll('.home__template')).toHaveLength(0);
});

it('shows today’s shooting day, recent boards and the last day of activity', async () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 26, 9, 0), toFake: ['Date'] });
  const openInbox = vi.fn();
  context({ unread: 2, openInbox });
  respond({
    days: [
      {
        id: 'd1',
        projectId: 'p1',
        boardId: 'plan',
        date: '2026-10-26',
        callTime: '18:30',
        wrap: null,
        location: 'Central station',
        notes: '',
        blocks: [],
        revision: 1,
        boardTitle: 'Shooting plan',
        projectName: 'Last run',
      },
    ],
    boards: [
      {
        id: 'storyboard1',
        projectId: 'p1',
        parentBoardId: 'root1',
        kind: 'storyboard',
        title: 'Scene 4',
        position: 'a0',
        coverAssetId: null,
        docSchemaVersion: 1,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        editedAt: new Date(2026, 9, 26, 8, 0).toISOString(),
        myRole: 'owner',
        projectName: 'Last run',
      },
    ],
    notifications: [
      {
        id: 'n1',
        type: 'comment',
        actor: { kind: 'user', user: { id: 'u', name: 'Andrea Fo', image: null } },
        projectId: 'p1',
        projectName: 'Last run',
        boardId: 'storyboard1',
        boardTitle: 'Scene 4',
        elementId: null,
        commentId: null,
        excerpt: null,
        reviewStatus: null,
        readAt: null,
        createdAt: new Date(2026, 9, 26, 7, 0).toISOString(),
      },
      {
        id: 'n0',
        type: 'mention',
        actor: null,
        projectId: 'p1',
        projectName: 'Last run',
        boardId: 'storyboard1',
        boardTitle: 'Old news',
        elementId: null,
        commentId: null,
        excerpt: null,
        reviewStatus: null,
        readAt: null,
        createdAt: new Date(2026, 9, 24, 7, 0).toISOString(),
      },
    ] as Notification[],
  });
  await render();
  const text = host.textContent ?? '';
  expect(api.get).toHaveBeenCalledWith('/me/shooting-days?from=2026-10-26&to=2026-10-26');
  expect(text).toContain('home.summary.shootingAt {"location":"Central station","time":"18:30"}');
  expect(text).toContain('home.summary.unread {"count":2}');
  const today = host.querySelector('[aria-labelledby="home-today"]');
  expect(today?.textContent).toContain('18:30');
  expect(today?.querySelector('a')?.getAttribute('href')).toBe('/p/p1/b/plan?view=schedule');
  const board = host.querySelector<HTMLAnchorElement>('.home__boards a');
  expect(board?.getAttribute('href')).toBe('/p/p1/b/storyboard1');
  // Project metadata describes the destination; it must not name a different link.
  const label = document.getElementById(board?.getAttribute('aria-labelledby') ?? '');
  const description = (board?.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
  expect(label?.textContent).toBe('Scene 4');
  expect(description).toContain('board.types.storyboard');
  expect(description).toContain('Last run');
  expect(board?.textContent).toContain('board.types.storyboard');
  expect(board?.textContent).toContain('Scene 4');
  const activity = host.querySelectorAll('.home__activity li');
  expect(activity).toHaveLength(1);
  expect(activity[0]?.textContent).toContain('Andrea Fo');
  expect(activity[0]?.textContent).toContain('notifications.unread');
  expect(text).not.toContain('Old news');
  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-labelledby="home-activity"] .home__more')?.click(),
  );
  expect(openInbox).toHaveBeenCalledOnce();
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('.home__template')].every((b) => !b.disabled),
  ).toBe(true);
});

it('says so when a section cannot load instead of showing anything made up', async () => {
  context();
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  await render();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(4);
  expect(host.querySelector('[aria-labelledby="home-today"] [role="alert"]')).not.toBeNull();
});

it('keeps the Today card with an error when only the shooting days fail', async () => {
  context();
  respond({});
  const fallback = vi.mocked(api.get).getMockImplementation();
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith('/me/shooting-days')) throw new Error('offline');
    return fallback?.(path);
  });
  await render();
  const today = host.querySelector('[aria-labelledby="home-today"]');
  expect(today?.textContent).toContain('home.today.title');
  expect(today?.querySelector('[role="alert"]')?.textContent).toBe('home.loadError');
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(host.textContent).toContain('home.noRecentBoards');
  expect(host.textContent).not.toContain('home.summary.shooting');
});

it('keeps the empty Home greeting and templates without a redundant projects section', async () => {
  context({ projects: [], shared: [] });
  respond({});
  await render();
  expect(host.querySelector('h1')?.textContent).toContain('Giulia');
  expect(host.querySelector('[aria-labelledby="home-projects"]')).toBeNull();
  expect(host.querySelectorAll('.home__template')).toHaveLength(6);
});

it('shows root boards among the four recent boards without guessing kinds from titles', async () => {
  context();
  respond({
    boards: Array.from(
      { length: 6 },
      (_, index) =>
        ({
          id: index === 0 ? project.rootBoardId : `b${index}`,
          projectId: project.id,
          parentBoardId: index === 0 ? null : project.rootBoardId,
          title: index === 0 ? 'Moodboard' : `Board ${index}`,
          kind: index === 1 ? 'storyboard' : 'board',
          projectName: project.name,
          editedAt: project.updatedAt,
        }) as RecentBoard,
    ),
  });
  await render();
  const cards = host.querySelectorAll('.home__boards > a');
  expect(cards).toHaveLength(4);
  expect(cards[0]?.getAttribute('href')).toBe('/p/p1');
  expect(cards[0]?.querySelector('.home__kind')?.textContent).toBe('board.types.board');
  expect(cards[1]?.querySelector('.home__kind')?.getAttribute('data-kind')).toBe('storyboard');
  expect(host.querySelector('.home__preview')?.getAttribute('data-tint')).toBe('blue');
  expect(host.querySelector('[aria-labelledby="home-projects"]')).toBeNull();
  expect(
    host.querySelector('[aria-labelledby="home-recent"] .home__more')?.getAttribute('href'),
  ).toBe('/projects');
});

it('shows one shooting day in the Today card and the others on request', async () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 26, 9, 0), toFake: ['Date'] });
  context();
  const day = (id: string, boardTitle: string): PlannedShootingDay => ({
    id,
    projectId: 'p1',
    boardId: `plan-${id}`,
    date: '2026-10-26',
    callTime: '18:30',
    wrap: null,
    location: 'Central station',
    notes: '',
    blocks: [],
    revision: 1,
    boardTitle,
    projectName: 'Last run',
  });
  respond({ days: [day('d1', 'Plan A'), day('d2', 'Plan B'), day('d3', 'Plan C')] });
  await render();
  const card = () => host.querySelector('.home__today') as HTMLElement;
  expect(card().textContent).toContain('Plan A');
  expect(card().textContent).not.toContain('Plan B');
  const more = card().querySelector('button.home__more') as HTMLButtonElement;
  expect(more.textContent).toBe('home.today.moreDays {"count":2}');
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await act(async () => more.click());
  expect(card().textContent).toContain('Plan B');
  expect(card().textContent).toContain('Plan C');
});

it('links to all projects only for people who have projects', async () => {
  context({ projects: [] });
  respond({});
  await render();
  expect(host.querySelector('a[href="/projects"]')).toBeNull();
  context();
  await render();
  expect(host.querySelector('a[href="/projects"]')?.textContent).toBe('home.allProjects');
});
