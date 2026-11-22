// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePreferences } from '../lib/preferences.ts';
import { EmptyBoardStart } from './EmptyBoardStart.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Saving a preference answers with what was sent.
vi.mock('../lib/api.ts', () => ({
  api: { patch: vi.fn(async (_path: string, patch: unknown) => patch) },
}));

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
  await updatePreferences({ modulesOff: [] });
});

const handlers = () => ({
  onScreenplay: vi.fn(),
  onCanvas: vi.fn(),
  onModuleOn: vi.fn(),
});
const names = () =>
  [...host.querySelectorAll('button')].map(
    (b) => b.getAttribute('aria-label') ?? b.querySelector('.canvas__start-name')?.textContent,
  );

describe('EmptyBoardStart', () => {
  it('offers the screenplay and the boards of a short film', async () => {
    const on = handlers();
    await act(async () => root.render(<EmptyBoardStart {...on} />));
    expect(host.querySelector('h2')?.textContent).toBe('board.empty.title');
    expect(names()).toEqual([
      'board.empty.screenplay',
      'nav.addProduction',
      'nav.addStoryboard',
      'nav.addMoodboard',
    ]);
    for (const b of host.querySelectorAll('button')) await act(async () => b.click());
    expect(on.onScreenplay).toHaveBeenCalledOnce();
    expect(on.onCanvas.mock.calls).toEqual([['production'], ['storyboard'], ['moodboard']]);
    expect(on.onModuleOn).not.toHaveBeenCalled();
    // Mouse and touch wording are both there; the stylesheet shows the one that fits.
    expect(host.textContent).toContain('board.empty.bodyTouch');
    expect(host.textContent).toContain('board.empty.hintTouch');
  });

  it('keeps a module that is off, dimmed, and turns it on (0121)', async () => {
    await updatePreferences({ modulesOff: ['storyboard'] });
    const on = handlers();
    await act(async () => root.render(<EmptyBoardStart {...on} />));
    const off = [...host.querySelectorAll<HTMLButtonElement>('.canvas__start-option.is-off')];
    // The screenplay import belongs to Storyboard too.
    expect(off.map((b) => b.getAttribute('aria-label'))).toEqual([
      'modules.kindOff',
      'modules.kindOff',
    ]);
    expect(off[1]?.querySelector('.canvas__start-tag')?.textContent).toBe('modules.turnOn');
    for (const b of off) await act(async () => b.click());
    expect(on.onModuleOn.mock.calls).toEqual([['storyboard'], ['storyboard']]);
    expect(on.onScreenplay).not.toHaveBeenCalled();
    expect(on.onCanvas).not.toHaveBeenCalled();
  });

  it('opens the one Production board instead of making another (0123)', async () => {
    const on = { ...handlers(), onProduction: vi.fn() };
    await act(async () => root.render(<EmptyBoardStart {...on} />));
    const production = host.querySelectorAll('button')[1];
    expect(production?.querySelector('.canvas__start-name')?.textContent).toBe(
      'film.views.production',
    );
    expect(production?.querySelector('.canvas__start-desc')?.textContent).toBe(
      'board.canvasMenu.present',
    );
    await act(async () => production?.click());
    expect(on.onProduction).toHaveBeenCalledOnce();
    expect(on.onCanvas).not.toHaveBeenCalled();
  });
});
