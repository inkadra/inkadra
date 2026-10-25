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
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import type { BoardConnection } from './connection.ts';
import {
  findThread,
  findThreadDirect,
  mergeThreads,
  type Page,
  refreshOlderReplies,
} from './review-model.ts';
import {
  addOlderReplies,
  getReviews,
  openComments,
  pinsByElement,
  queueCommentScopes,
  refreshReviews,
  resetReviews,
  setReviews,
  takeCommentScopes,
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
  view: { preview: boolean; canvas: boolean },
) {
  useEffect(() => {
    resetReviews({ boardId });
    return () => resetReviews();
  }, [boardId]);

  useEffect(() => {
    setReviews({ conn, role });
  }, [conn, role]);

  // A version preview shows no comments: they are about the live board.
  const { preview, canvas } = view;
  useEffect(() => {
    setReviews({ preview, canvas, ...(preview ? { target: null, pinTarget: null } : {}) });
  }, [preview, canvas]);

  const synced = conn?.status === 'synced';
  const accessVersion = conn?.accessChangedAt;
  const commentsRevision = useReviews((s) => s.commentsRevision);
  const reviewsRevision = useReviews((s) => s.reviewsRevision);
  // Everything is fetched when the board opens, the connection comes back or access changes;
  // a notice or a local change then only fetches the threads of the card it is about.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!synced) {
      loadedFor.current = null;
      return;
    }
    let alive = true;
    let done = false;
    const key = `${boardId}:${accessVersion ?? ''}`;
    void commentsRevision;
    const queued = takeCommentScopes();
    const scopes = loadedFor.current === key ? queued : 'all';
    loadedFor.current = key;
    async function threads(query: string) {
      const all: CommentThread[] = [];
      let cursor: string | null = null;
      do {
        const p: Page<CommentThread> = await api.get(
          `/boards/${boardId}/comments?status=all&limit=100${query}${page(cursor)}`,
        );
        all.push(...p.items);
        cursor = p.nextCursor;
      } while (cursor && alive);
      return all;
    }
    // Threads also carry the pins, so they are paged once per board, never once per card.
    const fetched = (
      scopes === 'all'
        ? threads('')
        : Promise.all(
            [...scopes].map((id) =>
              threads(id === null ? '&scope=board' : `&elementId=${encodeURIComponent(id)}`),
            ),
          ).then((lists) => mergeThreads(getReviews().threads, lists.flat(), scopes))
    ).then(async (all) => ({
      all,
      olderReplies: await refreshOlderReplies(all, getReviews().olderReplies, scopes, fetchReplies),
    }));
    Promise.all([api.get<CommentCounts>(`/boards/${boardId}/comment-counts`), fetched])
      .then(([counts, { all, olderReplies }]) => {
        if (!alive) return;
        done = true;
        setReviews({
          counts: new Map(counts.items.map((c) => [c.elementId, c])),
          threads: all,
          pins: pinsByElement(all),
          olderReplies,
          status: 'ready',
        });
      })
      .catch(() => {
        if (!alive) return;
        // The next change fetches everything again.
        loadedFor.current = null;
        setReviews({ status: 'error' });
      });
    return () => {
      alive = false;
      // Cut short by a newer change: keep what this fetch was for in the next one.
      if (!done) queueCommentScopes(scopes);
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
        if (!alive) return;
        setReviews({
          reviews: new Map(r.items.map((item) => [item.elementId, item])),
          reviewsStatus: 'ready',
        });
      })
      .catch(() => {
        if (alive) setReviews({ reviewsStatus: 'error' });
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
      if (notice?.type === 'comments') refreshReviews('comments', notice.elementId);
      if (notice?.type === 'review') refreshReviews('reviews');
    };
    provider.on('stateless', onNotice);
    return () => {
      provider.off('stateless', onNotice);
    };
  }, [provider]);

  // A notification links to ?thread=<thread start>&el=<card>, and &comment=<comment> when the
  // comment is a reply; the comment may be of an older page, which is fetched so it can be
  // shown. Older servers and thread starts link the comment itself: those are found by
  // scanning the threads.
  const [params, setParams] = useSearchParams();
  const linked = params.get('thread');
  const linkedComment = params.get('comment');
  // The canvas takes `el` out of the address once it has selected the card: keep it per link.
  const linkedElement = useRef<{ thread: string | null; el: string | null }>({
    thread: null,
    el: null,
  });
  if (linkedElement.current.thread !== linked) {
    linkedElement.current = { thread: linked, el: params.get('el') };
  }
  const ready = useReviews((s) => s.status !== 'loading');
  useEffect(() => {
    if (!linked || !ready) return;
    let alive = true;
    const { threads } = getReviews();
    const commentId = linkedComment || linked;
    // The thread of the reply is known: open it without scanning the other threads. When it is
    // not in the list, no other thread holds the reply either, so the panel just opens it.
    const find = linkedComment
      ? findThreadDirect(threads, linked, commentId, fetchReplies)
      : findThread(threads, linked, linkedElement.current.el, fetchReplies);
    find
      .catch(() => null)
      .then((found) => {
        if (!alive) return;
        const elementId = threads.find((t) => t.id === found?.threadId)?.elementId;
        if (found?.older) {
          addOlderReplies(found.threadId, found.older.items, found.older.cursor);
        }
        openComments({
          threadId: found?.threadId ?? linked,
          commentId,
          ...(elementId ? { elementId } : {}),
        });
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.delete('thread');
            next.delete('comment');
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      alive = false;
    };
  }, [linked, linkedComment, ready, setParams]);
}
