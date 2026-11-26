// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import type { Editor } from '@tiptap/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Card } from './cards.tsx';
import { BoardContext, type BoardContextValue } from './context.ts';
import { setReviews } from './review-store.ts';
import { BoardStore } from './store.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// happy-dom has neither the popover API nor text layout: the list's place is not tested here.
const anchorLayer = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('@inkadra/ui', async (original) => ({
  ...(await original<typeof import('@inkadra/ui')>()),
  anchorLayer,
}));

it('lists people on @ in a note edited on the board, and Enter writes a real mention', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const giulia = { id: '00000000-0000-4000-8000-000000000002', name: 'Giulia', image: null };
  setReviews({
    people: [giulia, { id: '00000000-0000-4000-8000-000000000003', name: 'Marco', image: null }],
  });
  const doc = createBoardDoc('boardAAAAAAAA');
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const store = new BoardStore(doc);
  let editor: Editor | null = null;
  const context = {
    store,
    readOnly: false,
    editing: note.id,
    setEditing: vi.fn(),
    setNoteEditor: (next: Editor | null) => {
      editor = next;
    },
    scale: 1,
  } as unknown as BoardContextValue;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <BoardContext.Provider value={context}>
        <Card element={readElement(roots(doc).elements.get(note.id)!) as Element} selected />
      </BoardContext.Provider>,
    ),
  );
  const ready = await vi.waitFor(() => {
    if (!editor) throw new Error('no editor');
    return editor as Editor;
  });
  await act(async () => {
    ready.commands.focus();
    ready.commands.insertContent('Ask @Giu');
  });
  const list = await vi.waitFor(() => {
    const found = host.querySelector<HTMLElement>('[role=listbox]');
    if (!found) throw new Error('no people list');
    return found;
  });
  expect(list.getAttribute('popover')).toBe('manual');
  expect([...list.querySelectorAll('[role=option]')].map((o) => o.textContent)).toEqual(['Giulia']);
  expect(anchorLayer).toHaveBeenCalledWith(list, expect.anything(), expect.any(Function));

  await act(async () => {
    ready.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  // The same node the phone writes: the person's id, so it stays theirs when renamed.
  const body = store.map(note.id)?.get('body') as Y.XmlFragment;
  const mention = (body.toArray()[0] as Y.XmlElement)
    .toArray()
    .find((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === 'mention');
  expect(mention?.getAttribute('id')).toBe(giulia.id);
  expect(mention?.getAttribute('label')).toBe('Giulia');
  expect(ready.getText()).toBe('Ask @Giulia ');
  expect(host.querySelector('[role=listbox]')).toBeNull();

  // Escape closes the list and leaves the editor; the same `@` typed again opens it again.
  const key = (k: string) =>
    act(async () => {
      ready.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    });
  await act(async () => ready.commands.insertContent('@M'));
  expect(host.querySelector('[role=listbox]')?.textContent).toBe('Marco');
  await key('Escape');
  expect(host.querySelector('[role=listbox]')).toBeNull();
  expect(context.setEditing).not.toHaveBeenCalled();
  await act(async () => {
    ready.commands.deleteRange({
      from: ready.state.selection.from - 2,
      to: ready.state.selection.from,
    });
  });
  await act(async () => ready.commands.insertContent('@M'));
  expect(host.querySelector('[role=listbox]')?.textContent).toBe('Marco');
  act(() => root.unmount());
  host.remove();
  store.destroy();
});
