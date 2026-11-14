// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { addFrame, addScene, frameLabels, storyboardOf } from '@inkadra/canvas-core';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { PresentationView } from './PresentationView.tsx';
import { BoardStore } from './store.ts';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const d of disposals.splice(0).reverse()) d();
});

async function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

// Tests run without translations, so t() renders the key itself.
const present = {
  noSlides: 'present.noSlides',
  fullscreen: 'present.fullscreen',
  exitFullscreen: 'present.exitFullscreen',
};

function setup() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  return { doc, store };
}

function view(store: BoardStore, onClose = vi.fn(), pick?: (id: string | null) => boolean) {
  const all = storyboardOf([...store.getSnapshot().byId.values()]);
  const groups = pick ? all.filter((g) => pick(g.scene?.id ?? null)) : all;
  return (
    <PresentationView
      store={store}
      groups={groups}
      labels={frameLabels(all)}
      boardTitle="Spot TV"
      projectTitle="Campagna"
      onClose={onClose}
    />
  );
}

function twoFrames() {
  const ctx = setup();
  const scene = addScene(
    ctx.doc,
    { number: '4', title: 'Il binario', location: 'Binario 21' },
    { userId: 'u1' },
  );
  addFrame(ctx.doc, scene.id, null, { action: 'Antonio scende dal taxi' }, { userId: 'u1' });
  addFrame(ctx.doc, scene.id, null, { action: 'Primo piano tabellone' }, { userId: 'u1' });
  return ctx;
}

/** Fullscreen as Chrome does it: refused on a <dialog>, granted on other elements. */
function fakeFullscreen(enabled = true) {
  let fsEl: Element | null = null;
  const request = vi.fn(function (this: Element) {
    if (this instanceof HTMLDialogElement)
      return Promise.reject(new TypeError('Dialog elements are invalid'));
    fsEl = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    fsEl = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: request,
  });
  disposals.unshift(() => {
    for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen'])
      Reflect.deleteProperty(document, key);
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  });
  return { request, exit };
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });

