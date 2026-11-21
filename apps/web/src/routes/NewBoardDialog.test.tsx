// @vitest-environment happy-dom
import type { Board, Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBoard, useProjectBoards } from '../board/boards.ts';
import { updatePreferences } from '../lib/preferences.ts';
import { addBoard } from './add-storyboard.ts';
import { NewBoardDialog } from './NewBoardDialog.tsx';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({
  api: { patch: vi.fn(async (_path: string, patch: unknown) => patch) },
}));
vi.mock('../board/boards.ts', async (original) => ({
  ...(await original<typeof import('../board/boards.ts')>()),
  createBoard: vi.fn(),
  useProjectBoards: vi.fn(() => ({ items: [], error: false })),
}));
vi.mock('./add-storyboard.ts', () => ({ addBoard: vi.fn() }));

const project = { id: 'p1', name: 'Il faro', rootBoardId: 'root' } as Project;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  await updatePreferences({ modulesOff: [] });
});

const render = () =>
  act(async () =>
    root.render(<NewBoardDialog open projects={[project]} initialProject="p1" onClose={vi.fn()} />),
  );
const tile = (kind: string) =>
  document.querySelector<HTMLInputElement>(`.home-new__kind input[value="${kind}"]`);
const submit = () =>
  act(async () =>
    document.querySelector('form.home-new')?.dispatchEvent(new Event('submit', { bubbles: true })),
  );

it('asks for the kind and names the board after it, until a name is typed', async () => {
  vi.mocked(addBoard).mockResolvedValue('/p/p1/b/s');
  await render();
  expect(tile('board')?.checked).toBe(true);
  const name = () =>
    document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
  expect(name()?.value).toBe('');
  await act(async () => tile('storyboard')?.click());
  expect(name()?.value).toBe('film.views.storyboard');
  await submit();
  expect(addBoard).toHaveBeenCalledWith(
    project,
    'storyboard',
    expect.any(Function),
    'film.views.storyboard',
  );
  expect(navigate).toHaveBeenCalledWith('/p/p1/b/s');
  expect(createBoard).not.toHaveBeenCalled();
});

it('opens the one Production board instead of making another (0123)', async () => {
  vi.mocked(useProjectBoards).mockReturnValue({
    items: [{ id: 'prod', kind: 'production', parentBoardId: 'root' } as Board],
    error: false,
  });
  await render();
  await act(async () => tile('production')?.click());
  expect(document.querySelector('.home-new__present')?.textContent).toBe('home.newBoard.present');
  const go = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(go?.textContent).toBe('home.newBoard.open');
  await submit();
  expect(navigate).toHaveBeenCalledWith('/p/p1/b/prod');
  expect(addBoard).not.toHaveBeenCalled();
});

it('keeps a kind whose module is off, dimmed, with Turn on (0121)', async () => {
  await updatePreferences({ modulesOff: ['moodboard'] });
  await render();
  expect(tile('moodboard')?.disabled).toBe(true);
  const turnOn = document.querySelector<HTMLButtonElement>('.home-new__turn-on');
  expect(turnOn?.textContent).toBe('home.newBoard.turnOn');
  await act(async () => turnOn?.click());
  expect(tile('moodboard')?.disabled).toBe(false);
});
