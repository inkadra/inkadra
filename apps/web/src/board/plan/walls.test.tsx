// @vitest-environment happy-dom
import {
  createElement,
  listElements,
  moveWallCorner,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  toWallPoints,
} from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardStore } from '../store.ts';
import { type Ed, usePlanEditing } from './editing.ts';
import type { useBackgroundPicker } from './PlanBackground.tsx';
import { PlanStart } from './PlanStart.tsx';
import { PlanWallProperties } from './PlanWallProperties.tsx';
import { useWallTools, type WallTools } from './PlanWalls.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const picker = { can: true, state: 'idle', field: null, pick: () => {} } as unknown as ReturnType<
  typeof useBackgroundPicker
>;
// A room 400 × 300, a door half way down its second side.
const room = {
  id: 'wallRoomAAAAA',
  points: toWallPoints([
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 },
  ]),
  thickness: 10,
  closed: true,
};
const door = { id: 'doorAAAAAAAAA', wall: room.id, kind: 'door' as const, at: 550, width: 60 };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function Harness({
  doc,
  store,
  planId,
  out,
  view,
}: {
  doc: Y.Doc;
  store: BoardStore;
  planId: string;
  out: { ed: Ed | null; tools: WallTools | null };
  view: 'props' | 'start';
}) {
  // Follows the document, as the board does: each write renders the editor again.
  useSyncExternalStore(store.subscribe, () => store.getSnapshot());
  const ed = usePlanEditing({
    store,
    plan: planOf(doc, planId),
    phone: false,
    scenes: [],
    onOpenScene: () => {},
    onClose: () => {},
  });
  out.ed = ed;
  out.tools = useWallTools(ed, { snapped: (p) => p, zoom: 100 });
  return view === 'props' ? (
    <PlanWallProperties ed={ed} />
  ) : (
    <PlanStart ed={ed} picker={picker} onClose={() => {}} />
  );
}

async function mount(doc: Y.Doc, planId: string, view: 'props' | 'start' = 'props') {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const out: { ed: Ed | null; tools: WallTools | null } = { ed: null, tools: null };
  await act(async () =>
    root.render(<Harness doc={doc} store={store} planId={planId} out={out} view={view} />),
  );
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
  });
  return {
    host,
    get ed() {
      return out.ed as Ed;
    },
    get tools() {
      return out.tools as WallTools;
    },
  };
}

const roomPlan = (doc: Y.Doc) =>
  createElement(
    doc,
    'plan',
    { x: 0, y: 0 },
    { scale: 100, walls: [room], openings: [door] },
    { userId: null },
  );
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLElement;

it('drags a corner from the openings as they were when the drag started', async () => {
  const doc = createBoardDoc(boardId);
  const plan = roomPlan(doc);
  const m = await mount(doc, plan.id);
  await act(async () => m.ed.selectWall({ kind: 'walls', id: room.id }));
  const corner = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  corner.setAttribute('data-corner', '1');
  const to01 = (x: number, y: number) => ({ x: x / PLAN_VIEW_W, y: y / PLAN_VIEW_H });
  await act(async () => void m.tools.pick(to01(500, 100), corner));
  // Several moves on the way: each from the start, so the door does not creep.
  for (const [x, y] of [
    [560, 120],
    [620, 140],
    [700, 100],
  ] as const)
    await act(async () => void m.tools.move(to01(x, y)));
  await act(async () => void m.tools.up());
  const expected = moveWallCorner(room, 1, { x: 700, y: 100 }, [door]).openings[0]?.at as number;
  expect(planOf(doc, plan.id).openings?.[0]?.at).toBeCloseTo(expected, 1);
});

