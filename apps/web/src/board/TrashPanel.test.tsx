// SPDX-License-Identifier: AGPL-3.0-only
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
import { TrashPanel, type TrashScan } from './TrashPanel.tsx';

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
  const bytes = vi.spyOn(api, 'bytes').mockResolvedValue(update);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<TrashPanel boardId={boardId} store={store} editable={false} />),
    );
    expect(get).toHaveBeenCalledWith(
      `/boards/${boardId}/versions?cursor=page2`,
      expect.any(AbortSignal),
    );
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
    // The snapshot is fetched again rather than kept per item.
    expect(bytes).toHaveBeenCalledTimes(2);
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

it('reuses a completed scan for the dialog session, and reload rescans and clears the notice', async () => {
  await i18n.changeLanguage('en');
  const doc = createBoardDoc(boardId);
  const store = new BoardStore(doc);
  const alive = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const note = createElement(doc, 'note', { x: 10, y: 20 }, {}, { userId: null });
  const update = Y.encodeStateAsUpdate(doc);
  roots(doc).elements.delete(note.id);
  const page = { items: [{ id: 'saved', createdAt: new Date().toISOString() }], nextCursor: null };
  const get = vi.spyOn(api, 'get').mockResolvedValue(page);
  const bytes = vi.spyOn(api, 'bytes').mockResolvedValue(update);
  const cache = { current: null as TrashScan | null };
  const host = document.createElement('div');
  const render = (root: ReturnType<typeof createRoot>) =>
    act(async () =>
      root.render(<TrashPanel boardId={boardId} store={store} editable cache={cache} />),
    );
  const first = createRoot(host);
  await render(first);
  expect(cache.current?.items.map((item) => item.element.id)).toEqual([note.id]);
  expect(cache.current?.items.some((item) => item.element.id === alive.id)).toBe(false);
  await act(async () => first.unmount());
  const second = createRoot(host);
  try {
    await render(second);
    expect(get).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('li')).toHaveLength(1);
    const button = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)!;
    await act(async () => button('Restore').click());
    expect(host.textContent).toContain('Element restored');
    await act(async () => store.undo.undo());
    await act(async () => button('Reload list').click());
    expect(get).toHaveBeenCalledTimes(2);
    expect(bytes).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain('Element restored');
    expect(host.querySelectorAll('li')).toHaveLength(1);
  } finally {
    await act(async () => second.unmount());
    store.destroy();
    doc.destroy();
  }
});

it('aborts in-flight requests on unmount', async () => {
  await i18n.changeLanguage('en');
  const doc = createBoardDoc(boardId);
  const store = new BoardStore(doc);
  let signal: AbortSignal | undefined;
  vi.spyOn(api, 'get').mockImplementation((_path, s) => {
    signal = s;
    return new Promise(() => {});
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TrashPanel boardId={boardId} store={store} editable />));
    expect(signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
  } finally {
    store.destroy();
    doc.destroy();
  }
});
