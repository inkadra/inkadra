// SPDX-License-Identifier: AGPL-3.0-only
import { readBoardNotice } from '@inkadra/doc-schema';
import type {
  BoardAccess,
  BoardReviews,
  Comment,
  CommentCounts,
  CommentThread,
  ProjectRole,
} from '@inkadra/shared';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import type { BoardConnection } from './connection.ts';
import { findThread, type Page } from './review-model.ts';
import {
  getReviews,
  openComments,
  pinsByElement,
  refreshReviews,
  resetReviews,
  setReviews,
  useReviews,
} from './review-store.ts';

const page = (cursor: string | null) => (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

export function fetchReplies(threadId: string, cursor: string | null) {
  return api.get<Page<Comment>>(`/comments/${threadId}/replies?limit=100${page(cursor)}`);
}

/**
 * Loads the comments and review status of the open board once, and again when a notice of the
 * collaboration server says they changed (BoardNotice `comments` and `review`), when the
 * connection comes back, or when our access changes.
 */
export function useBoardReviews(
  boardId: string,
  conn: BoardConnection | null,
  role: ProjectRole | null,
) {
  useEffect(() => {
    resetReviews({ boardId });
    return () => resetReviews();
  }, [boardId]);

  useEffect(() => {
    setReviews({ conn, role });
  }, [conn, role]);

  const synced = conn?.status === 'synced';
  const accessVersion = conn?.accessChangedAt;
  const commentsRevision = useReviews((s) => s.commentsRevision);
  const reviewsRevision = useReviews((s) => s.reviewsRevision);

  useEffect(() => {
    if (!synced) return;
    let alive = true;
    void accessVersion;
    void commentsRevision;
    // Threads also carry the pins, so they are paged once per board, never once per card.
    async function threads() {
      const all: CommentThread[] = [];
      let cursor: string | null = null;
      do {
        const p: Page<CommentThread> = await api.get(
          `/boards/${boardId}/comments?status=all&limit=100${page(cursor)}`,
        );
        all.push(...p.items);
        cursor = p.nextCursor;
      } while (cursor && alive);
      return all;
    }
    Promise.all([api.get<CommentCounts>(`/boards/${boardId}/comment-counts`), threads()])
      .then(([counts, all]) => {
        if (!alive) return;
        setReviews({
          counts: new Map(counts.items.map((c) => [c.elementId, c])),
          threads: all,
          pins: pinsByElement(all),
          status: 'ready',
        });
      })
      .catch(() => {
        if (alive) setReviews({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [boardId, synced, accessVersion, commentsRevision]);

  useEffect(() => {
    if (!synced) return;
    let alive = true;
    void accessVersion;
    void reviewsRevision;
    api
      .get<BoardReviews>(`/boards/${boardId}/reviews`)
      .then((r) => {
        if (alive) setReviews({ reviews: new Map(r.items.map((item) => [item.elementId, item])) });
      })
      .catch(() => {
        if (alive) setReviews({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [boardId, synced, accessVersion, reviewsRevision]);

  // People who can read the board: the ones a comment can mention.
  useEffect(() => {
    if (!synced) return;
    let alive = true;
    void accessVersion;
    api
      .get<BoardAccess>(`/boards/${boardId}/access`)
      .then((a) => {
        if (alive) setReviews({ people: a.items.map((entry) => entry.user) });
      })
      .catch(() => {
        if (alive) setReviews({ people: [] });
      });
    return () => {
      alive = false;
    };
  }, [boardId, synced, accessVersion]);

  const provider = conn?.provider;
  useEffect(() => {
    if (!provider) return;
    const onNotice = ({ payload }: { payload: string }) => {
      const notice = readBoardNotice(payload);
      if (notice?.type === 'comments') refreshReviews('comments');
      if (notice?.type === 'review') refreshReviews('reviews');
    };
    provider.on('stateless', onNotice);
    return () => {
      provider.off('stateless', onNotice);
    };
  }, [provider]);

  // A notification links to ?thread=<comment id>, which may be a reply of an older page.
  const [params, setParams] = useSearchParams();
  const linked = params.get('thread');
  const ready = useReviews((s) => s.status !== 'loading');
  useEffect(() => {
    if (!linked || !ready) return;
    let alive = true;
    const { threads } = getReviews();
    findThread(threads, linked, null, fetchReplies)
      .catch(() => null)
      .then((threadId) => {
        if (!alive) return;
        const elementId = threads.find((t) => t.id === threadId)?.elementId;
        openComments({ threadId: threadId ?? linked, ...(elementId ? { elementId } : {}) });
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.delete('thread');
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      alive = false;
    };
  }, [linked, ready, setParams]);
}
