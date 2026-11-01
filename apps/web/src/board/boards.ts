import type { Board, BoardDetail, BoardKind, UpdateBoard } from '@inkadra/shared';
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
    if (projectId && !cache.has(projectId)) void refreshBoards(projectId);
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
  return (items ?? [])
    .filter((b) => b.parentBoardId === parentId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/**
 * Whether the sidebar lists any board under `parentId`: the storyboard (`hiddenId`) is listed as
 * a module, so only its sub-boards count. Mirrors the sidebar tree, to the same depth.
 */
export function hasListedBoards(
  items: Board[] | null,
  parentId: string,
  hiddenId: string | null,
  depth = 1,
): boolean {
  if (depth > 4) return false;
  return childBoards(items, parentId).some((b) =>
    b.id === hiddenId
      ? hasListedBoards(items, b.id, hiddenId, depth)
      : true,
  );
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
