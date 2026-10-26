// @vitest-environment happy-dom
import { addFrame, addScene } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import { BoardStore } from '../store.ts';
import { ShotList } from './ShotList.tsx';

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

it('renders table with Cast column, footer totals and + Shot buttons', async () => {
  const { doc, store } = board();
  const scene = addScene(doc, { number: '1', title: 'Bar' }, { userId: null });
  addFrame(
    doc,
    scene.id,
    null,
    {
      label: '1A',
      cast: ['Antonio', 'Barista'],
      location: 'Bar Lume',
      status: 'ready',
      durationMs: 10_000,
    },
    { userId: null },
  );

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);

  // Cast column header
  const headers = Array.from(host.querySelectorAll('th')).map((th) => th.textContent?.trim());
  expect(headers).toContain('Cast');

  // Cast input field in row
  const castCell = host.querySelector<HTMLInputElement>('input[aria-label="Cast"]');
  expect(castCell).not.toBeNull();
  expect(castCell?.value).toBe('Antonio, Barista');

  // Footer totals
  const footer = host.querySelector('.shots__footer');
  expect(footer).not.toBeNull();
  expect(footer?.textContent).toContain('1 shots');

  // + Shot button in header and scene
  const addButtons = host.querySelectorAll('button');
  const addBtnTexts = Array.from(addButtons).map((b) => b.textContent?.trim());
  expect(addBtnTexts).toContain('+ Shot');
});

it('supports row multi-selection and bulk actions (change status and delete)', async () => {
  const { doc, store } = board();
  const scene = addScene(doc, { number: '1', title: 'Bar' }, { userId: null });
  const f1 = addFrame(doc, scene.id, null, { label: '1A', status: 'todo' }, { userId: null });
  const f2 = addFrame(doc, scene.id, null, { label: '1B', status: 'todo' }, { userId: null });

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);

  // Select all checkbox in thead
  const selectAll = host.querySelector<HTMLInputElement>(
    'th.shots__select-col input[type="checkbox"]',
  );
  expect(selectAll).not.toBeNull();

  await act(async () => {
    selectAll?.click();
  });

  // Bulk actions toolbar should appear
  const toolbar = host.querySelector('.shots__bulk-toolbar');
  expect(toolbar).not.toBeNull();
  expect(toolbar?.textContent).toContain('2 selected');

  // Change status to 'shot'
  const statusSelect = toolbar?.querySelector<HTMLSelectElement>(
    'select[aria-label="Change status"]',
  );
  expect(statusSelect).not.toBeNull();

  await act(async () => {
    if (statusSelect) {
      statusSelect.value = 'shot';
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  const elementsMap = doc.getMap('elements');
  expect((elementsMap.get(f1.id) as Y.Map<unknown> | undefined)?.get('status')).toBe('shot');
  expect((elementsMap.get(f2.id) as Y.Map<unknown> | undefined)?.get('status')).toBe('shot');

  // Bulk delete
  const deleteBtn = toolbar?.querySelector<HTMLButtonElement>('.shots__bulk-btn--danger');
  expect(deleteBtn).not.toBeNull();

  await act(async () => {
    deleteBtn?.click();
  });

  expect(elementsMap.has(f1.id)).toBe(false);
  expect(elementsMap.has(f2.id)).toBe(false);
});
