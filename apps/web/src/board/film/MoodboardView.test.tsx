// @vitest-environment happy-dom
import {
  canvasElements,
  createElement,
  deleteElements,
  sendToBack,
  updateElement,
} from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from '../store.ts';
import {
  MoodboardView,
  mergePalette,
  referenceGroups,
  referenceSlides,
  referencesOf,
} from './MoodboardView.tsx';

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
  getCachedAsset: () => undefined,
  useAssetPalettes: (ids: string[]) =>
    ids.map((id) => (id === 'palette' ? ['#112233', '#445566'] : [])),
  pickVariant: (asset: { url: string }) => asset.url,
  playbackUrl: (asset: { url: string }) => asset.url,
}));
vi.mock('../connection.ts', () => ({ collabUrl: () => '' }));
vi.mock('../chrome.tsx', () => ({
  UploadPanel: () => null,
  Toast: ({ text }: { text: string }) => <output className="toast">{text}</output>,
  ContextMenu: ({ items }: { items: Array<{ label?: string; action?: () => void }> }) => (
    <div role="menu">
      {items
        .filter((item) => item.label)
        .map((item) => (
          <button key={item.label} type="button" role="menuitem" onClick={item.action}>
            {item.label}
          </button>
        ))}
    </div>
  ),
}));
const addFramesToBoard = vi.fn(async () => {});
vi.mock('./send-to-storyboard.ts', async (original) => ({
  ...(await original<typeof import('./send-to-storyboard.ts')>()),
  addFramesToBoard: (...args: unknown[]) =>
    (addFramesToBoard as (...a: unknown[]) => unknown)(...args),
}));
const startUpload = vi.fn();
vi.mock('../uploads.ts', () => ({
  startUpload: (input: unknown) => startUpload(input),
  useUploads: () => [],
}));
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
async function mount(
  store: BoardStore,
  readOnly = true,
  storyboards?: Array<{ id: string; title: string }>,
) {
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
        storyboards={storyboards}
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
    (button) => button.textContent?.toLowerCase() === `#${name}`,
  ) ?? null;
const click = async (element: HTMLElement | null) => act(async () => element?.click());
const key = async (value: string, target: EventTarget = window, shiftKey = false) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, shiftKey }));
  });

it('lists references in the order the board draws them, also after one is sent to the back', () => {
  const { doc, store, add } = board();
  const first = add('image', { assetId: 'one' });
  const second = add('image', { assetId: 'two' });
  // Sending a picture to the back gives it a key before `a0` (`Zz`): collation put it last.
  sendToBack(doc, [second.id]);
  const all = [...store.getSnapshot().byId.values()];
  expect(canvasElements(all).map((el) => el.id)).toEqual([second.id, first.id]);
  expect(referencesOf(all).map((el) => el.id)).toEqual([second.id, first.id]);
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

it('navigates the filtered gallery, shows frame reuse and respects readOnly', async () => {
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

it('filters by kind and by tag with the chips, and "All" clears both', async () => {
  const { store, add } = board();
  add('image', { assetId: 'one', tags: ['Night', 'Rain'] });
  add('image', { assetId: 'two', tags: ['night'] });
  add('color', { hex: '#112233', tags: ['Rain'] });
  const host = await mount(store);
  expect(host.querySelector('.moodboard__side')).toBeNull();
  const named = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('.moodboard__chips button')].find(
      (button) => button.textContent === name,
    ) ?? null;
  await click(chip(host, 'night'));
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(2);
  expect(chip(host, 'night')?.getAttribute('aria-pressed')).toBe('true');
  // The same chip again clears the filter.
  await click(chip(host, 'night'));
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(3);
  await click(named('moodboard.colors'));
  await click(chip(host, 'rain'));
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(1);
  await click(named('moodboard.all'));
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(3);
  expect(host.querySelector('.moodboard__chips button')?.getAttribute('aria-pressed')).toBe('true');
});

it('shows no headings without groups, and named groups then the rest when there are', async () => {
  const { doc, store, add } = board();
  const first = add('image', { assetId: 'one' });
  add('image', { assetId: 'two' });
  const host = await mount(store);
  expect(host.querySelector('.moodboard__group')).toBeNull();
  expect(host.querySelectorAll('.moodboard__card')).toHaveLength(2);
  await act(async () => updateElement(doc, first.id, { group: 'Luce' }, LOCAL));
  const titles = [...host.querySelectorAll('.moodboard__group-title')].map((h) => h.textContent);
  expect(titles).toEqual(['Luce1', 'moodboard.ungrouped1']);
});

it('sorts groups by name, merges names without case and puts the ungrouped last', () => {
  const { store, add } = board();
  add('image', { assetId: 'a', group: 'Notte' });
  add('image', { assetId: 'b' });
  add('image', { assetId: 'c', group: 'luce' });
  add('color', { hex: '#112233', group: 'LUCE' });
  const groups = referenceGroups(referencesOf([...store.getSnapshot().byId.values()]));
  expect(groups.map((g) => [g.name, g.items.length])).toEqual([
    ['luce', 2],
    ['Notte', 1],
    [null, 1],
  ]);
});

it('takes the strongest colour of each picture first, without repeats, up to five', () => {
  expect(mergePalette([['#A', '#B'], ['#A', '#C'], ['#D']])).toEqual(['#A', '#D', '#B', '#C']);
  expect(mergePalette([['#1', '#2', '#3', '#4', '#5', '#6']])).toHaveLength(5);
});

it('shows the palette of the pictures and copies it', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const { store, add } = board();
  add('image', { assetId: 'palette' });
  const host = await mount(store);
  expect(host.querySelectorAll('.moodboard__palette li')).toHaveLength(2);
  await click(host.querySelector<HTMLButtonElement>('.moodboard__palette-copy'));
  expect(writeText).toHaveBeenCalledWith('#112233 #445566');
});

const checks = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLInputElement>('.moodboard__check input'),
];
const inBar = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.moodboard__selection button')].find(
    (button) => button.textContent === name,
  ) ?? null;

