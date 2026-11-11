// @vitest-environment happy-dom
import { addPlanIcon, createElement, listElements, type PlanElement } from '@inkadra/canvas-core';
import { createBoardDoc, type PlanIcon } from '@inkadra/doc-schema';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardStore } from '../store.ts';
import { type Ed, usePlanEditing } from './editing.ts';
import { CharacterLink, LinkPicker, type PickerAt, SunSection } from './PlanLinks.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function render(node: () => React.ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const draw = () => act(async () => root.render(node()));
  await draw();
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return { host, draw };
}

function Editor({
  doc,
  store,
  planId,
  part,
}: {
  doc: Y.Doc;
  store: BoardStore;
  planId: string;
  part: (ed: Ed) => React.ReactNode;
}) {
  const ed = usePlanEditing({
    store,
    plan: planOf(doc, planId),
    phone: false,
    scenes: [],
    cards: store.getSnapshot().byId,
    onOpenScene: () => {},
    onClose: () => {},
  });
  return <>{part(ed)}</>;
}

async function editor(doc: Y.Doc, planId: string, part: (ed: Ed) => React.ReactNode) {
  const store = new BoardStore(doc);
  cleanups.push(async () => store.destroy());
  const view = await render(() => <Editor doc={doc} store={store} planId={planId} part={part} />);
  return { store, ...view };
}

const click = (el: Element | null | undefined) =>
  act(async () => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));

it('links an actor by the id alone: no copy of the name in its label', async () => {
  const doc = createBoardDoc(boardId);
  const leo = createElement(doc, 'character', { x: 0, y: 0 }, { name: 'Leo' }, { userId: null });
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const id = addPlanIcon(doc, plan.id, { kind: 'actor', color: '#9DB8F2', x: 9, y: 9 }) as string;
  const icon = () => planOf(doc, plan.id).icons?.find((i) => i.id === id) as PlanIcon;
  const m = await editor(doc, plan.id, (ed) => <CharacterLink ed={ed} icon={icon()} />);
  await click(m.host.querySelector('button'));
  const option = [...document.querySelectorAll('.plan-scenes__item')].find((b) =>
    b.textContent?.includes('Leo'),
  );
  await click(option);
  expect(icon().characterId).toBe(leo.id);
  expect(icon().label).toBeUndefined();
});

it('makes one drag of the sun’s time one undo step', async () => {
  const doc = createBoardDoc(boardId);
  const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  addPlanIcon(doc, plan.id, { kind: 'sun', color: '#EDD963', x: 9, y: 9 });
  const m = await editor(doc, plan.id, (ed) => <SunSection ed={ed} />);
  const slider = m.host.querySelector<HTMLInputElement>('input[type="range"]') as HTMLInputElement;
  m.store.undo.clear();
  await act(async () => slider.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  for (const value of ['1080', '1095', '1110', '1125'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        slider,
        value,
      );
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));
  expect(planOf(doc, plan.id).sun?.time).toBe(1125);
  expect(m.store.undo.undoStack).toHaveLength(1);
  m.store.undo.undo();
  expect(planOf(doc, plan.id).sun).toBeUndefined();
});

/** A button that opens a picker, as the link cards do. */
function PickerHarness({ out }: { out: { opener: HTMLButtonElement | null } }) {
  const [at, setAt] = useState<PickerAt | null>(null);
  return (
    <>
      <button
        type="button"
        ref={(el) => {
          out.opener = el;
        }}
        onClick={(e) => setAt({ style: {}, opener: e.currentTarget })}
      >
        open
      </button>
      {at && (
        <LinkPicker
          title="Pick"
          search="Search"
          options={[{ id: 'a', label: 'A' }]}
          at={at}
          onPick={() => setAt(null)}
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}

it('gives the focus back to its button when the list closes with Escape', async () => {
  const out: { opener: HTMLButtonElement | null } = { opener: null };
  await render(() => <PickerHarness out={out} />);
  await click(out.opener);
  expect(document.activeElement?.getAttribute('type')).toBe('search');
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('.plan-scenes')).toBeNull();
  expect(document.activeElement).toBe(out.opener);
});
