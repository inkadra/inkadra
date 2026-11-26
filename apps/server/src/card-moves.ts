import { and, eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { board, elementMove } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Taken first by every write that adds data about a card of a board (comments, reactions,
 * reviews, picks), in the transaction of the write (decision 0141). The board row `FOR SHARE`
 * waits for a move of card data off the board, which holds it `FOR NO KEY UPDATE` until it
 * commits; then a card whose data moved is refused, as a card that is not there: nothing lands
 * on a board the card left. Writes never wait for each other here.
 */
export async function lockCardData(tx: Tx, boardId: string, elementId: string | null) {
  await tx.select({ id: board.id }).from(board).where(eq(board.id, boardId)).for('share');
  if (!elementId) return;
  const [moved] = await tx
    .select({ to: elementMove.toBoardId })
    .from(elementMove)
    .where(and(eq(elementMove.boardId, boardId), eq(elementMove.elementId, elementId)));
  if (moved) throw new HttpError('not_found', 'Card not found: it moved to another board.');
}
