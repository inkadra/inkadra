// @vitest-environment happy-dom
import { addScene, addTodoItem, type SceneElement } from '@inkadra/canvas-core';
import { contentCounts, createBoardDoc, type Element } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { updatePreferences } from '../../lib/preferences.ts';
import { BoardStore } from '../store.ts';
import { neededForDay } from './needed.ts';
import { addSceneList, listsOfScene, SceneToBring } from './SceneToBring.tsx';
import { newScheduleBlock } from './schedule.ts';

const get = vi.hoisted(() => vi.fn(async (_path: string): Promise<unknown> => ({ items: [] })));
vi.mock('../../lib/api.ts', async (original) => {
  const real = await original<typeof import('../../lib/api.ts')>();
  return {
    ...real,
    api: { ...real.api, get, patch: vi.fn(async (_path: string, patch: unknown) => patch) },
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const BOARD = '0193f0a4-6c1e-7b9a-9c51-00000000000a';
const disposals: Array<() => void> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
  await updatePreferences({ modulesOff: [] });
});

function storyboard(id = BOARD) {
  const doc = createBoardDoc(id);
  const store = new BoardStore(doc);
  const { id: sceneId } = addScene(doc, { number: '12' }, { userId: null });
  const scene = () => store.getSnapshot().byId.get(sceneId) as SceneElement;
  return { doc, store, scene };
}

async function mount(store: BoardStore, scene: SceneElement, readOnly = false) {
  // happy-dom has no native modal: the shared Dialog only needs it to open.
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <SceneToBring
        store={store}
        scene={scene}
        boardId={BOARD}
        projectId="p"
        userId="u"
        readOnly={readOnly}
      />,
    ),
  );
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const byLabel = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined;
const byText = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (el) => el.textContent?.trim() === text,
  );
const click = (el: HTMLElement | undefined) =>
  act(async () => {
    expect(el).toBeDefined();
    el?.click();
  });
async function type(label: string, value: string) {
  const input = byLabel(label) as HTMLInputElement | undefined;
  expect(input).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}
const lists = (store: BoardStore, scene: SceneElement) =>
  listsOfScene(store.getSnapshot().byId.values(), scene.id);

it('creates a typed list linked to the scene, names it, adds, ticks and deletes items and the list', async () => {
  const { store, scene } = storyboard();
  await mount(store, scene());
  await click(byLabel('needed.scene.labelEmpty'));
  expect(byLabel('needed.scene.dialog')?.textContent).toContain('needed.scene.emptyTitle');

  await click(byText('needed.scene.addList'));
  await click(byText('board.todo.lists.props'));
  const [list] = lists(store, scene());
  expect(list).toMatchObject({ type: 'todo', list: 'props', sceneId: scene().id, items: [] });

  // The name field is ready; Enter names the list and goes to its first item.
  await type('needed.scene.listName', 'Pier');
  await type('needed.scene.itemName', 'Rope');
  await type('needed.scene.itemName', 'Ferry ticket');
  expect(lists(store, scene())[0]).toMatchObject({ title: 'Pier' });
  expect(lists(store, scene())[0]?.items.map((i) => [i.text, i.done])).toEqual([
    ['Rope', false],
    ['Ferry ticket', false],
  ]);
  expect(byLabel('needed.scene.label')?.textContent).toContain('0/2');

  await click(byLabel('Rope'));
  expect(lists(store, scene())[0]?.items[0]?.done).toBe(true);
  expect(byLabel('needed.scene.label')?.textContent).toContain('1/2');

  // × deletes at once; one undo step brings it back.
  await click(document.querySelectorAll<HTMLElement>('[aria-label="needed.scene.delete"]')[1]);
  expect(lists(store, scene())[0]?.items.map((i) => i.text)).toEqual(['Rope']);
  expect(document.body.textContent).toContain('needed.scene.itemDeleted');
  await act(async () => store.undo.undo());
  expect(lists(store, scene())[0]?.items.map((i) => i.text)).toEqual(['Rope', 'Ferry ticket']);

  // Change the type, then delete the list after the question.
  await click(byLabel('needed.scene.listOptions'));
  await click(byText('needed.scene.changeType'));
  await click(byText('board.todo.lists.wardrobe'));
  expect(lists(store, scene())[0]?.list).toBe('wardrobe');
  await click(byLabel('needed.scene.listOptions'));
  await click(byText('needed.scene.deleteList'));
  expect(lists(store, scene())).toHaveLength(1);
  await click(byText('needed.scene.deleteConfirm'));
  expect(lists(store, scene())).toHaveLength(0);
  await act(async () => store.undo.undo());
  expect(lists(store, scene())[0]?.items).toHaveLength(2);
});

