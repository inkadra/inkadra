// @vitest-environment happy-dom
import type { Board } from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadBoards } from '../board/boards.ts';
import { addBoard } from '../routes/add-storyboard.ts';
import { requestTour } from './state.ts';
import { TutorialHost } from './TutorialHost.tsx';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(async () => ({ items: [] })) } }));
vi.mock('../board/boards.ts', async (original) => ({
  ...(await original<typeof import('../board/boards.ts')>()),
  loadBoards: vi.fn(),
}));
const prefs = vi.hoisted(() => ({
  tutorialsSeen: ['welcome'],
  tutorialHints: false,
  modulesOff: [] as string[],
}));
vi.mock('../lib/preferences.ts', () => ({
  usePreferences: () => prefs,
  preferencesLoaded: () => false,
  getPreferences: () => prefs,
  updatePreferences: vi.fn(async () => {}),
}));
const projects = vi.hoisted(() => ({
  openInbox: vi.fn(),
  openNewProject: vi.fn(),
}));
vi.mock('../routes/projects-context.ts', () => ({
  useProjects: () => ({
    ...projects,
    projects: [
      { id: 'A', myRole: 'owner' },
      { id: 'B', myRole: 'owner' },
    ],
    canCreateProjects: true,
  }),
}));
vi.mock('../routes/add-storyboard.ts', () => ({ addBoard: vi.fn() }));
vi.mock('./TourPlayer.tsx', () => ({
  findAnchor: () => null,
  TourPlayer: ({ tour }: { tour: { id: string } }) => <p className="playing">{tour.id}</p>,
}));
vi.mock('./Pill.tsx', () => ({
  TourPill: () => null,
  TourToast: ({ toast }: { toast: { text: string; onOpen?: () => void } }) => (
    <button type="button" className="toast" onClick={toast.onOpen}>
      {toast.text}
    </button>
  ),
}));

const board = (id: string, kind: Board['kind'], parentBoardId: string | null) =>
  ({ id, kind, parentBoardId, position: id, views: null }) as unknown as Board;

let host: HTMLDivElement;
let root: Root;
const closeInbox = vi.fn();
const closeSettings = vi.fn();
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  prefs.modulesOff = [];
});

const render = (pathname: string) =>
  act(async () =>
    root.render(
      <TutorialHost
        admin={false}
        ready
        pathname={pathname}
        search=""
        firstProject="A"
        settingsOpen
        closeSettings={closeSettings}
        closeInbox={closeInbox}
      />,
    ),
  );
const ask = (id: string) => act(async () => requestTour(id));
const playing = () => host.querySelector('.playing')?.textContent ?? null;

it('closes the Inbox over Home for the Home tour, not for the Inbox’s own', async () => {
  await render('/');
  await ask('home');
  expect(closeInbox).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith('/');
  expect(playing()).toBe('home');
  closeInbox.mockClear();
  await ask('inbox');
  expect(closeInbox).not.toHaveBeenCalled();
  expect(projects.openInbox).toHaveBeenCalledOnce();
});

it('drops a start whose boards arrive after leaving the project', async () => {
  let arrive: (boards: Board[]) => void = () => {};
  vi.mocked(loadBoards).mockReturnValue(new Promise((resolve) => (arrive = resolve)));
  await render('/p/A');
  await ask('schedule');
  await render('/p/B');
  await act(async () =>
    arrive([board('root', 'board', null), board('prod', 'production', 'root')]),
  );
  expect(navigate).not.toHaveBeenCalled();
  expect(playing()).toBeNull();
});

it('drops a start superseded by another tour', async () => {
  let arrive: (boards: Board[]) => void = () => {};
  vi.mocked(loadBoards).mockReturnValue(new Promise((resolve) => (arrive = resolve)));
  await render('/p/A');
  await ask('schedule');
  await ask('home');
  await act(async () =>
    arrive([board('root', 'board', null), board('prod', 'production', 'root')]),
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/');
  expect(playing()).toBe('home');
});

it('starts Presentation on a moodboard, and offers only a kind whose module is on', async () => {
  vi.mocked(loadBoards).mockResolvedValue([
    board('root', 'board', null),
    board('mood', 'moodboard', 'root'),
  ]);
  await render('/p/A');
  await ask('present');
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/p/A/b/mood');
  expect(playing()).toBe('present');

  await act(async () => root.unmount());
  root = createRoot(host);
  navigate.mockClear();
  prefs.modulesOff = ['storyboard'];
  vi.mocked(loadBoards).mockResolvedValue([board('root', 'board', null)]);
  vi.mocked(addBoard).mockResolvedValue('/p/A/b/new');
  await render('/p/A');
  await ask('present');
  const toast = host.querySelector<HTMLButtonElement>('.toast');
  expect(toast?.textContent).toBe('tutorial.start.missing.moodboard');
  await act(async () => toast?.click());
  expect(addBoard).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'A' }),
    'moodboard',
    expect.any(Function),
  );
});