it('flips a door back to its default side, and changes its kind back', async () => {
  const doc = createBoardDoc(boardId);
  const plan = roomPlan(doc);
  const m = await mount(doc, plan.id);
  await act(async () => m.ed.selectWall({ kind: 'openings', id: door.id }));
  const flip = () => button(m.host, 'board.plan.walls.flip');
  await act(async () => flip().click());
  expect(planOf(doc, plan.id).openings?.[0]?.side).toBe('right');
  await act(async () => flip().click());
  expect(planOf(doc, plan.id).openings?.[0]?.side).toBeUndefined();
  await act(async () => button(m.host, 'board.plan.walls.swing').click());
  expect(planOf(doc, plan.id).openings?.[0]?.hinge).toBe('end');
  // A window has no hinge: changing the kind drops it.
  await act(async () => button(m.host, 'board.plan.walls.kinds.window').click());
  const opening = planOf(doc, plan.id).openings?.[0];
  expect([opening?.kind, opening?.hinge]).toEqual(['window', undefined]);
});

it('limits the width of an opening to its side', async () => {
  const doc = createBoardDoc(boardId);
  const plan = roomPlan(doc);
  const m = await mount(doc, plan.id);
  await act(async () => m.ed.selectWall({ kind: 'openings', id: door.id }));
  const field = m.host.querySelector(
    'input[aria-label="board.plan.walls.openingWidth"]',
  ) as HTMLInputElement;
  // The side is 3 m at this scale; 5 m is refused, 2.5 m written.
  const type = async (value: string) => {
    await act(async () => {
      field.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => field.blur());
  };
  await type('5');
  expect(planOf(doc, plan.id).openings?.[0]?.width).toBe(60);
  await type('2.5');
  expect(planOf(doc, plan.id).openings?.[0]?.width).toBe(250);
});

it('writes a ready room once, however often its button is clicked', async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const m = await mount(doc, plan.id, 'start');
  const go = button(m.host, 'board.plan.start.roomGo');
  await act(async () => {
    go.click();
    go.click();
  });
  expect(planOf(doc, plan.id).walls).toHaveLength(1);
});

it('leaves a locked wall and a locked opening as they are, until unlocked', async () => {
  const doc = createBoardDoc(boardId);
  const plan = roomPlan(doc);
  const m = await mount(doc, plan.id);
  // Lock the door from its properties.
  await act(async () => m.ed.selectWall({ kind: 'openings', id: door.id }));
  await act(async () => button(m.host, 'board.plan.lock').click());
  expect(planOf(doc, plan.id).openings?.[0]?.locked).toBe(true);
  // Its fields are disabled, a drag does not start, Delete does nothing.
  // Disabled by the fieldset around the fields, as an item's are.
  expect(button(m.host, 'board.plan.walls.flip').matches(':disabled')).toBe(true);
  const to01 = (x: number, y: number) => ({ x: x / PLAN_VIEW_W, y: y / PLAN_VIEW_H });
  const at = planOf(doc, plan.id).openings?.[0]?.at;
  const target = document.createElement('div');
  await act(async () => void m.tools.pick(to01(500, 250), target));
  await act(async () => void m.tools.move(to01(500, 350)));
  await act(async () => void m.tools.up());
  expect(planOf(doc, plan.id).openings?.[0]?.at).toBe(at);
  await act(async () => m.ed.remove());
  expect(planOf(doc, plan.id).openings).toHaveLength(1);
  // A write of its fields is refused by the shared check.
  await act(async () =>
    m.ed.writeWalls('openings', [{ ...door, locked: true, side: 'right' }]),
  );
  expect(planOf(doc, plan.id).openings?.[0]?.side).toBeUndefined();
  // Unlocked, it moves again.
  await act(async () => button(m.host, 'board.plan.unlock').click());
  expect(planOf(doc, plan.id).openings?.[0]?.locked).toBeUndefined();
  // A locked wall shows no corners to drag, and Delete keeps it.
  await act(async () => m.ed.selectWall({ kind: 'walls', id: room.id }));
  await act(async () => m.ed.toggleWallLock({ kind: 'walls', id: room.id }));
  const corner = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  corner.setAttribute('data-corner', '1');
  expect(m.tools.pick(to01(500, 100), corner)).toBe(true);
  await act(async () => void m.tools.move(to01(700, 100)));
  await act(async () => void m.tools.up());
  expect(planOf(doc, plan.id).walls?.[0]?.points).toEqual(room.points);
  await act(async () => m.ed.remove());
  expect(planOf(doc, plan.id).walls).toHaveLength(1);
});
