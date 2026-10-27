// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { addFrame, addScene } from '@inkadra/canvas-core';
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

describe('PresentationView', () => {
  it('renders empty state when board has no frames', async () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    disposals.push(() => {
      store.destroy();
      doc.destroy();
    });

    const host = await mount(
      <PresentationView
        store={store}
        boardTitle="Spot TV"
        projectTitle="Campagna"
        onClose={vi.fn()}
      />,
    );

    expect(host.textContent).toContain('Nessuna inquadratura o scheda da presentare');
  });

  it('navigates through frames with keyboard and thumbnail clicks', async () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    disposals.push(() => {
      store.destroy();
      doc.destroy();
    });

    const scene = addScene(
      doc,
      { number: '4', title: 'Il binario', location: 'Binario 21' },
      { userId: 'u1' },
    );
    addFrame(
      doc,
      scene.id,
      null,
      { action: 'Antonio scende dal taxi', lens: '35mm', shot: 'ms' },
      { userId: 'u1' },
    );
    addFrame(
      doc,
      scene.id,
      null,
      { action: 'Primo piano tabellone', lens: '85mm', shot: 'cu' },
      { userId: 'u1' },
    );

    const onClose = vi.fn();
    const host = await mount(
      <PresentationView
        store={store}
        boardTitle="Spot TV"
        projectTitle="Campagna"
        onClose={onClose}
        peers={[
          {
            user: { id: 'p1', name: 'Laura', image: null },
            clientId: 2,
            color: 'var(--ink-tag-blue)',
            readOnly: true,
            cursor: null,
            selection: [],
            editing: null,
          },
        ]}
      />,
    );

    // Initial state: slide 1 of 2
    expect(host.textContent).toContain('SCENA 4 · IL BINARIO');
    expect(host.textContent).toContain('Antonio scende dal taxi');
    expect(host.textContent).toContain('1 / 2');
    expect(host.textContent).toContain('Laura sta guardando');

    // Next slide via ArrowRight
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(host.textContent).toContain('Primo piano tabellone');
    expect(host.textContent).toContain('2 / 2');

    // Previous slide via ArrowLeft
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(host.textContent).toContain('Antonio scende dal taxi');
    expect(host.textContent).toContain('1 / 2');

    // Clicking second thumbnail
    const thumb2 = host.querySelector('button[aria-label="Slide 2 · 4B"]');
    expect(thumb2).toBeDefined();
    await act(async () => {
      thumb2?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('Primo piano tabellone');

    // Escape exits presentation
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles speaker notes sidebar', async () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    disposals.push(() => {
      store.destroy();
      doc.destroy();
    });

    const scene = addScene(doc, { number: '1', title: 'Intro' }, { userId: 'u1' });
    addFrame(
      doc,
      scene.id,
      null,
      { action: 'Apertura', notes: 'Attenzione alle luci' },
      { userId: 'u1' },
    );

    const host = await mount(
      <PresentationView store={store} boardTitle="Spot TV" onClose={vi.fn()} />,
    );

    expect(host.querySelector('aside[aria-label="Note del relatore"]')).toBeDefined();
    expect(host.textContent).toContain('Attenzione alle luci');

    // Toggle button
    const toggleBtn = host.querySelector('button[aria-pressed="true"]');
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Notes collapsed
    expect(host.querySelector('aside[aria-label="Note del relatore"]')).toBeNull();
  });
});
