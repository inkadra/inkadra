// @vitest-environment happy-dom
import { createElement, deleteElements, updateElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from '../store.ts';
import { MoodboardView, referencesOf } from './MoodboardView.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../assets.ts', () => ({
  useAsset: (id?: string) =>
    id === 'missing'
      ? 'missing'
      : id
        ? {
            id,
            kind: 'image',
            filename: `${id}.jpg`,
            url: `/${id}.jpg`,
            mime: 'image/jpeg',
            width: 800,
            height: 600,
            variants: [],
            palette: ['#112233'],
            exif: null,
          }
        : undefined,
  pickVariant: (asset: { url: string }) => asset.url,
}));
vi.mock('../tags.tsx', () => ({
  normaliseTag: (value: string) => value.trim().toLowerCase(),
  TagEditor: ({ readOnly }: { readOnly: boolean }) => <span data-tags-readonly={readOnly} />,
}));

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  const add = <T extends Parameters<typeof createElement>[1]>(
    type: T,
    fields: Parameters<typeof createElement<T>>[3],
  ) => createElement(doc, type, { x: 0, y: 0 }, fields, { userId: null });
  return { doc, store, add };
}
async function mount(store: BoardStore) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<MoodboardView store={store} projectId="project" userId="reader" readOnly />),
  );
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
const click = async (element: HTMLElement | null) => act(async () => element?.click());
const key = async (value: string, target: EventTarget = window, shiftKey = false) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, shiftKey }));
  });

it('selects actual image, preview and color cards, including nested references, with case-insensitive tags', () => {
  const { store, add } = board();
  const column = add('column', { title: 'References' });
  const image = add('image', { assetId: 'one', tags: ['Night'], parent: column.id });
  const color = add('color', { hex: '#112233', tags: ['night'] });
  const link = add('link', { url: 'https://example.com', imageAssetId: 'preview', tags: ['Day'] });
  add('link', { url: 'https://example.com/no-preview' });
  add('file', { assetId: 'file' });
  add('frame', { assetId: 'one' });
  const all = [...store.getSnapshot().byId.values()];
  expect(referencesOf(all).map((el) => el.id)).toEqual([image.id, color.id, link.id]);
  expect(referencesOf(all, ' NIGHT ').map((el) => el.id)).toEqual([image.id, color.id]);
});

it('renders empty state, reacts to Yjs updates and filters the gallery and palette together', async () => {
  const { doc, store, add } = board();
  const host = await mount(store);
  expect(host.textContent).toContain('moodboard.empty');
  await act(async () => {
    add('image', { assetId: 'one', caption: 'Night photo', tags: ['Night'] });
    add('link', {
      url: 'https://example.com',
      imageAssetId: 'preview',
      title: 'Day preview',
      tags: ['Day'],
    });
    add('color', { hex: '#112233', label: 'Night palette', tags: ['Night'] });
  });
  expect(host.querySelectorAll('button.moodboard__card')).toHaveLength(2);
  expect(host.querySelectorAll('.moodboard__color')).toHaveLength(1);
  const filter = host.querySelector('select');
  await act(async () => {
    if (filter) filter.value = 'day';
    filter?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelectorAll('button.moodboard__card')).toHaveLength(1);
  expect(host.querySelector('.moodboard__color')).toBeNull();
  const preview = [...store.getSnapshot().byId.values()].find((el) => el.type === 'link');
  await act(async () => {
    if (preview) updateElement(doc, preview.id, { tags: [] }, LOCAL);
  });
  expect(host.textContent).toContain('moodboard.noMatches');
});

it('navigates the filtered gallery, compares real references, shows frame reuse and respects readOnly', async () => {
  const { doc, store, add } = board();
  const first = add('image', { assetId: 'one', caption: 'First', tags: ['Night'] });
  add('image', { assetId: 'excluded', tags: ['Day'] });
  const last = add('link', {
    url: 'https://example.com',
    imageAssetId: 'two',
    title: 'Second',
    tags: ['Night'],
  });
  add('frame', { assetId: 'one', label: '4C' });
  const host = await mount(store);
  const filter = host.querySelector('select');
  await act(async () => {
    if (filter) filter.value = 'night';
    filter?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const opener = host.querySelector<HTMLButtonElement>('button.moodboard__card');
  await click(opener);
  const dialog = () => host.querySelector('[role="dialog"]');
  expect(dialog()?.textContent).toContain('1 / 2');
  expect(dialog()?.textContent).toContain('4C');
  expect(dialog()?.querySelector('[data-tags-readonly="true"]')).not.toBeNull();
  expect(dialog()?.textContent).not.toContain('viewer.addColors');
  const buttons = () => [...(dialog()?.querySelectorAll('button') ?? [])];
  await click(buttons().find((button) => button.getAttribute('aria-label') === 'moodboard.compare') ?? null);
  expect(dialog()?.querySelectorAll('.viewer__stage img')).toHaveLength(2);
  await key('ArrowRight');
  expect(dialog()?.textContent).toContain('2 / 2');
  expect(dialog()?.querySelector('.viewer__stage-title')?.textContent).toBe('Second');
  await key('ArrowRight');
  expect(dialog()?.textContent).toContain('2 / 2');
  await key('ArrowLeft');
  expect(dialog()?.textContent).toContain('1 / 2');
  const focusable = () => [
    ...(dialog()?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]',
    ) ?? []),
  ];
  const finalControl = focusable().at(-1);
  finalControl?.focus();
  await key('Tab', finalControl);
  expect(document.activeElement).toBe(focusable()[0]);
  await key('Tab', focusable()[0], true);
  expect(document.activeElement).toBe(finalControl);
  const input = document.createElement('input');
  dialog()?.append(input);
  input.focus();
  await key('ArrowRight', input);
  expect(dialog()?.textContent).toContain('1 / 2');
  input.remove();
  await key('Escape');
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(opener);
  await click(opener);
  await act(async () => deleteElements(doc, [first.id, last.id], LOCAL));
  expect(dialog()).toBeNull();
});

it('shows an honest placeholder for missing assets', async () => {
  const { store, add } = board();
  add('image', { assetId: 'missing' });
  const host = await mount(store);
  expect(host.textContent).toContain('moodboard.unavailable');
  expect(host.querySelector('img')).toBeNull();
  await click(host.querySelector('button.moodboard__card'));
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('moodboard.unavailable');
});
