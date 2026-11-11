// @vitest-environment happy-dom
import { createElement, type FrameElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import { chooseSelect } from '../../test/select.ts';
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

const mockReviews = new Map<string, { status: string; history: unknown[] }>();

vi.mock('../review-store.ts', () => ({
  useReviews: (selector: (s: unknown) => unknown) =>
    selector({
      preview: false,
      counts: new Map(),
      reviews: mockReviews,
      pins: new Map(),
      pinTarget: null,
    }),
  openComments: vi.fn(),
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
  const frame = createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { label: '1A', cast: ['Giulia Rossi'] },
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
      readOnly
      onAddFrame={vi.fn()}
    />,
  );
  expect(host.querySelector('.kanban__card-body')?.getAttribute('aria-label')).toBe('Frame 1A');
  const avatar = host.querySelector('.kanban__cast .ink-avatar');
  expect(avatar?.textContent).toBe('GR');
  expect(avatar?.getAttribute('data-ink-tooltip')).toBe('Giulia Rossi');
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

  const moveSelect = host.querySelector<HTMLButtonElement>('.kanban__move-select');
  expect(moveSelect).not.toBeNull();
  if (moveSelect) {
    chooseSelect(moveSelect, 'shot');
    expect(
      (doc.getMap('elements').get(frame.id) as Y.Map<unknown> | undefined)?.get('status'),
    ).toBe('shot');
  }
});

it('sets approved: true when moving into approved column, and clears it when moving out', async () => {
  const { doc, store } = board();
  const frame = createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { label: '2A', status: 'ready' },
    { userId: null },
  );
  const host = await mount(
    <ShotlistKanban
      store={store}
      frames={[frame as FrameElement]}
      labels={new Map([[frame.id, '2A']])}
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly={false}
      onAddFrame={vi.fn()}
    />,
  );

  // Move in: move to approved
  const moveSelect = host.querySelector<HTMLButtonElement>('.kanban__move-select');
  expect(moveSelect).not.toBeNull();
  if (moveSelect) {
    chooseSelect(moveSelect, 'approved');
    expect(
      (doc.getMap('elements').get(frame.id) as Y.Map<unknown> | undefined)?.get('approved'),
    ).toBe(true);
  }

  // Simulate updated frame with approved: true
  const approvedFrame = { ...(frame as FrameElement), approved: true };
  const hostApproved = await mount(
    <ShotlistKanban
      store={store}
      frames={[approvedFrame]}
      labels={new Map([[frame.id, '2A']])}
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly={false}
      onAddFrame={vi.fn()}
    />,
  );

  // Move out: move to todo
  const moveOutSelect = hostApproved.querySelector<HTMLButtonElement>('.kanban__move-select');
  expect(moveOutSelect).not.toBeNull();
  if (moveOutSelect) {
    chooseSelect(moveOutSelect, 'todo');
    const map = doc.getMap('elements').get(frame.id) as Y.Map<unknown> | undefined;
    expect(map?.get('status')).toBe('todo');
    expect(map?.get('approved')).toBe(false);
  }
});

it('fills Approved from client approvals and production approvals, counts included', async () => {
  const { doc, store } = board();
  const make = (label: string, extra: Partial<FrameElement>) =>
    createElement(
      doc,
      'frame',
      { x: 0, y: 0 },
      { label, ...extra },
      { userId: null },
    ) as FrameElement;
  const client = make('1A', { status: 'shot' });
  const production = make('1B', { status: 'shot', approved: true });
  const both = make('1C', { status: 'ready', approved: true });
  const neither = make('1D', { status: 'shot' });
  mockReviews.set(client.id, { status: 'approved', history: [] });
  mockReviews.set(both.id, { status: 'approved', history: [] });
  mockReviews.set(neither.id, { status: 'changes_requested', history: [] });

  const frames = [client, production, both, neither];
  const host = await mount(
    <ShotlistKanban
      store={store}
      frames={frames}
      labels={new Map(frames.map((f) => [f.id, f.label ?? '']))}
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly={false}
      onAddFrame={vi.fn()}
    />,
  );

  const sections = [...host.querySelectorAll('section.kanban__col')];
  const column = (name: string) => sections.find((s) => s.getAttribute('aria-label') === name);
  const labelsIn = (name: string) =>
    [...(column(name)?.querySelectorAll('.kanban__card-label') ?? [])].map((b) => b.textContent);
  expect(labelsIn('Approved')).toEqual(['1A', '1B', '1C']);
  expect(column('Approved')?.querySelector('.kanban__cnt')?.textContent).toBe('3');
  expect(labelsIn('Shot')).toEqual(['1D']);
  expect(column('Shot')?.querySelector('.kanban__cnt')?.textContent).toBe('1');
  expect(column('Approved')?.querySelector('.kanban__hint')?.textContent).toBe(
    'Also filled from client approvals',
  );
  // Only the column moves: the production fields in the document stay as they were.
  const stored = doc.getMap('elements').get(client.id) as Y.Map<unknown> | undefined;
  expect(stored?.get('status')).toBe('shot');
  expect(stored?.get('approved')).toBeUndefined();

  mockReviews.clear();
});

it("doesn't offer to move a card the client approved, so it can't bounce back", async () => {
  const { doc, store } = board();
  const make = (label: string) =>
    createElement(
      doc,
      'frame',
      { x: 0, y: 0 },
      { label, status: 'shot' },
      { userId: null },
    ) as FrameElement;
  const frame = make('3A');
  const free = make('3B');
  mockReviews.set(frame.id, { status: 'approved', history: [] });

  const host = await mount(
    <ShotlistKanban
      store={store}
      frames={[frame, free]}
      labels={
        new Map([
          [frame.id, '3A'],
          [free.id, '3B'],
        ])
      }
      boardAspect="16:9"
      selected={null}
      onSelect={vi.fn()}
      readOnly={false}
      onAddFrame={vi.fn()}
    />,
  );
  const stored = (id: string) => doc.getMap('elements').get(id) as Y.Map<unknown> | undefined;
  const dropOn = (column: string, id: string) => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: (type: string) => (type === 'application/x-inkadra-frame' ? id : '') },
    });
    act(() => {
      host.querySelector(`section.kanban__col[aria-label="${column}"]`)?.dispatchEvent(drop);
    });
  };

  const card = [...host.querySelectorAll<HTMLElement>('.kanban__card')].find(
    (c) => c.querySelector('.kanban__card-label')?.textContent === '3A',
  );
  expect(card?.getAttribute('draggable')).toBe('false');
  expect(card?.querySelector('.kanban__move-select')).toBeNull();
  // The client's decision stays visible on the card.
  expect(card?.querySelector('.review-chip--approved')).not.toBeNull();
  // The card button says why it can't move and where to change it, on screen too.
  const body = card?.querySelector<HTMLButtonElement>('.kanban__card-body');
  const reason = document.getElementById(body?.getAttribute('aria-describedby') ?? '');
  expect(reason?.textContent).toBe(
    'Approved in review: change the review from “Approved” and the production status from the Table',
  );
  expect(card?.contains(reason ?? null)).toBe(true);

  // Alt+arrow from the focused card button.
  body?.focus();
  act(() => {
    body?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
    );
  });
  // A drop of the card's own data on another column.
  dropOn('To shoot', frame.id);
  expect(stored(frame.id)?.get('status')).toBe('shot');
  expect(stored(frame.id)?.get('approved')).toBeUndefined();

  // The same drop moves a card that isn't approved in review: the guard, not the event, stops it.
  dropOn('To shoot', free.id);
  expect(stored(free.id)?.get('status')).toBe('todo');

  mockReviews.clear();
});