it('with Production off, keeps the button only for a scene with lists: read and tick, nothing new', async () => {
  await updatePreferences({ modulesOff: ['production'] });
  const empty = storyboard();
  const none = await mount(empty.store, empty.scene());
  expect(none.querySelector('[data-tour="storyboard-to-bring"]')).toBeNull();

  const { store, doc, scene } = storyboard();
  const id = addSceneList(store, scene(), 'equipment', 'u');
  addTodoItem(doc, id, 'Dolly');
  await mount(store, scene());
  await click(byLabel('needed.scene.label'));
  expect(byText('needed.scene.addList')).toBeUndefined();
  expect(byText('needed.scene.addItem')).toBeUndefined();
  await click(byLabel('Dolly'));
  expect(lists(store, scene())[0]?.items[0]?.done).toBe(true);
});

it('shows a viewer the lists read only, and no button on a scene without lists', async () => {
  const empty = storyboard();
  const none = await mount(empty.store, empty.scene(), true);
  expect(none.querySelector('[data-tour="storyboard-to-bring"]')).toBeNull();

  const { store, doc, scene } = storyboard();
  addTodoItem(doc, addSceneList(store, scene(), 'wardrobe', 'u'), 'Coat');
  await mount(store, scene(), true);
  await click(byLabel('needed.scene.label'));
  expect((byLabel('Coat') as HTMLInputElement).disabled).toBe(true);
  expect(byLabel('needed.scene.listOptions')).toBeUndefined();
  expect(byText('needed.scene.addList')).toBeUndefined();
  expect(document.body.textContent).toContain('needed.scene.readOnly');
});

it('names the shooting days of the scene in the footer', async () => {
  const { store, scene } = storyboard();
  get.mockImplementation(async (path: string) =>
    path.endsWith('/schedule')
      ? {
          items: [
            { id: 'd2', boardId: BOARD, date: '2026-11-12', blocks: [] },
            {
              id: 'd1',
              boardId: BOARD,
              date: '2026-11-10',
              blocks: [{ ...newScheduleBlock('scene'), sceneId: scene().id }],
            },
          ],
        }
      : { items: [] },
  );
  await mount(store, scene());
  await click(byLabel('needed.scene.labelEmpty'));
  expect(document.querySelector('.to-bring__days')?.textContent).toBe('needed.scene.days');
  get.mockImplementation(async () => ({ items: [] }));
});

it('gathers on a Production day the lists of a separate Storyboard, which stay off its loose cards', () => {
  const a = storyboard();
  const b = storyboard('0193f0a4-6c1e-7b9a-9c51-00000000000b');
  const id = addSceneList(a.store, a.scene(), 'props', 'u');
  addTodoItem(a.doc, id, 'Rope');
  // The Production board reads the storyboards' cards merged, as useScheduleSources does.
  const merged = new Map<string, Element>([
    ...b.store.getSnapshot().byId,
    ...a.store.getSnapshot().byId,
  ]);
  const day = {
    date: '2026-11-17',
    callTime: '06:30',
    wrap: null,
    location: '',
    notes: '',
    blocks: [{ ...newScheduleBlock('scene'), sceneId: a.scene().id, sceneBoardId: BOARD }],
  };
  expect(neededForDay(day, merged.values()).map((r) => [r.list, r.text, r.scenes])).toEqual([
    ['props', 'Rope', ['12']],
  ]);
  expect(contentCounts(a.store.getSnapshot().byId.values()).looseCount).toBe(0);
});
