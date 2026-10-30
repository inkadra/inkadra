import { useEffect, useSyncExternalStore } from 'react';
import { releaseLiveCounts, setLiveCounts } from '../routes/seed-queue.tsx';
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
    const counts = { elementCount: 0, frameCount: 0, framesToShoot: 0 };
    for (const el of snap.byId.values()) {
      counts.elementCount++;
      if (el.type !== 'frame') continue;
      counts.frameCount++;
      if (el.status !== 'shot') counts.framesToShoot++;
    }
    setLiveCounts(boardId, counts);
  }, [snap, synced, boardId]);
  useEffect(() => {
    if (boardId) return () => releaseLiveCounts(boardId);
  }, [boardId]);
}
