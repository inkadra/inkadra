// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Card } from './cards.tsx';
import { BoardContext, type BoardContextValue } from './context.ts';
import { BoardStore } from './store.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({
  api: {
    get: async () => ({
      items: [
        {
          role: 'editor',
          user: { id: '00000000-0000-4000-8000-000000000001', name: 'Matteo', image: null },
        },
      ],
    }),
  },
}));

it('turns the new item into an item and opens its people list on @', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const doc = createBoardDoc('boardAAAAAAAA');
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const store = new BoardStore(doc);
  const context = {
    store,
    readOnly: false,
    projectId: 'project',
    editing: todo.id,
    setEditing: vi.fn(),
    scale: 1,
  } as unknown as BoardContextValue;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    act(async () =>
      root.render(
        <BoardContext.Provider value={context}>
          <Card element={readElement(roots(doc).elements.get(todo.id)!) as Element} selected />
        </BoardContext.Provider>,
      ),
    );
  await render();
  const add = host.querySelector<HTMLInputElement>('.card__todo-add')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      add,
      'Comprare pellicola ',
    );
    add.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    add.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true, cancelable: true }));
  });
  await render();
  const card = readElement(roots(doc).elements.get(todo.id)!) as Extract<Element, { type: 'todo' }>;
  expect(card.items.map((item) => item.text)).toEqual(['Comprare pellicola']);
  expect(add.value).toBe('');
  const option = await vi.waitFor(() => {
    const found = host.querySelector<HTMLElement>('[role=option]');
    if (!found) throw new Error('no people list');
    return found;
  });
  expect(option.textContent).toContain('Matteo');
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    option.click();
  });
  const assigned = readElement(roots(doc).elements.get(todo.id)!) as Extract<
    Element,
    { type: 'todo' }
  >;
  expect(assigned.items[0]?.assigneeId).toBe('00000000-0000-4000-8000-000000000001');
  await act(async () => root.unmount());
  host.remove();
  store.destroy();
  doc.destroy();
  vi.unstubAllGlobals();
});
