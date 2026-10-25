// SPDX-License-Identifier: AGPL-3.0-only
import type { Author, Comment, CommentThread, UserSummary } from '@inkadra/shared';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const REVIEW_STATUSES = ['none', 'in_review', 'approved', 'changes_requested'] as const;
export type KnownReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The contract is open: a status this client does not know is shown like `in_review`. */
export function reviewKey(status: string): KnownReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(status)
    ? (status as KnownReviewStatus)
    : 'in_review';
}

/** Name to show for an author; null for a deleted account or a kind this client does not know. */
export function authorName(author: Author | null | undefined): string | null {
  if (author?.kind === 'user') return author.user.name;
  if (author?.kind === 'guest') return author.name;
  return null;
}

/**
 * Text of the tag on a thread limited to a share link: the link’s label, trimmed, or null when
 * it is absent, null or empty, so the caller falls back to the generic one-link tag.
 */
export function shareLinkTag(comment: Pick<Comment, 'shareLinkLabel'>): string | null {
  const label = comment.shareLinkLabel?.trim();
  return label || null;
}

/**
 * Text of the tag beside a guest author: “Guest of the “X” link” when the server names their
 * link, “Guest” otherwise; null for anyone who is not a guest.
 */
export function guestTag(
  author: Author | null | undefined,
  t: (key: 'comments.guest' | 'comments.guestOfLink', options?: { label: string }) => string,
): string | null {
  if (author?.kind !== 'guest') return null;
  const label = author.shareLinkLabel?.trim();
  return label ? t('comments.guestOfLink', { label }) : t('comments.guest');
}

export type BodyPart = { text: string } | { mention: string };

/** Splits a body into text and mentions. Only ids listed in `mentions` become mentions. */
export function commentParts(comment: Pick<Comment, 'body' | 'mentions'>): BodyPart[] {
  const names = new Map(comment.mentions.map((p) => [p.id.toLowerCase(), p.name]));
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of comment.body.matchAll(/@\{([0-9a-f-]{36})\}/gi)) {
    const name = names.get((m[1] as string).toLowerCase());
    if (!name) continue;
    if (m.index > last) parts.push({ text: comment.body.slice(last, m.index) });
    parts.push({ mention: name });
    last = m.index + m[0].length;
  }
  if (last < comment.body.length) parts.push({ text: comment.body.slice(last) });
  return parts;
}

/** The body as the writer edits it: mentions as `@Name`. */
export function editableText(comment: Pick<Comment, 'body' | 'mentions'>): string {
  return commentParts(comment)
    .map((part) => ('mention' in part ? `@${part.mention}` : part.text))
    .join('');
}

/**
 * Turns the `@Name` of people picked from the suggestions back into `@{id}`. Longer names go
 * first, so `@Anna Maria` is not taken for `@Anna`. A name typed by hand stays plain text.
 */
