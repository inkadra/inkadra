import { chooseSelect } from '../../test/select.ts';
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
      const plural = params && 'count' in params ? (params.count === 1 ? '_one' : '_other') : '';
      const parts = key.split('.');
      const last = parts.length - 1;
      for (const [i, part] of parts.entries()) {
        if (i === last && plural && typeof node === 'object' && node !== null) {
          const forms = node as Record<string, unknown>;
          if (`${part}${plural}` in forms) {
            node = forms[`${part}${plural}`];
            break;
          }
        }
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

it('renders table with Cast column, footer totals and add-shot buttons', async () => {
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
  expect(footer?.textContent).toMatch(/\b1 shot(?!s)/);

  // The toolbar button carries a plus icon, so its label has no "+" of its own.
  const addButtons = host.querySelectorAll('button');
  const addBtnTexts = Array.from(addButtons).map((b) => b.textContent?.trim());
  expect(addBtnTexts).toContain('Shot');
  expect(addBtnTexts).not.toContain('+ Shot');
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
  const statusSelect = toolbar?.querySelector<HTMLButtonElement>(
    '.ink-select[aria-label="Change status"]',
  );
  expect(statusSelect).not.toBeNull();

  await act(async () => {
    if (statusSelect) {
      chooseSelect(statusSelect, 'shot');
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

it('applies bulk actions only to visible rows, prunes selection on filter change, and shows affected count', async () => {
  const { doc, store } = board();
  const scene = addScene(doc, { number: '1', title: 'Bar' }, { userId: null });
  const f1 = addFrame(doc, scene.id, null, { label: '1A', status: 'todo' }, { userId: null });
  const f2 = addFrame(doc, scene.id, null, { label: '1B', status: 'ready' }, { userId: null });

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);

  // Select all visible rows (1A and 1B)
  const selectAll = host.querySelector<HTMLInputElement>(
    'th.shots__select-col input[type="checkbox"]',
  );
  await act(async () => {
    selectAll?.click();
  });

  const toolbar = host.querySelector('.shots__bulk-toolbar');
  expect(toolbar?.textContent).toContain('2 selected');

  // Filter to show only ready status (frame 1B)
  const filterSelect = host.querySelector<HTMLButtonElement>('.ink-select[aria-label="Status"]');
  expect(filterSelect).not.toBeNull();
  await act(async () => {
    if (filterSelect) {
      chooseSelect(filterSelect, 'ready');
    }
  });

  // Toolbar should now show only 1 selected (the visible one)
  expect(toolbar?.textContent).toContain('1 selected');

  // Bulk delete should only affect the visible frame 1B, not the hidden frame 1A
  const deleteBtn = toolbar?.querySelector<HTMLButtonElement>('.shots__bulk-btn--danger');
  await act(async () => {
    deleteBtn?.click();
  });

  const elementsMap = doc.getMap('elements');
  expect(elementsMap.has(f2.id)).toBe(false);
  expect(elementsMap.has(f1.id)).toBe(true);
});

it('guards Cmd+D / Ctrl+D against editable targets, open dialogs, and lack of focus/selection', async () => {
  const { doc, store } = board();
  const scene = addScene(doc, { number: '1', title: 'Bar' }, { userId: null });
  const f1 = addFrame(doc, scene.id, null, { label: '1A', status: 'todo' }, { userId: null });

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);
  const elementsMap = doc.getMap('elements');

  // Case 1: No selection -> Cmd+D should not duplicate
  const eventNoSelection = new KeyboardEvent('keydown', {
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(eventNoSelection);
  expect(eventNoSelection.defaultPrevented).toBe(false);
  expect(elementsMap.size).toBe(2); // scene + f1

  // Select frame f1
  const rowCheckbox = host.querySelector<HTMLInputElement>(
    'td.shots__select-col input[type="checkbox"]',
  );
  await act(async () => {
    rowCheckbox?.click();
  });

  // Case 2: Focus is outside the shot list container
  const outsideBtn = document.createElement('button');
  document.body.appendChild(outsideBtn);
  outsideBtn.focus();

  const eventOutside = new KeyboardEvent('keydown', {
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(eventOutside);
  expect(eventOutside.defaultPrevented).toBe(false);
  expect(elementsMap.size).toBe(2);
  outsideBtn.remove();

  // Case 3: Focus inside an editable input inside the shot list
  const searchInput = host.querySelector<HTMLInputElement>('input.shots__filter');
  expect(searchInput).not.toBeNull();
  searchInput?.focus();

  const eventInput = new KeyboardEvent('keydown', {
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  searchInput?.dispatchEvent(eventInput);
  expect(eventInput.defaultPrevented).toBe(false);
  expect(elementsMap.size).toBe(2);

  // Case 4: An open dialog is present in document
  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.appendChild(dialog);
  const dialogInput = document.createElement('input');
  dialog.appendChild(dialogInput);
  dialogInput.focus();

  const eventDialog = new KeyboardEvent('keydown', {
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(eventDialog);
  expect(eventDialog.defaultPrevented).toBe(false);
  expect(elementsMap.size).toBe(2);
  dialog.remove();

  // Case 5: Focus is inside shot list and has selection -> duplicates
  rowCheckbox?.focus();
  const eventValid = new KeyboardEvent('keydown', {
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  rowCheckbox?.dispatchEvent(eventValid);
  expect(eventValid.defaultPrevented).toBe(true);
  expect(elementsMap.size).toBe(3); // scene + f1 + duplicated frame
  expect(elementsMap.has(f1.id)).toBe(true);
});

it('estimates scene and footer durations like the storyboard (one second per untimed frame)', async () => {
  const { doc, store } = board();
  const scene = addScene(doc, { number: '1', title: 'Bar' }, { userId: null });
  addFrame(doc, scene.id, null, { label: '1A', durationMs: 4_000 }, { userId: null });
  addFrame(doc, scene.id, null, { label: '1B' }, { userId: null });
  addFrame(doc, scene.id, null, { label: '1C' }, { userId: null });

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);

  expect(host.querySelector('.shots__scene-meta')?.textContent).toContain('0:06');
  expect(host.querySelector('.shots__footer')?.textContent).toContain('0:06');
});

it('shows each shot as a card on a phone and edits it in the frame panel', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(width < 768px)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  const { doc, store } = board();
  const scene = addScene(doc, { number: '4', title: 'Bar' }, { userId: null });
  addFrame(
    doc,
    scene.id,
    null,
    { label: '4C', shot: 'cu', lens: '85mm', durationMs: 4000, action: 'Neon on half his face' },
    { userId: null },
  );
  addFrame(doc, scene.id, null, { label: '4D', status: 'shot', approved: true }, { userId: null });

  const host = await mount(<ShotList store={store} boardTitle="Test Board" readOnly={false} />);

  // No wide table and no inline field editors: one card with the shot's summary.
  expect(host.querySelector('.shots__table')).toBeNull();
  expect(host.querySelector('input[aria-label="Lens"]')).toBeNull();
  const card = host.querySelector('.shot-card');
  expect(card?.querySelector('.shot-card__label')?.textContent).toBe('4C');
  expect(card?.querySelector('.shot-card__meta')?.textContent).toBe('Close-up · 85mm · 4s');
  expect(card?.querySelector('.shot-card__action')?.textContent).toBe('Neon on half his face');
  expect(card?.querySelector('.film-chip')).not.toBeNull();
  // The chip counts an approved shot as approved, like the scene pills and the footer.
  expect(host.querySelectorAll('.shot-card')[1]?.querySelector('.film-chip')?.textContent).toBe(
    'Approved',
  );

  // Scene heading, selection checkbox and "Add shot in scene" stay.
  expect(host.querySelector('.shot-cards__scene')?.textContent).toContain('4');
  expect(card?.querySelector('input[aria-label="Select shot 4C"]')).not.toBeNull();
  expect(host.querySelector('.shot-cards__add button')?.textContent).toContain('4');

  // "Select all" is reachable without the table header.
  const selectAll = host.querySelector<HTMLInputElement>('.shot-cards__select-all input');
  await act(async () => {
    selectAll?.click();
  });
  expect(card?.querySelector<HTMLInputElement>('input[aria-label="Select shot 4C"]')?.checked).toBe(
    true,
  );
  await act(async () => {
    selectAll?.click();
  });

  // Tapping the card opens the frame panel with every field and moves focus into it;
  // closing it gives focus back to the card.
  const body = card?.querySelector<HTMLButtonElement>('.shot-card__body');
  await act(async () => {
    body?.click();
  });
  const panel = host.querySelector<HTMLElement>('.film-panel');
  expect(panel).not.toBeNull();
  expect(body?.getAttribute('aria-expanded')).toBe('true');
  expect(body?.getAttribute('aria-controls')).toBe(panel?.id);
  expect(document.activeElement).toBe(panel);
  await act(async () => {
    panel?.querySelector<HTMLButtonElement>('button[aria-label="Close the details"]')?.click();
  });
  expect(host.querySelector('.film-panel')).toBeNull();
  expect(document.activeElement).toBe(body);
});
