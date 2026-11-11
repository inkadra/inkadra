// @vitest-environment happy-dom
import {
  addPlanCircuit,
  addPlanIcon,
  addVariant,
  createElement,
  listElements,
  modifiersOn,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  updatePlanCircuits,
  variantView,
} from '@inkadra/canvas-core';
import { createBoardDoc, type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardStore } from '../store.ts';
import { type Ed, usePlanEditing } from './editing.ts';
import { PlanKit } from './PlanKit.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const at = { x: 400, y: 300, w: 60, h: 60, color: '#1C1C1E' };
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** The editor of `planId` (a setup when `baseId` is given) with its Kit tab; `out` gets its state. */
function Harness({
  doc,
  store,
  planId,
  baseId,
  out,
}: {
  doc: Y.Doc;
  store: BoardStore;
  planId: string;
  baseId: string | undefined;
  out: { ed: Ed | null };
}) {
  const ed = usePlanEditing({
    store,
    plan: planOf(doc, planId),
    base: baseId ? planOf(doc, baseId) : undefined,
    phone: false,
    scenes: [],
    onOpenScene: () => {},
    onClose: () => {},
  });
  out.ed = ed;
  return <PlanKit ed={ed} onCallSheet={() => {}} />;
}

async function mount(doc: Y.Doc, planId: string, baseId?: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const out: { ed: Ed | null } = { ed: null };
  const render = () =>
    act(async () =>
      root.render(<Harness doc={doc} store={store} planId={planId} baseId={baseId} out={out} />),
    );
  await render();
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
  });
  return {
    store,
    host,
    render,
    get ed() {
      return out.ed as Ed;
    },
  };
}

it('moves an item of a setup to Set into the base, in one undo step', async () => {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const setup = addVariant(doc, planOf(doc, base.id), 'Sera', { userId: null });
  const table = addPlanIcon(doc, setup, { ...at, kind: 'table', layer: 'actors' }) as string;
  const m = await mount(doc, setup, base.id);
  await act(async () => m.ed.setSelection([{ kind: 'icons', id: table }]));
  await m.render();
  await act(async () => m.ed.moveToLayer('set'));
  // The base's now, on its kind's layer (Set), and drawn in the setup; not the setup's own.
  expect(planOf(doc, base.id).icons).toMatchObject([{ id: table, kind: 'table' }]);
  expect(planOf(doc, base.id).icons?.[0]?.layer).toBeUndefined();
  expect(planOf(doc, setup).icons ?? []).toEqual([]);
  expect(variantView(planOf(doc, setup), planOf(doc, base.id)).icons?.map((i) => i.id)).toEqual([
    table,
  ]);
  m.store.undo.undo();
  expect(planOf(doc, base.id).icons ?? []).toEqual([]);
  expect(planOf(doc, setup).icons).toMatchObject([{ id: table, layer: 'actors' }]);
});

it('writes a circuit name once, on blur, and only that circuit', async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  addPlanCircuit(doc, plan.id, { name: 'A', amps: 16 });
  addPlanCircuit(doc, plan.id, { name: 'B', amps: 16 });
  const m = await mount(doc, plan.id);
  const input = m.host.querySelector<HTMLInputElement>(
    'input[aria-label="board.plan.circuitName"]',
  ) as HTMLInputElement;
  m.store.undo.clear();
  for (const value of ['K', 'Ki', 'Kitchen'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  // Nothing written while typing.
  expect(planOf(doc, plan.id).circuits?.map((c) => c.name)).toEqual(['A', 'B']);
  // Someone else renames the other circuit meanwhile.
  const other = planOf(doc, plan.id).circuits?.[1];
  updatePlanCircuits(doc, plan.id, [{ ...(other as NonNullable<typeof other>), name: 'Garden' }]);
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(planOf(doc, plan.id).circuits?.map((c) => c.name)).toEqual(['Kitchen', 'Garden']);
  expect(m.store.undo.undoStack).toHaveLength(1);
  m.store.undo.undo();
  expect(planOf(doc, plan.id).circuits?.map((c) => c.name)).toEqual(['A', 'Garden']);
});

// Snapping (pull request 603, decision 0104) ---------------------------------------

const centreOf = (i: { x: number; y: number }) => ({
  x: (i.x / STROKE_GRID) * PLAN_VIEW_W,
  y: (i.y / STROKE_GRID) * PLAN_VIEW_H,
});

it('places a project-kit light with its modifiers in one undo step, the light selected', async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const m = await mount(doc, plan.id);
  m.store.undo.clear();
  let id: string | null = null;
  await act(async () => {
    id = m.ed.placeIcon(
      'cob',
      { x: 0.5, y: 0.5 },
      {
        fields: { watts: 300 },
        modifiers: ['softbox', 'grid'],
      },
    );
  });
  await m.render();
  const icons = planOf(doc, plan.id).icons ?? [];
  expect(icons.map((i) => [i.kind, i.on])).toEqual([
    ['cob', undefined],
    ['softbox', id],
    ['grid', id],
  ]);
  // Stacked outwards on its front, in order.
  expect(modifiersOn(icons[0] as PlanIcon, icons).map((i) => i.kind)).toEqual(['softbox', 'grid']);
  expect(m.ed.selection).toEqual([{ kind: 'icons', id }]);
  expect(m.store.undo.undoStack).toHaveLength(1);
  m.store.undo.undo();
  expect(planOf(doc, plan.id).icons ?? []).toEqual([]);
});

