import {
  type Board,
  type BoardDetail,
  type BoardKind,
  type BoardOptionalView,
  comparePosition,
  type UpdateBoard,
} from '@inkadra/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';

/**
 * Board metadata from the REST API, cached per project. The sidebar tree, the breadcrumb and
 * the board cards on the canvas read the same list, so a rename shows up everywhere.
 */
interface ProjectBoards {
  items: Board[] | null;
  error: boolean;
}

const cache = new Map<string, ProjectBoards>();
const listeners = new Set<() => void>();
const loading = new Set<string>();
/** When each project's list last arrived. */
const fetched = new Map<string, number>();
/** How old a list may get while the tab is in view (#824). */
export const BOARDS_STALE_MS = 60_000;
const EMPTY: ProjectBoards = { items: null, error: false };

function emit() {
  for (const l of listeners) l();
}

export const boardPath = (projectId: string, boardId: string, rootBoardId?: string) =>
  boardId === rootBoardId ? `/p/${projectId}` : `/p/${projectId}/b/${boardId}`;

export async function refreshBoards(projectId: string): Promise<void> {
  if (loading.has(projectId)) return;
  loading.add(projectId);
  try {
    const page = await api.get<{ items: Board[] }>(`/projects/${projectId}/boards`);
    cache.set(projectId, { items: page.items, error: false });
    fetched.set(projectId, Date.now());
  } catch {
    cache.set(projectId, { items: cache.get(projectId)?.items ?? null, error: true });
  } finally {
    loading.delete(projectId);
    emit();
  }
}

/** The project's boards from the server, which also fills the cache the sidebar reads. */
export async function loadBoards(projectId: string): Promise<Board[] | null> {
  await refreshBoards(projectId);
  const cached = cache.get(projectId);
  return cached && !cached.error ? cached.items : null;
}

export function useProjectBoards(projectId: string | undefined): ProjectBoards {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (projectId ? (cache.get(projectId) ?? EMPTY) : EMPTY),
  );
  useEffect(() => {
    if (!projectId) return;
    if (!cache.has(projectId)) void refreshBoards(projectId);
    // Colleagues add, rename, move and delete boards too: a list in view is read again once it
    // is a minute old, and when the tab comes back (#824). One request serves every reader.
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - (fetched.get(projectId) ?? 0) >= BOARDS_STALE_MS) void refreshBoards(projectId);
    };
    const timer = setInterval(revalidate, BOARDS_STALE_MS);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [projectId]);
  return value;
}

export async function createBoard(
  projectId: string,
  parentBoardId: string,
  title: string,
  kind: BoardKind = 'board',
): Promise<Board> {
  const board = await api.post<Board>(`/projects/${projectId}/boards`, {
    parentBoardId,
    title,
    kind,
  });
  const current = cache.get(projectId)?.items ?? [];
  cache.set(projectId, { items: [...current, board], error: false });
  emit();
  return board;
}

export function canRenameBoard(board: Pick<Board, 'myRole'> | undefined): boolean {
  return board?.myRole === 'owner' || board?.myRole === 'editor';
}

export async function renameBoard(projectId: string, boardId: string, title: string) {
  const board = await api.patch<Board>(`/boards/${boardId}`, { title });
  const current = cache.get(projectId)?.items ?? [];
  cache.set(projectId, {
    items: current.map((b) => (b.id === boardId ? board : b)),
    error: false,
  });
  emit();
  return board;
}

/** The image the home and project cards show for this board; null returns to the first image. */
export function setBoardCover(projectId: string, boardId: string, assetId: string | null) {
  return updateBoard(projectId, boardId, { coverAssetId: assetId });
}

/** The symbol or emoji and colour of a board's cards; null returns to the default icon. */
export function setBoardIcon(projectId: string, boardId: string, icon: Board['icon']) {
  return updateBoard(projectId, boardId, { icon: icon ?? null });
}

/** The optional views that are on (decision 0121); editors only. */
export function setBoardViews(projectId: string, boardId: string, views: BoardOptionalView[]) {
  return updateBoard(projectId, boardId, { views });
}

async function updateBoard(projectId: string, boardId: string, patch: UpdateBoard) {
  const board = await api.patch<Board>(`/boards/${boardId}`, patch);
  const current = cache.get(projectId)?.items ?? [];
  cache.set(projectId, {
    items: current.map((b) => (b.id === boardId ? board : b)),
    error: false,
  });
  emit();
  return board;
}

/** Synchronize root board title when project is renamed. */
export function syncRootBoardTitle(projectId: string, title: string): void {
  const current = cache.get(projectId)?.items;
  if (!current) return;
  cache.set(projectId, {
    items: current.map((b) => (b.parentBoardId === null ? { ...b, title } : b)),
    error: false,
  });
  emit();
}

export function fetchBoard(boardId: string): Promise<BoardDetail> {
  return api.get<BoardDetail>(`/boards/${boardId}`);
}

/** Children of a board, in their saved order. */
export function childBoards(items: Board[] | null, parentId: string): Board[] {
  return (items ?? []).filter((b) => b.parentBoardId === parentId).sort(comparePosition);
}

/** The project's Production board among its boards, when the person can see it (decision 0123). */
export function productionOf(items: readonly Board[] | null | undefined): Board | undefined {
  return items?.find((b) => b.kind === 'production');
}

/** The loaded boards of the project that holds `boardId`; null while it is not loaded. */
export function boardsWith(boardId: string): Board[] | null {
  for (const { items } of cache.values()) if (items?.some((b) => b.id === boardId)) return items;
  return null;
}

/** `boardsWith`, followed as the lists load and change. */
export function useBoardsWith(boardId: string | undefined): Board[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (boardId ? boardsWith(boardId) : null),
  );
}

/** The boards in the order of the sidebar's tree: each after its parent, siblings by position. */
export function treeOrder(items: readonly Board[]): Board[] {
  const ids = new Set(items.map((b) => b.id));
  const out: Board[] = [];
  const walk = (parentId: string | null) => {
    for (const b of items
      .filter(
        (x) =>
          x.parentBoardId === parentId || (parentId === null && !ids.has(x.parentBoardId ?? '')),
      )
      .sort(comparePosition)) {
      if (out.includes(b)) continue;
      out.push(b);
      walk(b.id);
    }
  };
  walk(null);
  return out;
}

/** Top boards of the subtrees shared with you in projects you are not a member of. */
export function useSharedBoards(enabled: boolean): Board[] | null {
  const [items, setItems] = useState<Board[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .get<{ items: Board[] }>('/shared-boards')
      .then((page) => alive && setItems(page.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return items;
}
