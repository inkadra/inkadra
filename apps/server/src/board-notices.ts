import { type BoardNotice, boardDocName } from '@inkadra/doc-schema';
import { and, eq, sql } from 'drizzle-orm';
import type { CollabServer } from './collab.ts';
import type { Database } from './db/client.ts';
import { asset, boardElementIndex } from './db/schema.ts';

/**
 * Stateless messages to the open clients of a board after a change made over REST (comments,
 * reviews), like `access` in decision 0011. They only say what changed: clients fetch it again,
 * so the permission rules stay in the REST API. Sending is best effort and never fails the
 * request that caused it.
 */
export interface BoardNotifier {
  notify(boardId: string, notice: BoardNotice): void;
}

export const noNotices: BoardNotifier = { notify() {} };

/** Through a collaboration server in the same process (`all`, `collab`). */
export function directBoardNotifier(collab: CollabServer): BoardNotifier {
  return {
    notify(boardId, notice) {
      collab.hocuspocus.documents
        .get(boardDocName(boardId))
        ?.broadcastStateless(JSON.stringify(notice));
    },
  };
}

/** A notice is worth delivering only while clients would still fetch something new. */
export const NOTICE_TTL_MS = 30_000;

/**
 * Tells the open boards that show a file that its copies are being made again (#787), so their
 * cards fetch it and follow it until ready. Boards come from the search index, which knows every
 * card's file; best effort like every notice.
 */
export async function noticeAssetBoards(db: Database, notices: BoardNotifier, assetId: string) {
  const rows = await db
    .selectDistinct({ boardId: boardElementIndex.boardId })
    .from(boardElementIndex)
    .where(
      and(
        // Through the project, whose index the table has.
        eq(
          boardElementIndex.projectId,
          sql`(select ${asset.projectId} from ${asset} where ${asset.id} = ${assetId})`,
        ),
        eq(boardElementIndex.assetId, assetId),
      ),
    );
  for (const { boardId } of rows) notices.notify(boardId, { type: 'asset', assetId });
}