it('selects with the checkboxes and a click, then moves to a group and tags together', async () => {
  const { store, add } = board();
  const a = add('image', { assetId: 'one', tags: ['Old'] });
  const b = add('color', { hex: '#112233', tags: ['new'] });
  const locked = add('image', { assetId: 'two', locked: true });
  const host = await mount(store, false);
  expect(host.querySelector('.moodboard__selection')).toBeNull();
  await click(checks(host)[0] ?? null);
  expect(host.querySelector('.moodboard__selection')?.textContent).toContain('moodboard.selected');
  // With a selection going, a click on a tile selects instead of opening the viewer.
  await click(host.querySelector<HTMLElement>('.moodboard__card--color'));
  await click(checks(host)[2] ?? null);
  expect(document.querySelector('.viewer:not(.ink-motion-exit)')).toBeNull();
  expect(host.querySelectorAll('[data-picked]')).toHaveLength(3);

  await click(inBar(host, 'moodboard.moveToGroup'));
  const field = host.querySelector<HTMLInputElement>('.moodboard__popover input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      field,
      ' Luce ',
    );
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    field?.form?.requestSubmit();
  });
  const byId = () => store.getSnapshot().byId;
  expect(byId().get(a.id)).toMatchObject({ group: 'Luce' });
  expect(byId().get(b.id)).toMatchObject({ group: 'Luce' });
  expect(byId().get(locked.id)).not.toHaveProperty('group');
  expect(host.querySelector('.moodboard__notice')?.textContent).toBe('moodboard.lockedSkipped');

  await click(inBar(host, 'moodboard.tags'));
  await click(
    [...host.querySelectorAll<HTMLButtonElement>('.moodboard__options button')].find(
      (button) => button.textContent === '#new',
    ) ?? null,
  );
  expect((byId().get(a.id) as { tags: string[] }).tags).toEqual(['Old', 'new']);
  expect((byId().get(b.id) as { tags: string[] }).tags).toEqual(['new']);

  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(host.querySelector('.moodboard__selection')).toBeNull();
});

it('offers no selection to people who cannot edit', async () => {
  const { store, add } = board();
  add('image', { assetId: 'one' });
  const host = await mount(store);
  expect(checks(host)).toHaveLength(0);
  const tile = host.querySelector('.moodboard__tile') as HTMLElement;
  await act(async () => {
    tile.firstElementChild?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
  });
  expect(host.querySelector('.moodboard__selection')).toBeNull();
});

it('sends pictures to the storyboard as frames, keeps the references and skips colours', async () => {
  const { store, add } = board();
  const picture = add('image', { assetId: 'one', caption: 'Backlight', guestHidden: true });
  add('color', { hex: '#112233' });
  const host = await mount(store, false);
  await click(checks(host)[0] ?? null);
  await click(checks(host)[1] ?? null);
  await click(inBar(host, 'moodboard.sendToStoryboard'));
  const frames = [...store.getSnapshot().byId.values()].filter((el) => el.type === 'frame');
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({
    assetId: 'one',
    action: 'Backlight',
    guestHidden: true,
    parent: null,
  });
  expect(store.getSnapshot().byId.has(picture.id)).toBe(true);
  expect(host.querySelector('.toast')?.textContent).toBe('moodboard.sent');
});

