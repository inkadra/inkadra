// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { addFrame, addScene, frameLabels, storyboardOf } from '@inkadra/canvas-core';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { formatElapsed, PresentationView } from './PresentationView.tsx';
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

describe('formatElapsed', () => {
  it('formats seconds into mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65)).toBe('01:05');
    expect(formatElapsed(600)).toBe('10:00');
  });
});

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
      return `${host.querySelectorAll('.present-thumb.is-active').length}:${Math.round(Number.parseFloat(bar?.style.width ?? '0'))}`;
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
    expect(host.querySelector('.present-progress__bar')?.getAttribute('style')).toContain('100%');
  });

  it('leaves fullscreen when it closes and follows fullscreenchange', async () => {
    const { store } = twoFrames();
    const exit = vi.fn(() => Promise.resolve());
    let fsEl: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    const host = await mount(view(store));
    const dialog = host.querySelector('dialog') as HTMLDialogElement;
    const toggle = () => host.querySelector(`button[aria-label="${present.fullscreen}"]`);
    expect(toggle()).not.toBeNull();
    fsEl = dialog;
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(host.querySelector(`button[aria-label="${present.exitFullscreen}"]`)).not.toBeNull();
    disposals.pop()?.();
    expect(exit).toHaveBeenCalled();
    fsEl = null;
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'exitFullscreen');
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
