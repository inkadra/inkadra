// SPDX-License-Identifier: AGPL-3.0-only
import type { CommentThread } from '@inkadra/shared';
import type { Audience } from './board-model.ts';
import type { CommentEntry } from './compose.ts';

type Comment = CommentThread | CommentThread['replies'][number];

export interface CommentWords {
  onBoard: string;
  onCard(label: string): string;
  removedCard: string;
  /** Shown in place of a deleted thread start that still has replies, as the app does. */
  deleted: string;
  deletedAuthor: string;
}

/**
 * The comment threads an export prints. For clients it follows what guests of a share link
 * see, without being tied to one link: only threads open to every link (`everyone` with no
 * link of their own), and nothing written by guests, who belong to one link each. A deleted
 * thread start with readable replies stays as a placeholder; one without them is left out.
 * Threads on cards that are left out of the export are left out too.
 */
export function commentEntries(
  threads: readonly CommentThread[],
  options: {
    audience: Audience;
    /** Ids of the elements the export shows. */
    shown: ReadonlySet<string>;
    /** Elements still in the board, whatever the export shows. */
    exists: (elementId: string) => boolean;
    label: (elementId: string) => string;
    date: (iso: string) => string;
    words: CommentWords;
  },
): CommentEntry[] {
  const { audience, shown, exists, label, date, words } = options;
  const client = audience === 'client';
  const readable = (c: Comment) => !client || c.author.kind !== 'guest';
  const author = (c: Comment) =>
    c.author.kind === 'user'
      ? c.author.user.name
      : c.author.kind === 'guest'
        ? c.author.name
        : words.deletedAuthor;
  const body = (c: Comment) =>
    c.body.replace(/@\{([^}]+)\}/g, (all, id: string) => {
      const user = c.mentions.find((u) => u.id === id);
      return user ? `@${user.name}` : all;
    });
  const target = (elementId: string | null) => {
    if (elementId === null) return words.onBoard;
    if (!exists(elementId)) return words.removedCard;
    return words.onCard(label(elementId));
  };
  const out: CommentEntry[] = [];
  for (const thread of [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (client && (thread.visibility !== 'everyone' || thread.shareLinkId !== null)) continue;
    const onElement = thread.elementId;
    if (onElement !== null && !shown.has(onElement) && (client || exists(onElement))) continue;
    const replies = thread.replies
      .filter((r) => r.body && readable(r))
      .map((r) => ({ author: author(r), date: date(r.createdAt), body: body(r) }));
    const startReadable = thread.body !== '' && readable(thread);
    if (!startReadable && replies.length === 0) continue;
    out.push({
      target: target(onElement),
      author: startReadable ? author(thread) : '',
      date: date(thread.createdAt),
      body: startReadable ? body(thread) : words.deleted,
      replies,
    });
  }
  return out;
}