it('asks which storyboard when the project has several, and sends there (decision 0121)', async () => {
  const { store, add } = board();
  add('image', { assetId: 'one' });
  const storyboards = [
    { id: 'film', title: 'Film' },
    { id: 'teaser', title: 'Teaser' },
  ];
  const host = await mount(store, false, storyboards);
  await click(checks(host)[0] ?? null);
  await click(inBar(host, 'moodboard.sendToStoryboard'));
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual(['Film', 'Teaser']);
  expect(addFramesToBoard).not.toHaveBeenCalled();
  await click(items[1] ?? null);
  expect(addFramesToBoard).toHaveBeenCalledWith('teaser', expect.any(Array), 'reader');
  // Nothing lands on the moodboard itself.
  expect([...store.getSnapshot().byId.values()].some((el) => el.type === 'frame')).toBe(false);
});

it('keeps slides to the pictures, with the note and the group', () => {
  const { store, add } = board();
  const image = add('image', { assetId: 'one', caption: 'Backlight', group: 'Luce' });
  add('color', { hex: '#112233' });
  const { groups, labels } = referenceSlides(referencesOf([...store.getSnapshot().byId.values()]));
  expect(groups[0]?.frames).toHaveLength(1);
  expect(groups[0]?.frames[0]).toMatchObject({
    id: image.id,
    assetId: 'one',
    action: 'Backlight',
    location: 'Luce',
  });
  expect(labels.get(image.id)).toBe('1');
});

it('renames a group on all its references, also those filtered out', async () => {
  const { store, add } = board();
  const a = add('image', { assetId: 'one', group: 'Luce', tags: ['x'] });
  const b = add('image', { assetId: 'two', group: 'luce' });
  const host = await mount(store, false);
  await click(chip(host, 'x'));
  await click(host.querySelector<HTMLButtonElement>('.moodboard__group-title button'));
  const field = host.querySelector<HTMLInputElement>('.moodboard__group-title input');
  if (field) field.value = 'Notte';
  await act(async () => {
    field?.focus();
    field?.blur();
  });
  expect(store.getSnapshot().byId.get(a.id)).toMatchObject({ group: 'Notte' });
  expect(store.getSnapshot().byId.get(b.id)).toMatchObject({ group: 'Notte' });
});

it('offers the existing ways to add a reference to editors only, in the bar and in the empty state', async () => {
  const empty = board();
  const readOnly = await mount(empty.store, true);
  expect(readOnly.textContent).toContain('moodboard.empty');
  expect(readOnly.querySelector('.moodboard__add')).toBeNull();
  expect(readOnly.querySelector('.moodboard__actions')).toBeNull();

  const { doc, store } = board();
  const host = await mount(store, false);
  expect(host.querySelector('.moodboard__empty svg')).not.toBeNull();
  // The empty state offers the same three actions as buttons.
  expect(
    [...host.querySelectorAll('.moodboard__empty .moodboard__actions button')].map(
      (b) => b.textContent,
    ),
  ).toEqual(['moodboard.addImage', 'moodboard.addLink', 'moodboard.addColor']);
  const add = host.querySelector<HTMLButtonElement>('.moodboard__bar .moodboard__add button');
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

  // Colour: a grey card is added and Inkadra's picker opens beside it (#764), not the
  // browser's; the picked hex is stored in capitals, as the schema wants.
  await click(items()[2] ?? null);
  const stored = () => [...store.getSnapshot().byId.values()].find((el) => el.type === 'color');
  expect(stored()?.type === 'color' && stored()?.hex).toBe('#808086');
  expect(host.querySelector('input[type="color"]')).toBeNull();
  const hex = host.querySelector<HTMLInputElement>(
    '.colorpicker input[aria-label="board.color.hex"]',
  );
  await act(async () => {
    if (hex) {
      hex.value = '#aabbcc';
      hex.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
  });
  expect(stored()?.type === 'color' && stored()?.hex).toBe('#AABBCC');
  expect(host.querySelector('.moodboard__empty')).toBeNull();
  // The hex field is drawn again for the new colour: Escape goes to the picker itself.
  await key('Escape', host.querySelector('.colorpicker') ?? window);
  expect(host.querySelector('.colorpicker')).toBeNull();

  // Link: a bare domain becomes https, and the preview is asked for.
  await click(add ?? null);
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
