// @vitest-environment happy-dom
import type { Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectNavItem } from './ProjectAppearance.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
vi.mock('./project-groups.ts', async (original) => ({
  ...(await original<typeof import('./project-groups.ts')>()),
  useProjectGroups: () => [{ id: 'g1', name: 'Caffè Aurora', color: 'orange' }],
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

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const open = vi.fn((event: Event) => event.preventDefault());
beforeEach(async () => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ProjectNavItem project={project} active={false} onClick={open as never} />
      </MemoryRouter>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const link = () => host.querySelector('a') as HTMLAnchorElement;
const touch = (type: string, x = 40, y = 20) =>
  link().dispatchEvent(
    new PointerEvent(type, { pointerType: 'touch', bubbles: true, clientX: x, clientY: y }),
  );
const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);

// R2-07: on a phone the project opened on release and its menu ("Move to group…") never showed.
it('opens the project menu on a long press and does not open the project', async () => {
  await act(async () => touch('pointerdown'));
  await act(async () => vi.advanceTimersByTime(300));
  expect(items()).toEqual([]);
  await act(async () => vi.advanceTimersByTime(250));
  expect(items()).toContain('groups.moveTo');
  await act(async () => touch('pointerup'));
  await act(async () => link().click());
  expect(open).not.toHaveBeenCalled();
});

it('opens the project on a short tap', async () => {
  await act(async () => touch('pointerdown'));
  await act(async () => vi.advanceTimersByTime(150));
  await act(async () => touch('pointerup'));
  await act(async () => link().click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(items()).toEqual([]);
  expect(open).toHaveBeenCalledOnce();
});

it('treats a finger that moves as a scroll, not a press', async () => {
  await act(async () => touch('pointerdown', 40, 20));
  await act(async () => touch('pointermove', 40, 52));
  await act(async () => vi.advanceTimersByTime(800));
  expect(items()).toEqual([]);
});

it('ignores a mouse button held down', async () => {
  await act(async () =>
    link().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true })),
  );
  await act(async () => vi.advanceTimersByTime(800));
  expect(items()).toEqual([]);
});
