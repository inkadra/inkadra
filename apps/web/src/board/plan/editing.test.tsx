// @vitest-environment happy-dom
import {
  addPlanCircuit,
  addPlanIcon,
  addVariant,
  createElement,
  listElements,
  type PlanElement,
  updatePlanCircuits,
  variantView,
} from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
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
  expect(
    variantView(planOf(doc, setup), planOf(doc, base.id)).icons?.map((i) => i.id),
  ).toEqual([table]);
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