/** A sofa with a person on it, and a stool. */
async function seated() {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const chair = addPlanIcon(doc, plan.id, { ...at, w: 180, h: 80, kind: 'sofa' }) as string;
  const stool = addPlanIcon(doc, plan.id, { ...at, x: 1000, y: 1000, kind: 'stool' }) as string;
  const m = await mount(doc, plan.id);
  let actor: string | null = null;
  await act(async () => {
    actor = m.ed.placeIcon('actor', { x: 0.1, y: 0.1 }, { on: chair });
  });
  await m.render();
  return { doc, plan, chair, stool, actor: actor as unknown as string, m };
}

it('turns what sits on items turned together, by R or the menu', async () => {
  const { doc, plan, chair, stool, actor, m } = await seated();
  const before = planOf(doc, plan.id).icons?.find((i) => i.id === actor) as PlanIcon;
  await act(async () =>
    m.ed.setSelection([
      { kind: 'icons', id: chair },
      { kind: 'icons', id: stool },
    ]),
  );
  await m.render();
  await act(async () => m.ed.rotate(90));
  const after = planOf(doc, plan.id).icons?.find((i) => i.id === actor) as PlanIcon;
  expect(after.on).toBe(chair);
  expect(after.rotation ?? 0).toBe(((before.rotation ?? 0) + 90) % 360);
  expect(centreOf(after)).not.toEqual(centreOf(before));
});

it('settles what sits on a base resized from Properties', async () => {
  const { doc, plan, chair, actor, m } = await seated();
  const base = planOf(doc, plan.id).icons?.find((i) => i.id === chair) as PlanIcon;
  const before = planOf(doc, plan.id).icons?.find((i) => i.id === actor) as PlanIcon;
  // As the Width field writes it.
  await act(async () => m.ed.write({ ...base, w: (base.w ?? 60) * 2, h: (base.h ?? 60) * 2 }));
  const after = planOf(doc, plan.id).icons?.find((i) => i.id === actor) as PlanIcon;
  expect(after.on).toBe(chair);
  expect([after.x, after.y]).not.toEqual([before.x, before.y]);
});

it('never snaps to an icon on a hidden layer', async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const chair = addPlanIcon(doc, plan.id, { ...at, kind: 'chair' }) as string;
  const m = await mount(doc, plan.id);
  const on = (i: PlanIcon) => centreOf(i);
  const icon = planOf(doc, plan.id).icons?.[0] as PlanIcon;
  expect(m.ed.snapAt({ kind: 'actor' }, on(icon))?.id).toBe(chair);
  await act(async () => m.ed.toggleHidden('set'));
  await m.render();
  expect(m.ed.snapAt({ kind: 'actor' }, on(icon))).toBeNull();
  // A locked layer's icons are still bases.
  await act(async () => m.ed.toggleHidden('set'));
  await act(async () => m.ed.toggleLocked('set'));
  await m.render();
  expect(m.ed.snapAt({ kind: 'actor' }, on(icon))?.id).toBe(chair);
});

it("drops an on whose base is gone at the item's next write", async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const box = addPlanIcon(doc, plan.id, {
    ...at,
    kind: 'softbox',
    on: 'goneAAAAAAAAA',
  }) as string;
  const m = await mount(doc, plan.id);
  const icon = planOf(doc, plan.id).icons?.find((i) => i.id === box) as PlanIcon;
  await act(async () => m.ed.write({ ...icon, label: 'Box' }));
  expect(planOf(doc, plan.id).icons?.find((i) => i.id === box)).toMatchObject({ label: 'Box' });
  expect(planOf(doc, plan.id).icons?.find((i) => i.id === box)?.on).toBeUndefined();
});
