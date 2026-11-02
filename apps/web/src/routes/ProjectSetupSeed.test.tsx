// @vitest-environment happy-dom
import { listElements } from '@inkadra/canvas-core';
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
      <ProjectSetupSeed boardId="board" userId="user" done={done} failed={failed} {...props} />,
    ),
  );
it('waits for editable sync and acknowledgement before finishing', async () => {
  conn.status = 'connecting';
  await render();
  expect(listElements(store.doc)).toHaveLength(0);
  conn = { ...conn, status: 'synced' };
  vi.mocked(useBoardConnection).mockReturnValue(conn);
  conn.readOnly = true;
  await render();
  expect(listElements(store.doc)).toHaveLength(0);
  conn = { ...conn, readOnly: false };
  vi.mocked(useBoardConnection).mockReturnValue(conn);
  Object.assign(conn.provider, { hasUnsyncedChanges: true });
  await render();
  expect(listElements(store.doc)).toHaveLength(0);
  await act(async () => vi.advanceTimersByTime(200));
  expect(done).not.toHaveBeenCalled();
  Object.assign(conn.provider, { hasUnsyncedChanges: false });
  await act(async () => vi.advanceTimersByTime(200));
  expect(done).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
});
it('reports connection timeout without claiming success', async () => {
  conn.status = 'denied';
  await render();
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(failed).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});
