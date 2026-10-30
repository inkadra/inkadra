// SPDX-License-Identifier: MPL-2.0
import { CLIP_BOARD_HISTORY_LIMIT } from '@inkadra/shared/constants';
import { InkadraApi } from './api.ts';
import { CAN_EDIT } from './boards.ts';
import { ClipperError } from './errors.ts';

/** The server the clipper is connected to, kept in chrome.storage.local (never synced). */
export interface Connection {
  serverUrl: string;
  /** Null once the server answered 401: the address stays so reconnecting is one click. */
  token: string | null;
  tokenId: string | null;
  user: { name: string; email: string };
  /** Instance.limits.uploadMaxBytes at connect time; 0 means no limit. */
  uploadMaxBytes: number;
}

export interface BoardRef {
  id: string;
  projectId: string;
  title: string;
  projectName: string | null;
}

/** Keeps only the fields worth storing, whatever object the board came from. */
export function toBoardRef(board: BoardRef): BoardRef {
  return {
    id: board.id,
    projectId: board.projectId,
    title: board.title,
    projectName: board.projectName,
  };
}

interface Stored {
  connection?: Connection;
  lastBoard?: BoardRef;
  recentBoards?: BoardRef[];
}

let cacheRevision = 0;

async function read<K extends keyof Stored>(key: K): Promise<Stored[K]> {
  const items = (await chrome.storage.local.get(key)) as Stored;
  return items[key];
}

export async function getConnection(): Promise<Connection | null> {
  return (await read('connection')) ?? null;
}

export async function setConnection(connection: Connection): Promise<void> {
  cacheRevision++;
  await chrome.storage.local.set({ connection });
}

/** Forgets the server and the boards picked on it. */
export async function clearConnection(): Promise<void> {
  cacheRevision++;
  await chrome.storage.local.remove(['connection', 'lastBoard', 'recentBoards']);
}

export async function markRevoked(): Promise<void> {
  const connection = await getConnection();
  if (connection?.token) await setConnection({ ...connection, token: null, tokenId: null });
}

export async function getLastBoard(): Promise<BoardRef | null> {
  return (await getRecentBoards())[0] ?? null;
}

export async function getRecentBoards(): Promise<BoardRef[]> {
  return (await read('recentBoards')) ?? [];
}

/** The board becomes the default for the menus and the shortcut, and moves to the top. */
export async function rememberBoard(board: BoardRef): Promise<void> {
  board = toBoardRef(board);
  cacheRevision++;
  const recent = await getRecentBoards();
  const recentBoards = [board, ...recent.filter((b) => b.id !== board.id)].slice(
    0,
    CLIP_BOARD_HISTORY_LIMIT,
  );
  await chrome.storage.local.set({ recentBoards });
}

/** Refresh only on user events: no timers that depend on a persistent MV3 worker. */
export async function refreshClipBoards(): Promise<BoardRef[]> {
  const connection = await getConnection();
  if (!connection?.token) return getRecentBoards();
  const revision = cacheRevision;
  try {
    const api = new InkadraApi({ baseUrl: connection.serverUrl, token: connection.token });
    const items = await api.clipBoards();
    const current = await getConnection();
    if (
      revision !== cacheRevision ||
      current?.token !== connection.token ||
      current.serverUrl !== connection.serverUrl
    )
      return getRecentBoards();
    // A board the user can no longer edit must not stay the default destination.
    const recentBoards = items.filter((b) => CAN_EDIT.has(b.myRole)).map(toBoardRef);
    await chrome.storage.local.set({ recentBoards });
    await chrome.storage.local.remove('lastBoard');
    return recentBoards;
  } catch (err) {
    const current = await getConnection();
    if (
      err instanceof ClipperError &&
      err.kind === 'unauthorized' &&
      current?.token === connection.token &&
      current.serverUrl === connection.serverUrl
    )
      await markRevoked();
    // Offline and older servers keep the browser cache. An empty successful list replaces it.
    return getRecentBoards();
  }
}

export async function forgetBoard(boardId: string): Promise<void> {
  cacheRevision++;
  const recent = await getRecentBoards();
  await chrome.storage.local.set({ recentBoards: recent.filter((b) => b.id !== boardId) });
  await chrome.storage.local.remove('lastBoard');
  const connection = await getConnection();
  if (!connection?.token) return;
  const api = new InkadraApi({ baseUrl: connection.serverUrl, token: connection.token });
  try {
    await api.forgetClipBoard(boardId);
  } catch (err) {
    // Older servers have no history endpoint; keep their existing local-only behaviour.
    if (err instanceof ClipperError && [404, 405, 501].includes(err.status ?? 0)) return;
    throw err;
  }
}