export function encodeMentions(text: string, picked: readonly UserSummary[]): string {
  let result = text;
  const people = [...new Map(picked.map((p) => [p.id, p])).values()].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const person of people) {
    // Whole names only: `@Anna` is not taken out of `@Annalisa` nor of `x@Anna`.
    const name = person.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])@${name}(?![\\p{L}\\p{N}])`, 'gu');
    result = result.replace(pattern, () => `@{${person.id}}`);
  }
  return result;
}

/** The text after an `@` the caret is in, when the writer is typing a mention. */
export function mentionQuery(text: string, caret: number): string | null {
  const m = /(?:^|\s)@([^@\n{}]{0,40})$/.exec(text.slice(0, caret));
  return m ? (m[1] as string) : null;
}

export function mergeReplies<T extends { id: string; createdAt: string }>(...pages: T[][]): T[] {
  return [...new Map(pages.flat().map((item) => [item.id, item])).values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export interface FoundThread {
  threadId: string;
  /** Older replies fetched to find the comment, with the cursor of the page after them. */
  older?: { items: Comment[]; cursor: string | null };
}

/**
 * The thread a comment id belongs to. A notification may point to a reply older than the ones
 * sent inline, so the threads with more replies (of the card, when known) are paged; the pages
 * read come back, so the reply can be shown.
 */
export async function findThread(
  threads: readonly CommentThread[],
  commentId: string,
  elementId: string | null,
  replies: (threadId: string, cursor: string | null) => Promise<Page<Comment>>,
): Promise<FoundThread | null> {
  const direct = threads.find(
    (thread) => thread.id === commentId || thread.replies.some((reply) => reply.id === commentId),
  );
  if (direct) return { threadId: direct.id };
  for (const thread of threads) {
    if (elementId !== null && thread.elementId !== elementId) continue;
    if (thread.replyCount <= thread.replies.length) continue;
    const items: Comment[] = [];
    let cursor: string | null = null;
    do {
      const p = await replies(thread.id, cursor);
      items.push(...p.items);
      cursor = p.nextCursor;
      if (p.items.some((reply) => reply.id === commentId)) {
        return { threadId: thread.id, older: { items, cursor } };
      }
    } while (cursor);
  }
  return null;
}

/**
 * The thread whose start is `threadId`, to open a specific comment without scanning the other
 * threads. The comment may be the start, one of the inline replies, or an older reply, fetched
 * by paging the thread's replies oldest first; the pages read come back, so the reply can be
 * shown. A comment that is no longer there (deleted) still opens its thread, since the server
 * named it. Null when the thread is not in `threads`.
 */
export async function findThreadDirect(
  threads: readonly CommentThread[],
  threadId: string,
  commentId: string | null,
  replies: (threadId: string, cursor: string | null) => Promise<Page<Comment>>,
): Promise<FoundThread | null> {
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return null;
  if (commentId === null || commentId === thread.id) return { threadId: thread.id };
  if (thread.replies.some((reply) => reply.id === commentId)) return { threadId: thread.id };
  if (thread.replyCount <= thread.replies.length) return { threadId: thread.id };
  const items: Comment[] = [];
  let cursor: string | null = null;
  do {
    const p = await replies(thread.id, cursor);
    items.push(...p.items);
    cursor = p.nextCursor;
    if (p.items.some((reply) => reply.id === commentId)) {
      return { threadId: thread.id, older: { items, cursor } };
    }
  } while (cursor);
  return { threadId: thread.id };
}

/**
 * Refreshes the older replies already shown for threads in `scopes`, and drops threads that were
 * removed or whose replies now all fit inline.
 */
export async function refreshOlderReplies(
  threads: readonly CommentThread[],
  current: ReadonlyMap<string, { items: readonly Comment[]; cursor: string | null }>,
  scopes: ReadonlySet<string | null> | 'all',
  replies: (threadId: string, cursor: string | null) => Promise<Page<Comment>>,
): Promise<Map<string, { items: Comment[]; cursor: string | null }>> {
  const next = new Map<string, { items: Comment[]; cursor: string | null }>();
  if (current.size === 0) return next;
  const byId = new Map(threads.map((t) => [t.id, t]));
  await Promise.all(
    [...current].map(async ([threadId, prev]) => {
      const thread = byId.get(threadId);
      if (!thread || thread.replyCount <= thread.replies.length) return;
      if (scopes !== 'all' && !scopes.has(thread.elementId)) {
        next.set(threadId, { items: [...prev.items], cursor: prev.cursor });
        return;
      }
      const items: Comment[] = [];
      let cursor: string | null = null;
      do {
        const p = await replies(threadId, cursor);
        items.push(...p.items);
        cursor = p.nextCursor;
        if (p.items.length === 0) break;
      } while (
        cursor &&
        (prev.cursor === null || (cursor !== prev.cursor && items.length < prev.items.length))
      );
      next.set(threadId, { items, cursor });
    }),
  );
  return next;
}

/**
 * Threads after fetching again the ones of some cards (null: the board): the threads of those
 * cards are replaced by the fetched ones, the rest stay, newest first as the server sends them.
 */
export function mergeThreads(
  current: readonly CommentThread[],
  fetched: readonly CommentThread[],
  scopes: ReadonlySet<string | null>,
): CommentThread[] {
  const byId = new Map<string, CommentThread>();
  for (const thread of current) if (!scopes.has(thread.elementId)) byId.set(thread.id, thread);
  for (const thread of fetched) byId.set(thread.id, thread);
  return [...byId.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/** Notifications grouped by the local day they arrived on, newest first as the server sends. */
export function groupByDay<T extends { createdAt: string }>(
  items: readonly T[],
  dayOf: (date: Date) => string,
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOf(new Date(item.createdAt));
    const list = groups.get(day);
    if (list) list.push(item);
    else groups.set(day, [item]);
  }
  return [...groups];
}
