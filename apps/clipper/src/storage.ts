// SPDX-License-Identifier: MPL-2.0

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

const MAX_RECENT = 8;

async function read<K extends keyof Stored>(key: K): Promise<Stored[K]> {
  const items = (await chrome.storage.local.get(key)) as Stored;
  return items[key];
}

export async function getConnection(): Promise<Connection | null> {
  return (await read('connection')) ?? null;
}

export async function setConnection(connection: Connection): Promise<void> {
  await chrome.storage.local.set({ connection });
}

/** Forgets the server and the boards picked on it. */
export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove(['connection', 'lastBoard', 'recentBoards']);
}

export async function markRevoked(): Promise<void> {
  const connection = await getConnection();
  if (connection?.token) await setConnection({ ...connection, token: null, tokenId: null });
}

export async function getLastBoard(): Promise<BoardRef | null> {
  return (await read('lastBoard')) ?? null;
}

export async function getRecentBoards(): Promise<BoardRef[]> {
  return (await read('recentBoards')) ?? [];
}

/** The board becomes the default for the menus and the shortcut, and moves to the top. */
export async function rememberBoard(board: BoardRef): Promise<void> {
  board = toBoardRef(board);
  const recent = await getRecentBoards();
  const recentBoards = [board, ...recent.filter((b) => b.id !== board.id)].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ lastBoard: board, recentBoards });
}

export async function forgetBoard(boardId: string): Promise<void> {
  const [last, recent] = await Promise.all([getLastBoard(), getRecentBoards()]);
  await chrome.storage.local.set({ recentBoards: recent.filter((b) => b.id !== boardId) });
  if (last?.id === boardId) await chrome.storage.local.remove('lastBoard');
}
