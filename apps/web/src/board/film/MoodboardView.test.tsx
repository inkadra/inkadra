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
  playbackUrl: (asset: { url: string }) => asset.url,
}));
vi.mock('../chrome.tsx', () => ({ UploadPanel: () => null }));
const startUpload = vi.fn();
vi.mock('../uploads.ts', () => ({ startUpload: (input: unknown) => startUpload(input) }));
const fillLinkPreview = vi.fn(async () => true);
vi.mock('../links.ts', async (original) => ({
  ...(await original<typeof import('../links.ts')>()),
  fillLinkPreview: (...args: unknown[]) =>
    (fillLinkPreview as (...a: unknown[]) => unknown)(...args),
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
async function mount(store: BoardStore, readOnly = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MoodboardView
        store={store}
        projectId="project"
        userId="reader"
        readOnly={readOnly}
        boardTitle="Last Train"
      />,
    ),
  );
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
const chip = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.moodboard__chips button')].find(
    (button) => button.textContent?.toLowerCase() === name,
  ) ?? null;
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
  expect(host.querySelectorAll('.moodboard__card--color')).toHaveLength(1);
  await click(chip(host, 'day'));
  expect(chip(host, 'day')?.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelectorAll('button.moodboard__card')).toHaveLength(1);
  expect(host.querySelector('.moodboard__card--color')).toBeNull();
  const preview = [...store.getSnapshot().byId.values()].find((el) => el.type === 'link');
  await act(async () => {
    if (preview) updateElement(doc, preview.id, { tags: [] }, LOCAL);
  });
  expect(host.textContent).toContain('moodboard.noMatches');
});

it('navigates the filtered gallery without a compare action, shows frame reuse and respects readOnly', async () => {
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
  await click(chip(host, 'night'));
  const opener = host.querySelector<HTMLButtonElement>('button.moodboard__card');
  await click(opener);
  const dialog = () => host.querySelector('[role="dialog"]');
  expect(dialog()?.textContent).toContain('1 / 2');
  expect(dialog()?.textContent).toContain('4C');
  expect(dialog()?.querySelector('[data-tags-readonly="true"]')).not.toBeNull();
  expect(dialog()?.textContent).not.toContain('viewer.addColors');
  const buttons = () => [...(dialog()?.querySelectorAll('button') ?? [])];
  expect(
    buttons().some((button) => button.getAttribute('aria-label') === 'moodboard.compare'),
  ).toBe(false);
  expect(dialog()?.querySelectorAll('.viewer__stage img')).toHaveLength(1);
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

it('lays the gallery out by type: captions on images, domain on links, hex on colors', async () => {
  const { store, add } = board();
  add('image', { assetId: 'one', caption: 'Night photo', tags: ['Night'] });
  add('image', { assetId: 'two' });
  add('link', {
    url: 'https://www.example.com/page',
    imageAssetId: 'preview',
    title: 'Day preview',
  });
  add('color', { hex: '#112233', label: 'Midnight' });
  add('color', { hex: '#F0F0F0' });
  const host = await mount(store);
  const [captioned, bare] = host.querySelectorAll('.moodboard__card--image');
  expect(captioned?.querySelector('.moodboard__caption')?.textContent).toContain('Night photo');
  // A picture with no caption and no tags has nothing to overlay.
  expect(bare?.querySelector('.moodboard__caption')).toBeNull();
  const link = host.querySelector('.moodboard__card--link');
  expect(link?.querySelector('img')).not.toBeNull();
  expect(link?.textContent).toContain('Day preview');
  expect(link?.textContent).toContain('example.com');
  expect(link?.textContent).not.toContain('www.');
  const [dark, light] = host.querySelectorAll<HTMLElement>('.moodboard__card--color');
  expect(dark?.textContent).toContain('#112233');
  expect(dark?.textContent).toContain('Midnight');
  expect(dark?.hasAttribute('data-light')).toBe(false);
  expect(light?.hasAttribute('data-light')).toBe(true);
  expect(host.querySelector('.moodboard__empty')).toBeNull();
});

it('names the board and counts its tags in the side column, and the chips filter the same way', async () => {
  const { store, add } = board();
  add('image', { assetId: 'one', tags: ['Night', 'Rain'] });
  add('image', { assetId: 'two', tags: ['night'] });
  add('color', { hex: '#112233', tags: ['Rain'] });
  const host = await mount(store);
  const side = host.querySelector('.moodboard__side');
  expect(side?.textContent).toContain('Last Train');
  expect(side?.textContent).toContain('moodboard.count');
  const rows = [...(side?.querySelectorAll('li button') ?? [])].map((b) => b.textContent);
  expect(rows).toEqual(['night2', 'rain2']);
  await click(side?.querySelector<HTMLButtonElement>('li button') ?? null);
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(2);
  expect(chip(host, 'night')?.getAttribute('aria-pressed')).toBe('true');
  // The same chip again, or "All", clears the filter.
  await click(chip(host, 'night'));
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(3);
  expect(host.querySelector('.moodboard__chips button')?.getAttribute('aria-pressed')).toBe('true');
});

it('offers the existing ways to add a reference to editors only, in the bar and in the empty state', async () => {
  const empty = board();
  const readOnly = await mount(empty.store, true);
  expect(readOnly.textContent).toContain('moodboard.empty');
  expect(readOnly.querySelector('.moodboard__add')).toBeNull();

  const { doc, store } = board();
  const host = await mount(store, false);
  expect(host.querySelector('.moodboard__empty svg')).not.toBeNull();
  const add = host.querySelector<HTMLButtonElement>('.moodboard__add button');
  expect(add?.getAttribute('aria-expanded')).toBe('false');
  await click(add ?? null);
  const items = () => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items().map((item) => item.textContent)).toEqual([
    'moodboard.addImage',
    'moodboard.addLink',
    'moodboard.addColor',
  ]);

  // Upload: the picture joins the board once its asset exists, and only once.
  const input = host.querySelector<HTMLInputElement>('[data-testid="moodboard-files"]');
  const file = new File(['x'], 'still.png', { type: 'image/png' });
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const started = startUpload.mock.calls.at(-1)?.[0] as {
    file: File;
    onAsset: (id: string) => void;
  };
  expect(started.file).toBe(file);
  await act(async () => {
    started.onAsset('asset-1');
    started.onAsset('asset-1');
  });
  const images = [...store.getSnapshot().byId.values()].flatMap((el) =>
    el.type === 'image' ? [el.assetId] : [],
  );
  expect(images).toEqual(['asset-1']);

  // Color: the picked hex is stored in capitals, as the schema wants.
  const color = host.querySelector<HTMLInputElement>('[data-testid="moodboard-color"]');
  await act(async () => {
    if (color) {
      color.value = '#aabbcc';
      color.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const stored = [...store.getSnapshot().byId.values()].find((el) => el.type === 'color');
  expect(stored?.type === 'color' && stored.hex).toBe('#AABBCC');
  expect(host.querySelector('.moodboard__empty')).toBeNull();

  // Link: a bare domain becomes https, and the preview is asked for.
  await click(host.querySelector<HTMLButtonElement>('.moodboard__add button'));
  await click(items()[1] ?? null);
  const field = host.querySelector<HTMLInputElement>('.moodboard__popover input');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(field, 'example.org/clip');
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    field?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(fillLinkPreview).toHaveBeenCalledWith(
    doc,
    expect.any(String),
    'project',
    '',
    'https://example.org/clip',
  );
  expect([...store.getSnapshot().byId.values()].some((el) => el.type === 'link')).toBe(true);
  expect(host.querySelector('.moodboard__popover')).toBeNull();
});
