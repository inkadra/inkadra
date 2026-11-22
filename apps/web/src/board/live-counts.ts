import { contentCounts } from '@inkadra/doc-schema';
import type { Board, BoardCount } from '@inkadra/shared';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';
import {
  expireReleasedCounts,
  forgetSeededCounts,
  holdsReleasedCounts,
  mergeSeededCounts,
  RELEASED_HOLD_MS,
  releaseLiveCounts,
  setLiveCounts,
  useSeededCounts,
} from '../routes/seed-queue.tsx';
import type { BoardConnection } from './connection.ts';

/** When a closed board is counted again, after it closed. */
const RECOUNT_AFTER_MS = [3000, 15_000, 45_000, 90_000, RELEASED_HOLD_MS];
// The recounts still to come for each closed board; a board opened or closed again replaces them.
const recounts = new Map<string, ReturnType<typeof setTimeout>[]>();
const cancelRecounts = (boardId: string) => {
  for (const timer of recounts.get(boardId) ?? []) clearTimeout(timer);
  recounts.delete(boardId);
};

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
    if (!boardId) return;
    cancelRecounts(boardId);
    return () => {
      releaseLiveCounts(boardId);
      // Counted again until the server's counts match the local ones, which hold until then
      // (forgetSeededCounts): once it has likely stored the last edits, once it should have,
      // then while a failed store is retried, and a last time when the local ones expire,
      // whether or not a response still has the board (its project may be left).
      cancelRecounts(boardId);
      recounts.set(
        boardId,
        RECOUNT_AFTER_MS.map((ms, i) =>
          setTimeout(() => {
            if (!holdsReleasedCounts(boardId)) return;
            if (i === RECOUNT_AFTER_MS.length - 1) {
              recounts.delete(boardId);
              expireReleasedCounts(boardId);
            }
            refreshBoardCounts();
          }, ms),
        ),
      );
    };
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

// The newest counts from the server, by project, shared by every view: what one view learns
// (the server caught up with a closed board) shows in the others at once.
const serverCounts = new Map<string, { askedAt: number; counts: Map<string, BoardCount> }>();
const serverListeners = new Set<() => void>();
const subscribeServer = (onChange: () => void) => {
  serverListeners.add(onChange);
  return () => {
    serverListeners.delete(onChange);
  };
};
const noCounts = new Map<string, BoardCount>();

/**
 * Counts of the open project's boards, for the navigation and the board cards; refreshed when
 * its boards change.
 */
export function useBoardCounts(
  projectId: string | undefined,
  boards: readonly Board[] | null | undefined,
): Map<string, BoardCount> {
  const counts = useSyncExternalStore(
    subscribeServer,
    () => (projectId && serverCounts.get(projectId)?.counts) || noCounts,
  );
  const refreshed = useSyncExternalStore(subscribeRefresh, () => revision);
  // Any board edit moves its editedAt, so the newest one tells when to count again.
  const stamp = boards
    ?.map((b) => b.editedAt ?? '')
    .sort()
    .at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp is the refresh signal.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const askedAt = Date.now();
    api
      .get<{ items: BoardCount[] }>(`/projects/${projectId}/board-counts`)
      .then((r) => {
        if (!live) return;
        // An answer to an older question, overtaken by another view's, says nothing new.
        if ((serverCounts.get(projectId)?.askedAt ?? -1) > askedAt) return;
        const next = new Map(r.items.map((c) => [c.boardId, c]));
        serverCounts.set(projectId, { askedAt, counts: next });
        for (const listener of serverListeners) listener();
        forgetSeededCounts(next, askedAt);
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
