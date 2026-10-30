import { CLIP_BOARD_HISTORY_LIMIT } from '@inkadra/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { clipBoardUse, user } from './db/schema.ts';

/** Serialize per user, including concurrent clips on different server replicas. */
export async function rememberClipBoard(db: Database, userId: string, boardId: string) {
  await db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
    await tx
      .insert(clipBoardUse)
      .values({ userId, boardId, usedAt: sql`clock_timestamp()` })
      .onConflictDoUpdate({
        target: [clipBoardUse.userId, clipBoardUse.boardId],
        set: { usedAt: sql`clock_timestamp()` },
      });
    const stale = await tx
      .select({ boardId: clipBoardUse.boardId })
      .from(clipBoardUse)
      .where(eq(clipBoardUse.userId, userId))
      .orderBy(desc(clipBoardUse.usedAt), asc(clipBoardUse.boardId))
      .offset(CLIP_BOARD_HISTORY_LIMIT);
    if (stale.length)
      await tx.delete(clipBoardUse).where(
        and(
          eq(clipBoardUse.userId, userId),
          inArray(
            clipBoardUse.boardId,
            stale.map((r) => r.boardId),
          ),
        ),
      );
  });
}
