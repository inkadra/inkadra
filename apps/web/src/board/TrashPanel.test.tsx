// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import i18n from '../i18n/index.ts';
import { api } from '../lib/api.ts';
import { BoardStore } from './store.ts';
import { TrashPanel } from './TrashPanel.tsx';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
afterEach(() => vi.restoreAllMocks());

it('reads all history pages, lets viewers inspect, and restores only when editable', async () => {
  await i18n.changeLanguage('en');
  const doc = createBoardDoc(boardId);
  const store = new BoardStore(doc);
  const note = createElement(doc, 'note', { x: 10, y: 20 }, {}, { userId: null });
  const update = Y.encodeStateAsUpdate(doc);
  roots(doc).elements.delete(note.id);
  const now = new Date().toISOString();
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ items: [], nextCursor: 'page2' })
    .mockResolvedValueOnce({ items: [{ id: 'saved', createdAt: now }], nextCursor: null });
  vi.spyOn(api, 'bytes').mockResolvedValue(update);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<TrashPanel boardId={boardId} store={store} editable={false} />),
    );
    expect(get).toHaveBeenCalledWith(`/boards/${boardId}/versions?cursor=page2`);
    expect(host.textContent).toContain('Last saved:');
    const restore = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore',
    )!;
    expect(restore.disabled).toBe(true);
    await act(async () =>
      root.render(<TrashPanel boardId={boardId} store={store} editable={true} />),
    );
    expect(restore.disabled).toBe(false);
    await act(async () => restore.click());
    expect(store.getSnapshot().byId.has(note.id)).toBe(true);
    expect(host.querySelectorAll('li')).toHaveLength(0);
    await act(async () => store.undo.undo());
    expect(host.querySelectorAll('li')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});

it('reports failed reads and ignores a snapshot response after unmount', async () => {
  await i18n.changeLanguage('en');
  const doc = createBoardDoc(boardId);
  const store = new BoardStore(doc);
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
  const bytes = vi.spyOn(api, 'bytes');
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<TrashPanel boardId={boardId} store={store} editable />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('partial');
  await act(async () => root.unmount());
  let resolve: (value: unknown) => void = () => {};
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const second = createRoot(host);
  try {
    await act(async () => second.render(<TrashPanel boardId={boardId} store={store} editable />));
    await act(async () => second.unmount());
    await act(async () =>
      resolve({ items: [{ id: 'late', createdAt: new Date().toISOString() }], nextCursor: null }),
    );
    expect(bytes).not.toHaveBeenCalled();
  } finally {
    store.destroy();
    doc.destroy();
  }
});
