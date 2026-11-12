// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardPreview } from '@inkadra/shared';
import { useCallback, useSyncExternalStore } from 'react';
import { api, RequestError } from '../lib/api.ts';

/**
 * What the card of a sub-board shows (decision 0121): the server's bounded projection of the
 * board, never its document. Shared by every card of the same board and fetched only while a
 * card of it is drawn, like the metadata of files (assets.ts). `version` is what the canvas
 * already knows of the board (when it was edited, its counts): when it changes, or when a card
 * of it is drawn a minute after the last answer (reviews do not edit the board), the preview is
 * asked again; the browser revalidates it and the server answers 304 when nothing changed.
 */
export type PreviewEntry =
  | { status: 'loading'; version: string; preview?: BoardPreview }
  | { status: 'ready'; version: string; preview: BoardPreview }
  /** The person cannot open the board: the card shows its name only. */
  | { status: 'denied'; version: string }
  | { status: 'error'; version: string; preview?: BoardPreview };

const cache = new Map<string, PreviewEntry>();
const loadedAt = new Map<string, number>();
const FRESH_MS = 60_000;
const listeners = new Map<string, Set<() => void>>();

function set(boardId: string, entry: PreviewEntry) {
  cache.set(boardId, entry);
  for (const l of listeners.get(boardId) ?? []) l();
}

function load(boardId: string, version: string) {
  const known = cache.get(boardId);
  const fresh = Date.now() - (loadedAt.get(boardId) ?? 0) < FRESH_MS;
  if (
    known &&
    known.version === version &&
    (known.status === 'loading' || (fresh && known.status !== 'error'))
  )
    return;
  loadedAt.set(boardId, Date.now());
  const kept = known && 'preview' in known ? known.preview : undefined;
  set(boardId, { status: 'loading', version, ...(kept ? { preview: kept } : {}) });
  api.get<BoardPreview>(`/boards/${boardId}/preview`).then(
    (preview) => {
      if (cache.get(boardId)?.version === version)
        set(boardId, { status: 'ready', version, preview });
    },
    (error: unknown) => {
      if (cache.get(boardId)?.version !== version) return;
      const denied =
        error instanceof RequestError && (error.status === 403 || error.status === 404);
      set(
        boardId,
        denied
          ? { status: 'denied', version }
          : { status: 'error', version, ...(kept ? { preview: kept } : {}) },
      );
    },
  );
}

function subscribe(boardId: string, version: string, listener: () => void) {
  let ids = listeners.get(boardId);
  if (!ids) {
    ids = new Set();
    listeners.set(boardId, ids);
  }
  ids.add(listener);
  load(boardId, version);
  return () => {
    ids.delete(listener);
    if (ids.size === 0) listeners.delete(boardId);
  };
}

/** The preview of a board, loaded while a card shows it; undefined while `boardId` is null. */
export function useBoardPreview(boardId: string | null, version: string): PreviewEntry | undefined {
  return useSyncExternalStore(
    useCallback(
      (listener) => (boardId ? subscribe(boardId, version, listener) : () => {}),
      [boardId, version],
    ),
    () => (boardId ? cache.get(boardId) : undefined),
  );
}

/** Forgets every preview: on sign-out (the next person may see less of a board), and in tests. */
export function resetBoardPreviews() {
  cache.clear();
  loadedAt.clear();
}
