import { contentCounts } from '@inkadra/doc-schema';
import type { Board, BoardCount } from '@inkadra/shared';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';
import {
  forgetSeededCounts,
  mergeSeededCounts,
  releaseLiveCounts,
  setLiveCounts,
  useSeededCounts,
} from '../routes/seed-queue.tsx';
import type { BoardConnection } from './connection.ts';

/**
 * Keeps the navigation's counts of the open board to what its synced doc holds, whichever view
 * shows it: imports, grabbed frames and added or deleted frames count at once, not when the
 * server has stored the board.
 */
export function useLiveBoardCounts(
  conn: BoardConnection | null | undefined,
  boardId: string | undefined,
) {
  const store = conn?.store;
  const synced = conn?.status === 'synced';
  const snap = useSyncExternalStore(
    (onChange) => store?.subscribe(onChange) ?? (() => {}),
    () => store?.getSnapshot(),
  );
  useEffect(() => {
    if (!snap || !synced || !boardId) return;
    setLiveCounts(boardId, contentCounts(snap.byId.values()));
  }, [snap, synced, boardId]);
  useEffect(() => {
    if (boardId) return () => releaseLiveCounts(boardId);
  }, [boardId]);
}

// Bumped when something the counts report changes without a board edit (a client review link).
let revision = 0;
const refreshListeners = new Set<() => void>();
const subscribeRefresh = (onChange: () => void) => {
  refreshListeners.add(onChange);
  return () => {
    refreshListeners.delete(onChange);
  };
};

/** Counts again now: a link was made, changed or revoked, which no board notice announces. */
export function refreshBoardCounts() {
  revision++;
  for (const listener of refreshListeners) listener();
}

/**
 * Counts of the open project's boards, for the navigation and the board cards; refreshed when
 * its boards change.
 */
export function useBoardCounts(
  projectId: string | undefined,
  boards: readonly Board[] | null | undefined,
): Map<string, BoardCount> {
  const [counts, setCounts] = useState<Map<string, BoardCount>>(new Map());
  const refreshed = useSyncExternalStore(subscribeRefresh, () => revision);
  // Any board edit moves its editedAt, so the newest one tells when to count again.
  const stamp = boards
    ?.map((b) => b.editedAt ?? '')
    .sort()
    .at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp is the refresh signal.
  useEffect(() => {
    if (!projectId) {
      setCounts(new Map());
      return;
    }
    let live = true;
    api
      .get<{ items: BoardCount[] }>(`/projects/${projectId}/board-counts`)
      .then((r) => {
        if (!live) return;
        const next = new Map(r.items.map((c) => [c.boardId, c]));
        setCounts(next);
        forgetSeededCounts(next);
      })
      .catch(() => {
        // Counts are a hint; the navigation works without them.
      });
    return () => {
      live = false;
    };
  }, [projectId, stamp, boards?.length, refreshed]);
  // Boards laid out in the background (the Canvas menu) are counted as soon as they are seeded.
  const seeded = useSeededCounts();
  return useMemo(() => mergeSeededCounts(counts, seeded), [counts, seeded]);
}
