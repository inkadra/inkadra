// @vitest-environment happy-dom
import { listElements } from '@inkadra/canvas-core';
import type { Board } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type BoardConnection, useBoardConnection } from '../board/connection.ts';
import { BoardStore } from '../board/store.ts';
import { ProjectSetupSeed } from './ProjectSetupSeed.tsx';

vi.mock('../board/connection.ts', () => ({ useBoardConnection: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let store: BoardStore;
let conn: BoardConnection;
const done = vi.fn();
const failed = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  store = new BoardStore(new Y.Doc());
  conn = {
    store,
    status: 'synced',
    readOnly: false,
    provider: { hasUnsyncedChanges: false },
    accessChangedAt: null,
  } as BoardConnection;
  vi.mocked(useBoardConnection).mockReturnValue(conn);
});
afterEach(() => {
  act(() => root.unmount());
  store.destroy();
  store.doc.destroy();
  host.remove();
  vi.useRealTimers();
});
const render = (props = {}) =>
  act(async () =>
    root.render(
      <ProjectSetupSeed
        boardId="board"
        seed="storyboard"
        userId="user"
        done={done}
        failed={failed}
        {...props}
      />,
    ),
  );
it('waits for editable sync and acknowledgement before finishing', async () => {
  conn.status = 'connecting';
  await render();
  expect(listElements(store.doc)).toHaveLength(0);
  conn.status = 'synced';
  conn.readOnly = true;
  await render();
  expect(listElements(store.doc)).toHaveLength(0);
  conn.readOnly = false;
  Object.assign(conn.provider, { hasUnsyncedChanges: true });
  await render();
  expect(listElements(store.doc)).toHaveLength(4);
  await act(async () => vi.advanceTimersByTime(200));
  expect(done).not.toHaveBeenCalled();
  Object.assign(conn.provider, { hasUnsyncedChanges: false });
  await act(async () => vi.advanceTimersByTime(200));
  expect(done).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
});
it('links child boards once and never overwrites initialized content on retry', async () => {
  const links = [{ board: { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10' } as Board }];
  await render({ seed: undefined, links });
  expect(listElements(store.doc)).toMatchObject([
    { type: 'board', boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10' },
  ]);
  await act(async () => root.render(null));
  await render({ seed: undefined, links });
  expect(listElements(store.doc)).toHaveLength(1);
});
it('reports connection timeout without claiming success', async () => {
  conn.status = 'denied';
  await render();
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(failed).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});
