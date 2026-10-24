// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CommentCount,
  CommentPin,
  CommentThread,
  ElementReview,
  ProjectRole,
  UserSummary,
} from '@inkadra/shared';
import { useSyncExternalStore } from 'react';
import type { BoardConnection } from './connection.ts';

/**
 * Comments and review status of the open board, fetched once per board by useBoardReviews and
 * read by the cards through selectors: a card re-renders only when its own count, status or
 * pins change, and never makes a request.
 */
export interface CommentTarget {
  elementId?: string;
  /** A thread, or a reply of it, to bring into view. */
  threadId?: string;
  pin?: CommentPin;
}

export interface ReviewsState {
  boardId: string | null;
  conn: BoardConnection | null;
  role: ProjectRole | null;
  counts: ReadonlyMap<string | null, CommentCount>;
  reviews: ReadonlyMap<string, ElementReview>;
  threads: readonly CommentThread[];
  pins: ReadonlyMap<string, readonly CommentThread[]>;
  people: readonly UserSummary[];
  status: 'loading' | 'ready' | 'error';
  /** The comments panel is open on this target; null when closed. */
  target: CommentTarget | null;
  /** Card waiting for the point of a new pinned comment. */
  pinTarget: string | null;
  commentsRevision: number;
  reviewsRevision: number;
}

const EMPTY: ReviewsState = {
  boardId: null,
  conn: null,
  role: null,
  counts: new Map(),
  reviews: new Map(),
  threads: [],
  pins: new Map(),
  people: [],
  status: 'loading',
  target: null,
  pinTarget: null,
  commentsRevision: 0,
  reviewsRevision: 0,
};

let state = EMPTY;
const listeners = new Set<() => void>();

export function getReviews(): ReviewsState {
  return state;
}

export function setReviews(patch: Partial<ReviewsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function resetReviews(patch: Partial<ReviewsState> = {}) {
  state = { ...EMPTY, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The selector must return a value that stays the same object while nothing changed. */
export function useReviews<T>(select: (s: ReviewsState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function canComment(role: ProjectRole | null): boolean {
  return role === 'owner' || role === 'editor' || role === 'commenter';
}

export function openComments(target: CommentTarget = {}) {
  if (!state.boardId) return;
  setReviews({ target, pinTarget: null });
}

export function closeComments() {
  setReviews({ target: null });
}

export function placePin(elementId: string | null) {
  setReviews({ pinTarget: elementId, ...(elementId ? { target: null } : {}) });
}

const timers: Record<'comments' | 'reviews', ReturnType<typeof setTimeout> | undefined> = {
  comments: undefined,
  reviews: undefined,
};

/** Fetches again shortly; bursts of notices and local changes make a single request. */
export function refreshReviews(what: 'comments' | 'reviews') {
  clearTimeout(timers[what]);
  timers[what] = setTimeout(() => {
    if (what === 'comments') setReviews({ commentsRevision: state.commentsRevision + 1 });
    else setReviews({ reviewsRevision: state.reviewsRevision + 1 });
  }, 100);
}

/** Open threads with a point, by card, oldest first so their numbers stay put. */
export function pinsByElement(threads: readonly CommentThread[]) {
  const byElement = new Map<string, CommentThread[]>();
  for (const thread of threads) {
    if (!thread.elementId || !thread.pin || thread.resolvedAt || thread.deletedAt) continue;
    const list = byElement.get(thread.elementId) ?? [];
    list.unshift(thread);
    byElement.set(thread.elementId, list);
  }
  return byElement;
}
