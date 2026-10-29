// @vitest-environment happy-dom

import { kindColor, toolColor } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CANVAS_TEMPLATES } from './canvas-templates.ts';
import { TOOLS, Toolbar } from './chrome.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

async function renderToolbar() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onAdd = vi.fn();
  const onTool = vi.fn();
  const onCanvas = vi.fn();
  await act(async () =>
    root.render(<Toolbar tool="hand" onAdd={onAdd} onTool={onTool} onCanvas={onCanvas} />),
  );
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, onAdd, onTool, onCanvas, cleanup };
}

it('groups tools with described tooltips while preserving actions and pressed modes', async () => {
  const { host, onAdd, onTool, cleanup } = await renderToolbar();
  try {
    expect(host.querySelector('.toolbar__btn--note')?.getAttribute('style')).toContain(
      '--kind-fg: var(--ink-tool-note)',
    );
    expect(host.querySelector('.toolbar__btn--frame')?.getAttribute('style')).toContain(
      '--kind-fg: var(--ink-text-secondary)',
    );
    // Board and Storyboard moved into the Canvas menu.
    expect(host.querySelector('.toolbar__btn--board')).toBeNull();
    expect(host.querySelector('.toolbar__btn--storyboard')).toBeNull();
    expect(host.querySelectorAll('fieldset')).toHaveLength(3);
    expect(host.querySelectorAll('button')).toHaveLength(11);
    expect([...host.querySelectorAll('button')].at(-1)?.className).toContain(
      'toolbar__btn--canvas',
    );
    for (const button of host.querySelectorAll('button')) {
      expect(
        host
          .querySelector(`[id="${button.getAttribute('aria-describedby')}"]`)
          ?.getAttribute('role'),
      ).toBe('tooltip');
      if (!button.hasAttribute('aria-haspopup'))
        expect(button.getAttribute('aria-keyshortcuts')).toBeTruthy();
    }
    expect(host.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe(
      'board.tools.hand',
    );
    host.querySelector<HTMLButtonElement>('.toolbar__btn--note')?.click();
    host.querySelector<HTMLButtonElement>('.toolbar__btn--arrow')?.click();
    expect(onAdd).toHaveBeenCalledWith('note');
    expect(onTool).toHaveBeenCalledWith('arrow');
  } finally {
    await cleanup();
  }
});

it('opens the Canvas menu of canvas types, walks it with the keyboard and inserts one', async () => {
  const { host, onCanvas, cleanup } = await renderToolbar();
  try {
    const button = host.querySelector<HTMLButtonElement>('.toolbar__btn--canvas')!;
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('board.canvasMenu.label');
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      'board.types.boardB',
      'onboarding.templates.moodboard.name',
      'onboarding.templates.storyboard.nameS',
      'onboarding.templates.shotlist.name',
      'onboarding.templates.production.name',
    ]);
    // Each canvas type carries its content-kind colour; Board stays neutral.
    const tiles = items.map((i) => i.querySelector('.menu__tile')?.getAttribute('style') ?? '');
    expect(tiles[0]).toContain('--kind-fg: var(--ink-text-secondary)');
    expect(tiles[1]).toContain('--ink-tag-orange');
    expect(tiles[2]).toContain('--ink-tag-purple');
    expect(tiles[3]).toContain('--ink-tag-green');
    expect(tiles[4]).toContain('--ink-tag-green');
    expect(document.activeElement).toBe(items[0]);
    const key = (k: string) =>
      act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true }),
        );
      });
    await key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    await key('End');
    expect(document.activeElement).toBe(items[4]);
    await key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    await key('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await act(async () => button.click());
    await act(async () => document.querySelectorAll<HTMLElement>('[role="menuitem"]')[2]?.click());
    expect(onCanvas).toHaveBeenCalledWith('storyboard');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it('covers every tool with a tool colour and every menu entry with a canvas colour', () => {
  for (const { type, menuOnly } of TOOLS)
    if (!menuOnly) expect(Object.hasOwn(toolColor, type)).toBe(true);
  for (const template of CANVAS_TEMPLATES) expect(Object.hasOwn(kindColor, template)).toBe(true);
});
