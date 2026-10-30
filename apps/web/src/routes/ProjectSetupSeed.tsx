import { createElement, listElements } from '@inkadra/canvas-core';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoardConnection } from '../board/connection.ts';
import { LOCAL } from '../board/store.ts';
import { seedStoryboard, seedTemplate, templateLabels } from '../board/templates.ts';
import type { CreatedSetupBoard } from './project-setup.ts';
import type { SeededCounts } from './seed-queue.tsx';

/** One connection at a time. Wait for the server to acknowledge edits before disconnecting. */
export function ProjectSetupSeed({
  boardId,
  seed,
  links,
  userId,
  done,
  failed,
}: {
  boardId: string;
  seed?: CreatedSetupBoard['seed'];
  links?: CreatedSetupBoard[];
  userId: string;
  /** Called with the board's counts once the server has the edits. */
  done: (counts: SeededCounts) => void;
  failed: () => void;
}) {
  const conn = useBoardConnection(boardId);
  const { t } = useTranslation();
  const applied = useRef(false);
  const finished = useRef(false);
  useEffect(() => {
    if (conn?.status !== 'synced' || conn.readOnly || applied.current) return;
    applied.current = true;
    if (seed === 'storyboard')
      seedStoryboard(conn.store.doc, t('templates.storyboard.scene'), userId);
    else if (seed) seedTemplate(conn.store.doc, seed, templateLabels(t), userId);
    if (links) {
      conn.store.doc.transact(() => {
        const existing = new Set(
          listElements(conn.store.doc)
            .filter((el) => el.type === 'board')
            .map((el) => el.boardId),
        );
        links.forEach(({ board }, i) => {
          if (!existing.has(board.id))
            createElement(
              conn.store.doc,
              'board',
              { x: 80 + (i % 3) * 320, y: 80 + Math.floor(i / 3) * 240 },
              { boardId: board.id },
              { userId, origin: LOCAL },
            );
        });
      }, LOCAL);
    }
  }, [conn, seed, links, userId, t]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        applied.current &&
        conn?.status === 'synced' &&
        !conn.provider.hasUnsyncedChanges &&
        !finished.current
      ) {
        finished.current = true;
        const counts = { elementCount: 0, frameCount: 0, framesToShoot: 0 };
        for (const el of listElements(conn.store.doc)) {
          counts.elementCount++;
          if (el.type !== 'frame') continue;
          counts.frameCount++;
          if (el.status !== 'shot') counts.framesToShoot++;
        }
        done(counts);
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
