import type { BoardWriter, BoardWritersQuery } from '@inkadra/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { boardWriter, user } from './db/schema.ts';

/**
 * Who wrote under each Yjs client id of a board (decision 0120). The collaboration server notes
 * the ids in memory as writes arrive and stores them in one batch with the board.
 */

/** Rows are kept this long after their last write, the age of daily versions. */
export const WRITER_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Newest rows kept per board: every page load is a new id. */
export const MAX_WRITERS_PER_BOARD = 2000;
/** Marks kept per id, and the least time between two. */
export const MAX_WRITER_MARKS = 32;
export const WRITER_MARK_EVERY_S = 60;

/** Writes noted since the board was last stored, per client id. */
export type PendingWriters = Map<number, PendingWriter>;
interface PendingWriter {
  /** Null for the server's own writes. */
  userId: string | null;
  /** The highest clock written under the id. */
  clock: number;
  contested: boolean;
}

/** Notes a write under `client` up to `clock` (inclusive) by an account, or by the server. */
export function noteWriter(
  pending: PendingWriters,
  client: number,
  userId: string | null,
  clock: number,
) {
  const seen = pending.get(client);
  if (!seen) {
    pending.set(client, { userId, clock, contested: false });
    return;
  }
  seen.clock = Math.max(seen.clock, clock);
  if (seen.userId !== userId) seen.contested = true;
}

/**
 * Stores the noted writes in one statement. A new mark only when the clock advanced and a
 * minute passed since the last one; the oldest goes past 32. Another writer than the stored one
 * makes the row contested.
 */
export async function storeWriters(
  db: Database,
  boardId: string,
  pending: PendingWriters,
  now = new Date(),
) {
  if (pending.size === 0) return;
  const seconds = Math.floor(now.getTime() / 1000);
  const rows = [...pending].map(([clientId, w]) => ({
    boardId,
    clientId,
    userId: w.userId,
    kind: w.userId ? ('user' as const) : ('server' as const),
    contested: w.contested,
    firstSeenAt: now,
    lastSeenAt: now,
    marks: [[w.clock, seconds]] as Array<[number, number]>,
  }));
  const last = sql`${boardWriter.marks} -> -1`;
  const next = sql`excluded.marks -> 0`;
  await db
    .insert(boardWriter)
    .values(rows)
    .onConflictDoUpdate({
      target: [boardWriter.boardId, boardWriter.clientId],
      set: {
        lastSeenAt: sql`excluded.last_seen_at`,
        contested: sql`${boardWriter.contested} or excluded.contested
          or ${boardWriter.kind} <> excluded.kind
          or ${boardWriter.userId} is distinct from excluded.user_id`,
        marks: sql`case
          when (${next} ->> 0)::bigint > (${last} ->> 0)::bigint
            and (${next} ->> 1)::bigint - (${last} ->> 1)::bigint >= ${WRITER_MARK_EVERY_S}
          then (case when jsonb_array_length(${boardWriter.marks}) >= ${MAX_WRITER_MARKS}
            then ${boardWriter.marks} - 0 else ${boardWriter.marks} end) || excluded.marks
          else ${boardWriter.marks} end`,
      },
    });
}

/** The answer to `POST /boards/{boardId}/writers`, one item per lookup in order. */
export async function findWriters(
  db: Database,
  boardId: string,
  items: BoardWritersQuery['items'],
): Promise<BoardWriter[]> {
  const rows = await db
    .select({ writer: boardWriter, name: user.name, image: user.image })
    .from(boardWriter)
    .leftJoin(user, eq(user.id, boardWriter.userId))
    .where(
      and(
        eq(boardWriter.boardId, boardId),
        inArray(boardWriter.clientId, [...new Set(items.map((i) => i.client))]),
      ),
    );
  const byClient = new Map(rows.map((r) => [r.writer.clientId, r]));
  return items.map(({ client, clock }): BoardWriter => {
    const row = byClient.get(client);
    if (!row) return { client, kind: 'unknown', user: null, changedAt: null, lastSeenAt: null };
    const { writer: w, name, image } = row;
    const mark = clock === undefined ? undefined : w.marks.find(([c]) => c >= clock);
    const times = {
      changedAt: mark ? new Date(mark[1] * 1000).toISOString() : w.lastSeenAt.toISOString(),
      lastSeenAt: w.lastSeenAt.toISOString(),
    };
    if (w.contested) return { client, kind: 'contested', user: null, ...times };
    if (w.kind === 'server') return { client, kind: 'server', user: null, ...times };
    if (!w.userId || name === null) return { client, kind: 'deleted', user: null, ...times };
    return { client, kind: 'user', user: { id: w.userId, name, image }, ...times };
  });
}

/** Drops rows 30 days past their last write and all but the newest 2000 of each board. */
export async function pruneWriters(db: Database, now = new Date()) {
  const old = await db
    .delete(boardWriter)
    .where(lt(boardWriter.lastSeenAt, new Date(now.getTime() - WRITER_KEEP_MS)))
    .returning({ boardId: boardWriter.boardId });
  const over = await db.execute(sql`
    delete from board_writer w using (
      select board_id, client_id from (
        select board_id, client_id, row_number() over (
          partition by board_id order by last_seen_at desc, client_id desc
        ) as n
        from board_writer
        -- Only boards over the cap: the window never sorts the whole table (#814).
        where board_id in (
          select board_id from board_writer group by board_id
          having count(*) > ${MAX_WRITERS_PER_BOARD}
        )
      ) ranked where n > ${MAX_WRITERS_PER_BOARD}
    ) r
    where w.board_id = r.board_id and w.client_id = r.client_id
    returning w.board_id`);
  return { removed: old.length + over.length };
}