describe('PresentationView', () => {
  it('renders the empty state when there are no frames', async () => {
    const { store } = setup();
    const host = await mount(view(store));
    expect(host.textContent).toContain(present.noSlides);
  });

  it('is a modal dialog with no fake viewers, notes banner or client link', async () => {
    const { store } = twoFrames();
    const host = await mount(view(store));
    const dialog = host.querySelector('dialog.present-view') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(host.querySelector('.present-header__watching')).toBeNull();
    expect(host.querySelector('.present-sidebar__spectators')).toBeNull();
    expect(host.textContent).not.toContain('Laura');
  });

  it('navigates with arrows, Space and thumbnails, and announces slide changes', async () => {
    const { store } = twoFrames();
    const host = await mount(view(store));
    const counter = () => {
      const bar = host.querySelector<HTMLElement>('.present-progress__bar');
      const scale = /scaleX\((.*)\)/.exec(bar?.style.transform ?? '')?.[1] ?? '0';
      return `${host.querySelectorAll('.present-thumb.is-active').length}:${Math.round(Number(scale) * 100)}`;
    };
    expect(host.textContent).toContain('Antonio scende dal taxi');
    expect(counter()).toBe('1:50');
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull();

    await press('ArrowRight');
    expect(host.textContent).toContain('Primo piano tabellone');
    expect(counter()).toBe('1:100');
    await press('ArrowLeft');
    expect(counter()).toBe('1:50');

    await press(' ', { code: 'Space' });
    expect(counter()).toBe('1:100');

    await press('ArrowLeft');
    await press('ArrowRight', { ctrlKey: true });
    expect(counter()).toBe('1:50');

    const thumb = host.querySelectorAll<HTMLButtonElement>('.present-thumb')[1];
    await act(async () => thumb?.click());
    expect(counter()).toBe('1:100');
  });

  it('keeps keys away from the canvas behind it', async () => {
    const { store } = twoFrames();
    await mount(view(store));
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    await press('ArrowRight');
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('closes once on Escape and restores focus to the opener', async () => {
    const { store } = twoFrames();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    disposals.push(() => opener.remove());
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(view(store, onClose)));
    await press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
    expect(document.activeElement).toBe(opener);
  });

  it('names the scene and its place above the picture', async () => {
    const { doc, store } = setup();
    const scene = addScene(
      doc,
      { number: '2', title: 'Il cortile', location: 'Milano' },
      { userId: 'u1' },
    );
    addFrame(doc, scene.id, null, { action: 'Entra' }, { userId: 'u1' });
    const host = await mount(view(store));
    expect(host.querySelector('.present-stage__heading')?.textContent).toContain('IL CORTILE');
    expect(host.querySelector('.present-stage__location')?.textContent).toBe('Milano');
  });

  it('names the setting and time of day with the translated labels', async () => {
    const { doc, store } = setup();
    const scene = addScene(
      doc,
      { number: '1', title: 'Scogliera', setting: 'ext', time: 'dawn' },
      { userId: 'u1' },
    );
    addFrame(doc, scene.id, null, { action: 'Alba' }, { userId: 'u1' });
    const host = await mount(view(store));
    const heading = host.querySelector('.present-stage__heading')?.textContent ?? '';
    // Translations are keys here: the raw "EXT" and "DAWN" must not show.
    expect(heading).toContain('FILM.SCENE.SETTINGS.EXT');
    expect(heading).toContain('FILM.SCENE.TIMES.DAWN');
  });

  it('only presents the frames it is given (scene filter / guest visibility)', async () => {
    const { doc, store } = setup();
    const a = addScene(doc, { title: 'Visibile' }, { userId: 'u1' });
    const b = addScene(doc, { title: 'Nascosta' }, { userId: 'u1' });
    addFrame(doc, a.id, null, { action: 'Frame visibile' }, { userId: 'u1' });
    addFrame(doc, b.id, null, { action: 'Frame nascosto' }, { userId: 'u1' });
    const host = await mount(view(store, vi.fn(), (id) => id === a.id));
    expect(host.textContent).toContain('Frame visibile');
    expect(host.textContent).not.toContain('Frame nascosto');
    expect(host.querySelectorAll('.present-thumb')).toHaveLength(0);
    expect(host.querySelector('.present-progress__bar')?.getAttribute('style')).toContain('scaleX(1)');
  });

  it('puts the body inside the dialog fullscreen, right in the click, and back', async () => {
    const { store } = twoFrames();
    const { request, exit } = fakeFullscreen();
    const host = await mount(view(store));
    const button = (label: string) =>
      host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
    // No await between the click and the request: the browser only grants it in the gesture.
    act(() => button(present.fullscreen)?.click());
    expect(request).toHaveBeenCalledTimes(1);
    // Chrome refuses a <dialog> ("Dialog elements are invalid") and the button did nothing.
    expect(request.mock.contexts[0]).toBe(host.querySelector('.present-body'));
    expect(document.fullscreenElement).toBe(host.querySelector('.present-body'));
    await act(async () => {});
    act(() => button(present.exitFullscreen)?.click());
    expect(exit).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(button(present.fullscreen)).not.toBeNull();
  });

  it('leaves fullscreen when it closes', async () => {
    const { store } = twoFrames();
    const { exit } = fakeFullscreen();
    const host = await mount(view(store));
    act(() =>
      (host.querySelector(`button[aria-label="${present.fullscreen}"]`) as HTMLElement).click(),
    );
    disposals.pop()?.();
    expect(exit).toHaveBeenCalled();
  });

  it('has no fullscreen button where the browser cannot go fullscreen', async () => {
    const { store } = twoFrames();
    fakeFullscreen(false);
    const host = await mount(view(store));
    expect(host.querySelector(`button[aria-label="${present.fullscreen}"]`)).toBeNull();
  });

  it('keeps the counter, notes and fullscreen on the header and no arrow hint', async () => {
    const { store } = twoFrames();
    fakeFullscreen();
    const host = await mount(view(store));
    const header = host.querySelector('.present-header');
    expect(header?.querySelector('.present-header__count')).not.toBeNull();
    expect(header?.querySelector('button[aria-pressed]')).not.toBeNull();
    expect(header?.querySelector(`button[aria-label="${present.fullscreen}"]`)).not.toBeNull();
    expect(host.textContent).not.toContain('present.keysHint');
  });

  it('marks the view idle after 3 seconds without the mouse, until it moves', async () => {
    vi.useFakeTimers();
    try {
      const { store } = twoFrames();
      const host = await mount(view(store));
      const idle = () => host.querySelector('dialog')?.classList.contains('is-idle');
      await act(async () => vi.advanceTimersByTime(2999));
      expect(idle()).toBe(false);
      await act(async () => vi.advanceTimersByTime(1));
      expect(idle()).toBe(true);
      // The arrow keys change slide with the bars still away.
      await press('ArrowRight');
      expect(idle()).toBe(true);
      await act(async () => {
        document.dispatchEvent(new Event('mousemove'));
      });
      expect(idle()).toBe(false);
      await act(async () => vi.advanceTimersByTime(3000));
      expect(idle()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never marks the empty state idle: its way out stays in view', async () => {
    vi.useFakeTimers();
    try {
      const { store } = setup();
      const host = await mount(view(store));
      await act(async () => vi.advanceTimersByTime(3000));
      expect(host.querySelector('dialog')?.classList.contains('is-idle')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('toggles the speaker notes', async () => {
    const { doc, store } = setup();
    const scene = addScene(doc, { number: '1' }, { userId: 'u1' });
    addFrame(doc, scene.id, null, { notes: 'Attenzione alle luci' }, { userId: 'u1' });
    const host = await mount(view(store));
    expect(host.querySelector('.present-sidebar')).not.toBeNull();
    expect(host.textContent).toContain('Attenzione alle luci');
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    await act(async () => toggle?.click());
    expect(host.querySelector('.present-sidebar')).toBeNull();
  });
});
