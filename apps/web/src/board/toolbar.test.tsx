// @vitest-environment happy-dom

import { toolColor } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { updatePreferences } from '../lib/preferences.ts';
import { TOOLS, Toolbar } from './chrome.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Saving a preference answers with what was sent, so a tool put in the bar stays there.
vi.mock('../lib/api.ts', () => ({
  api: { patch: vi.fn(async (_path: string, patch: unknown) => patch) },
}));

async function renderToolbar(onVoiceNote?: () => void) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onAdd = vi.fn();
  const onTool = vi.fn();
  const onCanvas = vi.fn();
  await act(async () =>
    root.render(
      <Toolbar
        onVoiceNote={onVoiceNote}
        tool="hand"
        onAdd={onAdd}
        onTool={onTool}
        onCanvas={onCanvas}
      />,
    ),
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
    expect(host.querySelector('.toolbar__btn--column')?.getAttribute('style')).toContain(
      '--kind-fg: var(--ink-text-secondary)',
    );
    // Decision 0121: the other tools wait in More; boards are made from the Canvas menu.
    for (const type of ['board', 'storyboard', 'frame', 'color', 'table', 'map', 'plan'])
      expect(host.querySelector(`.toolbar__btn--${type}`), type).toBeNull();
    // Navigate, create, the tools put in the bar, More, Canvas: 11 buttons instead of 16.
    expect(host.querySelectorAll('fieldset')).toHaveLength(5);
    expect(host.querySelectorAll('button')).toHaveLength(11);
    // The primary action closes the bar, in its own group after a divider, with its label.
    const canvas = [...host.querySelectorAll('button')].at(-1)!;
    expect(canvas.className).toContain('toolbar__btn--canvas');
    expect(canvas.closest('fieldset')?.className).toContain('toolbar__group--canvas');
    expect(canvas.querySelector('.toolbar__label')?.textContent).toBe('board.canvasMenu.label');
    expect(canvas.getAttribute('style')).toBeNull();
    for (const button of host.querySelectorAll('button')) {
      // One tooltip: the shared chip fed by data-ink-tooltip, never a second bubble in the DOM.
      expect(button.getAttribute('data-ink-tooltip')).toBeTruthy();
      expect(button.querySelector('[role="tooltip"]')).toBeNull();
      if (
        !button.hasAttribute('aria-haspopup') &&
        !button.classList.contains('toolbar__btn--section')
      )
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

it('opens the Canvas menu of boards to create, walks it with the keyboard and makes one', async () => {
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
    // One card per kind, with its preview; Production is not a kind yet.
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'board.types.board',
      'film.views.moodboard',
      'film.views.storyboard',
    ]);
    expect(items.every((i) => i.querySelector('.new-board__preview'))).toBe(true);
    // Each kind carries its content-kind colour; Board stays neutral.
    const cards = items.map((i) => i.querySelector('.new-board')?.getAttribute('style') ?? '');
    expect(cards[0]).toContain('--kind-fg: var(--ink-text-secondary)');
    expect(cards[1]).toContain('--kind-fg: var(--ink-tag-orange)');
    expect(cards[2]).toContain('--kind-fg: var(--ink-tag-purple)');
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
    expect(document.activeElement).toBe(items[2]);
    await key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    await key('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    for (const [i, kind] of [[0], [1, 'moodboard'], [2, 'storyboard']] as const) {
      await act(async () => button.click());
      await act(async () =>
        document.querySelectorAll<HTMLElement>('[role="menuitem"]')[i]?.click(),
      );
      if (kind) expect(onCanvas).toHaveBeenCalledWith(kind);
      else expect(onCanvas).toHaveBeenCalledWith(undefined);
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
  } finally {
    await cleanup();
  }
});

it('lists the other tools in More, each added with a click or put in the bar', async () => {
  const record = vi.fn();
  const { host, onAdd, cleanup } = await renderToolbar(record);
  try {
    const more = host.querySelector<HTMLButtonElement>('.toolbar__btn--more')!;
    expect(more.getAttribute('aria-label')).toBe('board.more.title');
    await act(async () => more.click());
    const panel = document.querySelector<HTMLElement>('.more-tools')!;
    const names = [...panel.querySelectorAll('.more-tools__add')].map((b) => b.textContent);
    expect(names).toEqual([
      'board.types.column',
      'board.types.section',
      'board.types.color',
      'board.types.table',
      'board.voiceNote.label',
      'board.types.map',
      'board.types.character',
      'board.types.location',
      'board.types.frame',
      'board.types.plan',
    ]);
    const pins = [...panel.querySelectorAll('.more-tools__pin')];
    expect(pins.map((p) => p.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      ...Array(8).fill('false'),
    ]);
    // A voice note from More starts the recorder.
    await act(async () =>
      panel.querySelectorAll<HTMLButtonElement>('.more-tools__add')[4]?.click(),
    );
    expect(record).toHaveBeenCalledOnce();
    await act(async () => more.click());
    await act(async () =>
      document.querySelectorAll<HTMLButtonElement>('.more-tools__add')[3]?.click(),
    );
    expect(onAdd).toHaveBeenCalledWith('table');
    // Put in the bar: the table shows there at once.
    await act(async () => more.click());
    await act(async () =>
      document.querySelectorAll<HTMLButtonElement>('.more-tools__pin')[3]?.click(),
    );
    expect(host.querySelector('.toolbar__btn--table')).not.toBeNull();
  } finally {
    await cleanup();
  }
});

it('leaves the tools of a module that is off out of More', async () => {
  await updatePreferences({ modulesOff: ['storyboard'] });
  const { host, cleanup } = await renderToolbar();
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('.toolbar__btn--more')?.click());
    const names = [...document.querySelectorAll('.more-tools__add')].map((b) => b.textContent);
    expect(names).not.toContain('board.types.frame');
    expect(names).toContain('board.types.plan');
    // In the Canvas menu the Storyboard kind stays, dimmed, with Turn on.
    await act(async () => host.querySelector<HTMLButtonElement>('.toolbar__btn--canvas')?.click());
    const storyboard = [...document.querySelectorAll('[role="menuitem"]')].at(-1);
    expect(storyboard?.getAttribute('aria-label')).toBe('modules.kindOff');
    expect(storyboard?.querySelector('.new-board.is-off .new-board__tag')?.textContent).toBe(
      'modules.turnOn',
    );
  } finally {
    await cleanup();
    await updatePreferences({ modulesOff: [] });
  }
});

it('covers every tool with a tool colour and every menu entry with a canvas colour', () => {
  for (const { type, menuOnly } of TOOLS)
    if (!menuOnly) expect(Object.hasOwn(toolColor, type)).toBe(true);
});
