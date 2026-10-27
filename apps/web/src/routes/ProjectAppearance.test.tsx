// @vitest-environment happy-dom
import { defaultProjectIcon, type Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ProjectNavItem } from './ProjectAppearance.tsx';
import { getCachedProjects, setCachedProjects } from './projects.ts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const project = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Production',
  myRole: 'editor',
  icon: { shape: 'diamond', color: 'blue', emoji: null },
} as Project;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  setCachedProjects([project]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setCachedProjects(null);
  vi.restoreAllMocks();
});
async function render(p = project) {
  await act(async () =>
    root.render(<ProjectNavItem project={p} active onClick={(e) => e.preventDefault()} />),
  );
}
async function openDialog() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.project-navigation__options')?.click(),
  );
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
}
it('supports right-click, focuses its action and restores focus on Escape', async () => {
  await render();
  const link = host.querySelector('a')!;
  link.focus();
  const context = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 30,
    clientY: 40,
  });
  await act(async () => link.dispatchEvent(context));
  expect(context.defaultPrevented).toBe(true);
  expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(link);
  expect(link.textContent).toBe('Production');
});
it('supports Shift+F10 and an explicit touch/button entry point', async () => {
  await render();
  await act(async () =>
    host.querySelector('a')?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await openDialog();
  expect(host.querySelector('dialog')).not.toBeNull();
});
it.each(['viewer', 'commenter'] as const)('offers no edit actions to %s', async (myRole) => {
  await render({ ...project, myRole });
  expect(host.querySelector('button')).toBeNull();
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => host.querySelector('a')?.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
it('saves emoji to the server and updates shared cached project identity', async () => {
  const icon = { shape: 'diamond', color: 'blue', emoji: '🎬' };
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...project, icon });
  await render();
  await openDialog();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[maxlength="32"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '🎬');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(`/projects/${project.id}`, { icon });
  expect(getCachedProjects()?.[0]?.icon).toEqual(icon);
});
it('resets to deterministic defaults and keeps errors visible without closing', async () => {
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('forbidden'));
  await render({ ...project, icon: { shape: 'circle', color: 'neutral', emoji: '🎬' } });
  await openDialog();
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'appearance.reset')
      ?.click(),
  );
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(`/projects/${project.id}`, {
    icon: defaultProjectIcon(project.id),
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('appearance.error');
  expect(host.querySelector('dialog')).not.toBeNull();
});

it('keeps the context menu inside the active mobile navigation dialog', async () => {
  await act(async () =>
    root.render(
      <dialog open>
        <ProjectNavItem project={project} active onClick={(e) => e.preventDefault()} />
      </dialog>,
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.project-navigation__options')?.click(),
  );
  expect(host.querySelector('dialog [role="menu"]')).not.toBeNull();
});
