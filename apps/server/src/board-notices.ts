import { type BoardNotice, boardDocName } from '@inkadra/doc-schema';
import type { CollabServer } from './collab.ts';

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
