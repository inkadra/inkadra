// @vitest-environment happy-dom
import { createElement, type FrameElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import { BoardStore } from '../store.ts';
import { ShotlistKanban } from './ShotlistKanban.tsx';

// Resolves keys against the real English catalog, so the test also proves the key exists
// and that `{{label}}` is interpolated, like i18next does.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      let node: unknown = mockEn;
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null || !(part in node)) return key;
        node = (node as Record<string, unknown>)[part];
      }
      let text = typeof node === 'string' ? node : key;
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});

async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  return { doc, store };
}

it('gives each kanban card an aria label translated in the current language', async () => {
  const { doc, store } = board();
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, { label: '1A' }, { userId: null });
  const host = await mount(
    <ShotlistKanban
      store={store}
      frames={[frame as FrameElement]}
      labels={new Map([[frame.id, '1A']])}
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly
      onAddFrame={vi.fn()}
    />,
  );
  expect(host.querySelector('.kanban__card-body')?.getAttribute('aria-label')).toBe('Frame 1A');
  for (const el of host.querySelectorAll('[aria-label]')) {
    expect(el.getAttribute('aria-label')).not.toContain('Inquadratura');
  }
});

it('renders 5 columns including approved and allows moving cards via menu and keyboard', async () => {
  const { doc, store } = board();
  const frame = createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { label: '1A', status: 'todo' },
    { userId: null },
  );
  const host = await mount(
    <ShotlistKanban
      store={store}
      frames={[frame as FrameElement]}
      labels={new Map([[frame.id, '1A']])}
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly={false}
      onAddFrame={vi.fn()}
    />,
  );

  const sections = host.querySelectorAll('section.kanban__col');
  expect(sections).toHaveLength(5);
  expect(sections[4]?.getAttribute('aria-label')).toBe('Approved');

  const card = host.querySelector<HTMLElement>('.kanban__card');
  expect(card).not.toBeNull();
  if (card) {
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
    );
    expect(
      (doc.getMap('elements').get(frame.id) as Y.Map<unknown> | undefined)?.get('status'),
    ).toBe('ready');
  }

  const moveSelect = host.querySelector<HTMLSelectElement>('.kanban__move-select');
  expect(moveSelect).not.toBeNull();
  if (moveSelect) {
    moveSelect.value = 'shot';
    moveSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      (doc.getMap('elements').get(frame.id) as Y.Map<unknown> | undefined)?.get('status'),
    ).toBe('shot');
  }
});
