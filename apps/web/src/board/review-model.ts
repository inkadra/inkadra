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
  for (const person of people) result = result.split(`@${person.name}`).join(`@{${person.id}}`);
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

/**
 * The thread a comment id belongs to. A notification may point to a reply older than the ones
 * sent inline, so the threads with more replies (of the card, when known) are paged.
 */
export async function findThread(
  threads: readonly CommentThread[],
  commentId: string,
  elementId: string | null,
  replies: (threadId: string, cursor: string | null) => Promise<Page<Comment>>,
): Promise<string | null> {
  const direct = threads.find(
    (thread) => thread.id === commentId || thread.replies.some((reply) => reply.id === commentId),
  );
  if (direct) return direct.id;
  for (const thread of threads) {
    if (elementId !== null && thread.elementId !== elementId) continue;
    if (thread.replyCount <= thread.replies.length) continue;
    let cursor: string | null = null;
    do {
      const p = await replies(thread.id, cursor);
      if (p.items.some((reply) => reply.id === commentId)) return thread.id;
      cursor = p.nextCursor;
    } while (cursor);
  }
  return null;
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
