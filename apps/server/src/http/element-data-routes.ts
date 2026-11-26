import {
  API_PREFIX,
  type ElementDataMoved,
  Id,
  MoveElementData,
  type ScheduleBlock,
  z,
} from '@inkadra/shared';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { atLeast, boardAccess, requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import { type BoardNotifier, noNotices } from '../board-notices.ts';
import type { Database } from '../db/client.ts';
import {
  board,
  comment,
  elementReaction,
  elementReview,
  elementReviewEvent,
  notification,
  sharePick,
  shootingDay,
} from '../db/schema.ts';
import { afterCommit } from '../notifications.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
  notices?: BoardNotifier;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const BoardParams = z.object({ boardId: Id });

/**
 * The blocks of a shooting day with every pointer at one of `ids` on board `from` turned to
 * board `to`; null when none points there. A pointer without a board means the day's own board
 * (decision 0123).
 */
export function repointBlocks(
  blocks: readonly ScheduleBlock[],
  dayBoardId: string,
  from: string,
  to: string,
  ids: ReadonlySet<string>,
): ScheduleBlock[] | null {
  let changed = false;
  const out = blocks.map((block) => {
    const next = { ...block };
    if (block.shotId && ids.has(block.shotId) && (block.shotBoardId ?? dayBoardId) === from) {
      next.shotBoardId = to;
      changed = true;
    }
    if (block.sceneId && ids.has(block.sceneId) && (block.sceneBoardId ?? dayBoardId) === from) {
      next.sceneBoardId = to;
      changed = true;
    }
    return next;
  });
  return changed ? out : null;
}

/** The ids among `ids` that board `boardId` keeps comments, reactions, reviews or picks about. */
async function idsWithData(tx: Transaction, boardId: string, ids: string[]) {
  const found = [
    ...(await tx
      .selectDistinct({ id: comment.elementId })
      .from(comment)
      .where(and(eq(comment.boardId, boardId), inArray(comment.elementId, ids)))),
    ...(await tx
      .selectDistinct({ id: elementReaction.elementId })
      .from(elementReaction)
      .where(and(eq(elementReaction.boardId, boardId), inArray(elementReaction.elementId, ids)))),
    ...(await tx
      .selectDistinct({ id: elementReview.elementId })
      .from(elementReview)
      .where(and(eq(elementReview.boardId, boardId), inArray(elementReview.elementId, ids)))),
    ...(await tx
      .selectDistinct({ id: elementReviewEvent.elementId })
      .from(elementReviewEvent)
      .where(
        and(eq(elementReviewEvent.boardId, boardId), inArray(elementReviewEvent.elementId, ids)),
      )),
    ...(await tx
      .selectDistinct({ id: sharePick.elementId })
      .from(sharePick)
      .where(and(eq(sharePick.boardId, boardId), inArray(sharePick.elementId, ids)))),
  ];
  return new Set(found.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Scenes moving into a storyboard (decision 0140): what the server keeps by board and card
 * follows the cards to the board they were copied to, re-keyed in one transaction, never copied
 * nor deleted. Retrying moves only what is still on the source board.
 */
export function registerElementDataRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;
  const notices = deps.notices ?? noNotices;

  app.post(`${API_PREFIX}/boards/:boardId/element-data/move`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId: from } = BoardParams.parse(req.params);
    const { toBoardId: to, elementIds } = MoveElementData.parse(req.body);
    if (to === from) throw new HttpError('bad_request', 'The cards are already on this board.');
    const source = await requireBoardRole(db, actor, from, 'editor');
    const target = await requireBoardRole(db, actor, to, 'editor');
    const projectId = source.board.projectId;
    if (target.board.projectId !== projectId)
      throw new HttpError('bad_request', 'The boards are in different projects.');
    const ids = new Set(elementIds);

    const result = await db.transaction(async (tx) => {
      // Two moves between the same boards (a move and its Undo) run one after the other.
      await tx
        .select({ id: board.id })
        .from(board)
        .where(inArray(board.id, [from, to]))
        .orderBy(asc(board.id))
        .for('no key update');
      const here = await idsWithData(tx, from, elementIds);
      const moving = elementIds.filter((id) => here.has(id));
      if (moving.length) {
        const there = await idsWithData(tx, to, moving);
        if (there.size)
          throw new HttpError(
            'conflict',
            'The other board already keeps comments, reviews or picks about one of these cards.',
          );
      }

      // A thread moves whole: its start and its replies (the foreign key keeps them together).
      const comments = moving.length
        ? await tx
            .update(comment)
            .set({ boardId: to, updatedAt: new Date() })
            .where(
              and(
                eq(comment.boardId, from),
                or(
                  inArray(comment.elementId, moving),
                  inArray(
                    comment.threadId,
                    tx
                      .select({ id: comment.id })
                      .from(comment)
                      .where(and(eq(comment.boardId, from), inArray(comment.elementId, moving))),
                  ),
                ),
              ),
            )
            .returning({
              id: comment.id,
              elementId: comment.elementId,
              threadId: comment.threadId,
            })
        : [];
      const reactions = moving.length
        ? await tx
            .update(elementReaction)
            .set({ boardId: to })
            .where(
              and(eq(elementReaction.boardId, from), inArray(elementReaction.elementId, moving)),
            )
            .returning({ elementId: elementReaction.elementId })
        : [];
      const reviews = moving.length
        ? await tx
            .update(elementReview)
            .set({ boardId: to })
            .where(and(eq(elementReview.boardId, from), inArray(elementReview.elementId, moving)))
            .returning({ elementId: elementReview.elementId })
        : [];
      const events = moving.length
        ? await tx
            .update(elementReviewEvent)
            .set({ boardId: to })
            .where(
              and(
                eq(elementReviewEvent.boardId, from),
                inArray(elementReviewEvent.elementId, moving),
              ),
            )
            .returning({ id: elementReviewEvent.id })
        : [];
      // When it was picked stays as it was.
      const picks = moving.length
        ? await tx
            .update(sharePick)
            .set({ boardId: to, updatedAt: sql`${sharePick.updatedAt}` })
            .where(and(eq(sharePick.boardId, from), inArray(sharePick.elementId, moving)))
            .returning({ elementId: sharePick.elementId })
        : [];
      // Notifications about the cards open them where they are now. Retried moves find the
      // ones about cards whose comments already went (the ids, not only `moving`).
      const commentIds = comments.map((c) => c.id);
      const notifications = await tx
        .update(notification)
        .set({ boardId: to })
        .where(
          and(
            eq(notification.boardId, from),
            or(
              and(isNotNull(notification.elementId), inArray(notification.elementId, elementIds)),
              commentIds.length ? inArray(notification.commentId, commentIds) : sql`false`,
            ),
          ),
        )
        .returning({ id: notification.id });

      // Shooting days whose blocks point at the cards: every board of the project may hold one.
      const days = await tx
        .select({ id: shootingDay.id, boardId: shootingDay.boardId, blocks: shootingDay.blocks })
        .from(shootingDay)
        .where(eq(shootingDay.projectId, projectId))
        .orderBy(asc(shootingDay.id))
        .for('update');
      const changedDays = days.flatMap((day) => {
        const blocks = repointBlocks(day.blocks, day.boardId, from, to, ids);
        return blocks ? [{ ...day, blocks }] : [];
      });
      for (const dayBoard of new Set(changedDays.map((d) => d.boardId))) {
        const access = await boardAccess(tx, actor, dayBoard);
        if (!atLeast(access?.role ?? null, 'editor'))
          throw new HttpError('forbidden', 'A shooting day of these cards needs the editor role.');
      }
      for (const day of changedDays)
        await tx
          .update(shootingDay)
          .set({ blocks: day.blocks, revision: sql`${shootingDay.revision} + 1` })
          .where(eq(shootingDay.id, day.id));

      const moved: ElementDataMoved = {
        comments: comments.length,
        reactions: reactions.length,
        reviews: reviews.length,
        reviewEvents: events.length,
        picks: picks.length,
        notifications: notifications.length,
        shootingDays: changedDays.length,
      };
      return {
        moved,
        threads: comments.filter((c) => !c.threadId),
        reviewed: [...new Set([...reactions, ...reviews, ...picks].map((r) => r.elementId))],
      };
    });

    if (result.moved.comments || result.moved.reviews || result.moved.reactions)
      req.log.info({ from, to, moved: result.moved }, 'card data moved to another board');
    await afterCommit(req.log, () => {
      for (const boardId of [from, to]) {
        for (const t of result.threads)
          notices.notify(boardId, { type: 'comments', elementId: t.elementId, threadId: t.id });
        for (const elementId of result.reviewed)
          notices.notify(boardId, { type: 'review', elementId });
      }
    });
    return result.moved;
  });
}
