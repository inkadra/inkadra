import type { ScheduleBlock } from '@inkadra/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { board, elementMove, type notification } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Notifications about a card or its comments: they follow the card to another board (0141). */
export const CARD_NOTIFICATIONS: Array<(typeof notification.$inferSelect)['type']> = [
  'mention',
  'reply',
  'comment',
  'review',
  'task_assigned',
];

/**
 * The board a card's data moved to, if it moved off `boardId` (decision 0141), once any move of
 * this board's card data has committed: the board row `FOR SHARE` waits for a move, which holds
 * it `FOR NO KEY UPDATE`. Writers never wait for each other here.
 */
export async function movedTo(tx: Tx, boardId: string, elementId: string) {
  await tx.select({ id: board.id }).from(board).where(eq(board.id, boardId)).for('share');
  const [moved] = await tx
    .select({ to: elementMove.toBoardId })
    .from(elementMove)
    .where(and(eq(elementMove.boardId, boardId), eq(elementMove.elementId, elementId)));
  return moved?.to ?? null;
}

/**
 * Taken first by every write of data about a card of a board (comments, reactions, reviews,
 * picks), in the transaction of the write, before it reads that data: it waits for a move of
 * the board's card data, then refuses a card whose data moved, as a card that is not there.
 * Nothing lands on a board the card left.
 */
export async function lockCardData(tx: Tx, boardId: string, elementId: string | null) {
  if (!elementId) {
    await tx.select({ id: board.id }).from(board).where(eq(board.id, boardId)).for('share');
    return;
  }
  if (await movedTo(tx, boardId, elementId))
    throw new HttpError('not_found', 'Card not found: it moved to another board.');
}

/**
 * Blocks of a day of `dayBoardId` with every pointer at a card whose data moved turned to the
 * board it moved to: a schedule saved from a view older than the move still points right. A
 * save that races the move waits for the day's lock, which the move takes, and is turned there.
 */
export async function followMovedCards<B extends Partial<ScheduleBlock>>(
  tx: Pick<Database, 'select'>,
  dayBoardId: string,
  blocks: B[],
): Promise<B[]> {
  const ids = [
    ...new Set(blocks.flatMap((b) => [b.shotId, b.sceneId].filter((id): id is string => !!id))),
  ];
  if (!ids.length) return blocks;
  const moves = await tx.select().from(elementMove).where(inArray(elementMove.elementId, ids));
  if (!moves.length) return blocks;
  const to = new Map(moves.map((m) => [`${m.boardId}/${m.elementId}`, m.toBoardId]));
  return blocks.map((block) => {
    const next = { ...block };
    const shot = block.shotId && to.get(`${block.shotBoardId ?? dayBoardId}/${block.shotId}`);
    if (shot) next.shotBoardId = shot;
    const scene = block.sceneId && to.get(`${block.sceneBoardId ?? dayBoardId}/${block.sceneId}`);
    if (scene) next.sceneBoardId = scene;
    return next;
  });
}
