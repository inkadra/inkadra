// SPDX-License-Identifier: AGPL-3.0-only
import type { CastAppearance } from '@inkadra/canvas-core';
import type { CastAppearances } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

const requests = new Map<string, Promise<CastAppearance[]>>();
const FRESH_MS = 60_000;

/**
 * Where the names of a cast appear on the other boards of the project. Characters and frames
 * often live on different boards; this board's frames come live from its own document.
 * shortcut: shared by every card for a minute, so a frame edited on another board can show late.
 */
export function useCastAppearances(projectId: string, boardId: string, skip: boolean) {
  const [items, setItems] = useState<CastAppearance[]>([]);
  useEffect(() => {
    if (skip) return;
    let live = true;
    const key = `${projectId}:${boardId}`;
    let request = requests.get(key);
    if (!request) {
      request = api
        .get<CastAppearances>(`/projects/${projectId}/cast-appearances?excludeBoardId=${boardId}`)
        .then((result) => result.items)
        .catch(() => []);
      requests.set(key, request);
      setTimeout(() => requests.delete(key), FRESH_MS);
    }
    void request.then((next) => {
      if (live) setItems(next);
    });
    return () => {
      live = false;
    };
  }, [projectId, boardId, skip]);
  return items;
}
