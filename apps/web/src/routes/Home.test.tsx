// @vitest-environment happy-dom
import type { Notification, PlannedShootingDay, Project, RecentBoard } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
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

it('shows clean empty states and no Today card without data', async () => {
  context({ projects: [{ ...project, myRole: 'viewer' }] });
  respond({});
  await render();
  const text = host.textContent ?? '';
  expect(text).not.toContain('home.today.title');
  expect(text).toContain('home.noRecentBoards');
  expect(text).toContain('home.activity.empty');
  expect(text).toContain('home.templates.needsProject');
  const templates = host.querySelectorAll<HTMLButtonElement>('.home__template');
  expect(templates).toHaveLength(4);
  expect([...templates].every((b) => b.disabled)).toBe(true);
  expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^\/me\/shooting-days\?from=(\d{4}-\d\d-\d\d)&to=\1$/),
    ]),
  );
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
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(3);
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

it('keeps the empty Home greeting and opens onboarding only from its CTA', async () => {
  const openNewProject = vi.fn();
  context({ projects: [], shared: [], openNewProject });
  respond({});
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding" element={<p>Setup destination</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('h1')?.textContent).toContain('Giulia');
  expect(host.textContent).toContain('home.noProjects');
  expect(host.textContent).not.toContain('Setup destination');
  const buttons = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '#home-projects button, [aria-labelledby="home-projects"] button',
    ),
  ];
  const quickCreate = buttons.find((button) => button.textContent === 'nav.newProject');
  expect(quickCreate).toBeDefined();
  await act(async () => quickCreate?.click());
  expect(openNewProject).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Setup destination');
  const guided = buttons.find((button) => button.textContent === 'onboarding.guidedSetup');
  expect(guided).toBeDefined();
  await act(async () => guided?.click());
  expect(host.textContent).toBe('Setup destination');
});
