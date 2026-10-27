import { createElement, listElements } from '@inkadra/canvas-core';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoardConnection } from '../board/connection.ts';
import { LOCAL } from '../board/store.ts';
import { seedStoryboard, seedTemplate, templateLabels } from '../board/templates.ts';
import type { CreatedSetupBoard } from './project-setup.ts';

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
  done: () => void;
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
        done();
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
