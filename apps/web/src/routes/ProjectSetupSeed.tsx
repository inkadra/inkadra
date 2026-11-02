import { listElements } from '@inkadra/canvas-core';
import { contentCounts } from '@inkadra/doc-schema';
import { useEffect, useRef } from 'react';
import { useBoardConnection } from '../board/connection.ts';
import { applyImport, type ImportPlan } from '../board/film/screenplay/plan.ts';
import { LOCAL } from '../board/store.ts';
import type { SeededCounts } from './seed-queue.tsx';

/** One connection at a time. Wait for the server to acknowledge edits before disconnecting. */
export function ProjectSetupSeed({
  boardId,
  screenplay,
  userId,
  done,
  failed,
}: {
  boardId: string;
  /** Scenes and frames of an imported screenplay. */
  screenplay?: ImportPlan | undefined;
  userId: string;
  /** Called with the board's counts once the server has the edits. */
  done: (counts: SeededCounts) => void;
  failed: () => void;
}) {
  const conn = useBoardConnection(boardId);
  const applied = useRef(false);
  const finished = useRef(false);
  useEffect(() => {
    if (conn?.status !== 'synced' || conn.readOnly || applied.current) return;
    applied.current = true;
    // Never overwrite existing work.
    if (screenplay) {
      if (listElements(conn.store.doc).length === 0)
        applyImport(conn.store.doc, screenplay, { userId, origin: LOCAL });
    }
  }, [conn, screenplay, userId]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        applied.current &&
        conn?.status === 'synced' &&
        !conn.provider.hasUnsyncedChanges &&
        !finished.current
      ) {
        finished.current = true;
        done(contentCounts(listElements(conn.store.doc)));
      }
    }, 100);
    const timeout = setTimeout(() => {
      if (!finished.current) {
        finished.current = true;
        failed();
      }
    }, 15_000);
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [conn, done, failed]);
  return null;
}
