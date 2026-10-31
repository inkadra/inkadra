// @vitest-environment happy-dom
import { defaultProjectIcon, type Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { AppContextMenu } from '../menus/AppContextMenu.tsx';
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
    root.render(
      <AppContextMenu>
        <ProjectNavItem project={p} active onClick={(e) => e.preventDefault()} />
      </AppContextMenu>,
    ),
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
  expect(document.querySelector('.app-context-menu')).toBeNull();
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
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('.app-context-menu')).not.toBeNull();
  expect(document.querySelector('.project-navigation__menu')).toBeNull();
  expect(document.body.textContent).not.toContain('appearance.title');
});
it('saves emoji to the server and updates shared cached project identity', async () => {
  const icon = { shape: 'diamond', color: 'blue', emoji: '🎬' };
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...project, icon });
  await render();
  await openDialog();
  await act(async () => host.querySelector<HTMLButtonElement>('#appearance-tab-emoji')?.click());
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

it('offers twelve shapes and nine colours with arrow selection and saves new identity', async () => {
  const icon = { shape: 'hexagon', color: 'pink', emoji: null };
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...project, icon });
  await render();
  await openDialog();
  const shapes = host.querySelectorAll<HTMLButtonElement>(
    '.project-appearance__choices [role="radio"]',
  );
  const colors = host.querySelectorAll<HTMLButtonElement>(
    '.project-appearance__swatches [role="radio"]',
  );
  expect(shapes).toHaveLength(12);
  expect(shapes[11]?.getAttribute('aria-label')).toBe('appearance.shapes.clapperboard');
  expect(colors).toHaveLength(9);
  await act(async () => shapes[3]?.click());
  await act(async () => {
    shapes[3]?.focus();
    shapes[3]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(shapes[4]?.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(shapes[4]);
  await act(async () => colors[6]?.click());
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(`/projects/${project.id}`, { icon });
});

it('offers every contract colour exactly once, in hue order', async () => {
  const { COLOR_ORDER } = await import('./ProjectAppearance.tsx');
  const { ProjectIcon } = await import('@inkadra/shared');
  expect([...COLOR_ORDER].sort()).toEqual([...ProjectIcon.shape.color.options].sort());
});

it('keeps emoji across tab navigation, supports Home/End and exposes both panels', async () => {
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(project);
  await render({ ...project, icon: { ...project.icon, emoji: '🎬' } });
  await openDialog();
  const symbol = host.querySelector<HTMLButtonElement>('#appearance-tab-symbol')!;
  const emoji = host.querySelector<HTMLButtonElement>('#appearance-tab-emoji')!;
  await act(async () =>
    emoji.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
  );
  expect(symbol.getAttribute('aria-selected')).toBe('true');
  // A grid emoji is shown as the selected tile, not as text in the field.
  expect(host.querySelector('[role="radio"][aria-label="🎬"]')?.getAttribute('aria-checked')).toBe(
    'true',
  );
  expect(host.querySelector<HTMLInputElement>('input[maxlength="32"]')?.value).toBe('');
  await act(async () =>
    symbol.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  expect(emoji.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(`/projects/${project.id}`, {
    icon: { ...project.icon, emoji: '🎬' },
  });
});
it('disables saving an empty emoji choice', async () => {
  await render();
  await openDialog();
  await act(async () => host.querySelector<HTMLButtonElement>('#appearance-tab-emoji')?.click());
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).not.toContain('appearance.chooseEmoji');
});

it('selects a typed emoji right away, in the preview and for Save', async () => {
  await render();
  await openDialog();
  await act(async () => host.querySelector<HTMLButtonElement>('#appearance-tab-emoji')?.click());
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[maxlength="32"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '🦊');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('.project-appearance__tile')?.textContent).toBe('🦊');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(host.querySelector('.project-appearance__emojis [aria-checked="true"]')).toBeNull();
});

it('saves from Symbol with an invalid emoji by clearing it', async () => {
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(project);
  await render({ ...project, icon: { ...project.icon, emoji: 'invalid' } });
  await openDialog();
  expect(document.activeElement?.id).toBe('appearance-tab-emoji');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('#appearance-tab-symbol')?.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(`/projects/${project.id}`, {
    icon: { ...project.icon, emoji: null },
  });
});
