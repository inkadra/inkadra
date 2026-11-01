import {
  MAX_REACTION_NAMES,
  REACTION_EMOJIS,
  type ReactionEmoji,
  type ReactionSummary,
} from '@inkadra/shared';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { commentReaction, elementReaction, shareGuest, user } from '../db/schema.ts';

/** Who is asking: an account, or a guest of one share link. */
export type ReactionViewer = { userId: string } | { guestId: string; linkId: string };

interface Row {
  emoji: ReactionEmoji;
  userId: string | null;
  guestId: string | null;
  name: string | null;
}

/** Groups rows (oldest first) into one summary per emoji, in the order of the fixed set. */
export function summarize(rows: readonly Row[], viewer: ReactionViewer): ReactionSummary[] {
  const out: ReactionSummary[] = [];
  for (const emoji of REACTION_EMOJIS) {
    const mine = rows.filter((r) => r.emoji === emoji);
    if (mine.length === 0) continue;
    out.push({
      emoji,
      count: mine.length,
      mine: mine.some((r) =>
        'userId' in viewer ? r.userId === viewer.userId : r.guestId === viewer.guestId,
      ),
      names: mine.flatMap((r) => (r.name ? [r.name] : [])).slice(0, MAX_REACTION_NAMES),
    });
  }
  return out;
}

/** Reactions of comments, by comment id. A guest sees the team and their own link only. */
export async function commentReactions(
  db: Database,
  commentIds: readonly string[],
  viewer: ReactionViewer,
): Promise<Map<string, ReactionSummary[]>> {
  const result = new Map<string, ReactionSummary[]>();
  if (commentIds.length === 0) return result;
  const rows = await db
    .select({
      commentId: commentReaction.commentId,
      emoji: commentReaction.emoji,
      userId: commentReaction.userId,
      guestId: commentReaction.guestId,
      userName: user.name,
      guestName: shareGuest.name,
    })
    .from(commentReaction)
    .leftJoin(user, eq(user.id, commentReaction.userId))
    .leftJoin(shareGuest, eq(shareGuest.id, commentReaction.guestId))
    .where(
      and(
        inArray(commentReaction.commentId, [...commentIds]),
        'linkId' in viewer
          ? or(isNull(commentReaction.guestId), eq(commentReaction.shareLinkId, viewer.linkId))
          : undefined,
      ),
    )
    .orderBy(asc(commentReaction.createdAt), asc(commentReaction.id));
  const byComment = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byComment.get(r.commentId) ?? [];
    list.push({ ...r, name: r.userName ?? r.guestName });
    byComment.set(r.commentId, list);
  }
  for (const [id, list] of byComment) result.set(id, summarize(list, viewer));
  return result;
}

/** Reactions of the cards of a board, by element id. */
export async function elementReactions(
  db: Database,
  boardId: string,
  viewer: { userId: string },
  only?: string,
): Promise<Map<string, ReactionSummary[]>> {
  const rows = await db
    .select({
      elementId: elementReaction.elementId,
      emoji: elementReaction.emoji,
      userId: elementReaction.userId,
      name: user.name,
    })
    .from(elementReaction)
    .innerJoin(user, eq(user.id, elementReaction.userId))
    .where(
      and(
        eq(elementReaction.boardId, boardId),
        only ? eq(elementReaction.elementId, only) : undefined,
      ),
    )
    .orderBy(asc(elementReaction.createdAt), asc(elementReaction.id));
  const byElement = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byElement.get(r.elementId) ?? [];
    list.push({ ...r, guestId: null });
    byElement.set(r.elementId, list);
  }
  return new Map([...byElement].map(([id, list]) => [id, summarize(list, viewer)]));
}
