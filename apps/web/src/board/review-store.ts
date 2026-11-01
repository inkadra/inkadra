// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Comment,
  CommentCount,
  CommentPin,
  CommentThread,
  CommentVisibility,
  ElementReview,
  ProjectRole,
  UserSummary,
} from '@inkadra/shared';
import { useSyncExternalStore } from 'react';
import type { BoardConnection } from './connection.ts';
import { mergeReplies } from './review-model.ts';

/**
 * Comments and review status of the open board, fetched once per board by useBoardReviews and
 * read by the cards through selectors: a card re-renders only when its own count, status or
 * pins change, and never makes a request.
 */
export interface CommentTarget {
  elementId?: string;
  /** A thread to bring into view. */
  threadId?: string;
  /** A comment of that thread (a reply, maybe of an older page) to bring into view. */
  commentId?: string;
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
  reviewsStatus: 'loading' | 'ready' | 'error';
  /** Older replies already fetched, by thread: a notification may link to one of them. */
  olderReplies: ReadonlyMap<string, { items: readonly Comment[]; cursor: string | null }>;
  /** A version of the board is being previewed: comments belong to the live board only. */
  preview: boolean;
  /** The canvas is shown (not the storyboard or shot list): the only view with pins. */
  canvas: boolean;
  /** The comments panel is open on this target; null when closed. */
  target: CommentTarget | null;
  /** Card waiting for the point of a new pinned comment. */
  pinTarget: string | null;
  /** Show the threads on the board: a bubble at the edge of each card and a popover (#311). */
  onBoard: boolean;
  /** Card whose threads are open in a popover beside it; null when none. */
  popover: string | null;
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
  reviewsStatus: 'loading',
  olderReplies: new Map(),
  preview: false,
  canvas: true,
  target: null,
  pinTarget: null,
  onBoard: true,
  popover: null,
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
  clearTimeout(timers.comments);
  clearTimeout(timers.reviews);
  timers.comments = undefined;
  timers.reviews = undefined;
  pendingScopes = null;
  drafts.clear();
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
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
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

const ON_BOARD_KEY = 'inkadra.comments.onBoard';
/** One choice per person, kept on this device; on until someone turns it off. */
const onBoardKey = (userId: string | undefined) =>
  userId ? `${ON_BOARD_KEY}.${userId}` : ON_BOARD_KEY;

export function readOnBoard(userId: string | undefined): boolean {
  try {
    return localStorage.getItem(onBoardKey(userId)) !== '0';
  } catch {
    return true;
  }
}

export function setOnBoard(on: boolean, userId: string | undefined) {
  try {
    localStorage.setItem(onBoardKey(userId), on ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  setReviews({ onBoard: on, ...(on ? {} : { popover: null }) });
}

export function openPopover(elementId: string) {
  setReviews({ popover: elementId });
}

export function closePopover() {
  if (state.popover !== null) setReviews({ popover: null });
}

export function placePin(elementId: string | null) {
  setReviews({ pinTarget: elementId, ...(elementId ? { target: null } : {}) });
}

export function addOlderReplies(
  threadId: string,
  items: readonly Comment[],
  cursor: string | null,
) {
  const current = state.olderReplies.get(threadId);
  const older = new Map(state.olderReplies);
  older.set(threadId, {
    items: mergeReplies([...(current?.items ?? [])], [...items]),
    cursor,
  });
  setReviews({ olderReplies: older });
}

const timers: Record<'comments' | 'reviews', ReturnType<typeof setTimeout> | undefined> = {
  comments: undefined,
  reviews: undefined,
};

/** Cards (null: the board) whose threads changed since the last fetch; 'all' for everything. */
export type CommentScopes = ReadonlySet<string | null> | 'all';
let pendingScopes: Set<string | null> | 'all' | null = null;

/** Adds cards (or 'all' when undefined) to the next comments fetch. */
export function queueCommentScopes(scopes: CommentScopes | string | null | undefined) {
  if (scopes === undefined || scopes === 'all' || pendingScopes === 'all') {
    pendingScopes = 'all';
    return;
  }
  pendingScopes ??= new Set();
  if (typeof scopes === 'string' || scopes === null) pendingScopes.add(scopes);
  else for (const scope of scopes) pendingScopes.add(scope);
}

/** Takes the cards queued for the next comments fetch, or 'all' when none were queued. */
export function takeCommentScopes(): CommentScopes {
  const scopes = pendingScopes ?? 'all';
  pendingScopes = null;
  return scopes;
}

/**
 * Fetches again shortly; bursts of notices and local changes make a single request. With an
 * element id (null for the board) only the threads of that card are fetched again.
 */
export function refreshReviews(what: 'comments' | 'reviews', elementId?: string | null) {
  if (what === 'comments') queueCommentScopes(elementId);
  clearTimeout(timers[what]);
  timers[what] = setTimeout(() => {
    timers[what] = undefined;
    if (what === 'comments') setReviews({ commentsRevision: state.commentsRevision + 1 });
    else setReviews({ reviewsRevision: state.reviewsRevision + 1 });
  }, 100);
}

/** Text of the new comment being written on the board (null) or on a card, by scope. */
export interface CommentDraft {
  elementId: string | null;
  text: string;
  picked: readonly UserSummary[];
  visibility: CommentVisibility;
}
const drafts = new Map<string | null, CommentDraft>();

export function getDraft(elementId: string | null): CommentDraft | null {
  return drafts.get(elementId) ?? null;
}

export function saveDraft(
  next: CommentDraft | null,
  elementId: string | null = next?.elementId ?? null,
) {
  if (next) drafts.set(next.elementId, next);
  else drafts.delete(elementId);
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
