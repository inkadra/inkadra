import type { ScheduledDay } from '@inkadra/canvas-core';
import {
  type BoardPreview,
  type ScheduleBlock,
  type ShootingDayInput,
  scheduleTimes,
} from '@inkadra/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Actor, boardRole } from './access.ts';
import type { Database } from './db/client.ts';
import { board, shootingDay } from './db/schema.ts';

/**
 * The Production board of decision 0123: one per project, holding the project's shooting days
 * and Troupe. Its days come from every storyboard; a block names the board of its frame.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Source = Pick<Database, 'select'>;

/** The project's Production board, trashed or not; null while it has none. */
export async function productionBoardOf(db: Source, projectId: string) {
  const [row] = await db
    .select()
    .from(board)
    .where(and(eq(board.projectId, projectId), eq(board.kind, 'production')));
  return row ?? null;
}

/** The project's Production board when it is not in the trash. */
export async function liveProductionBoard(db: Source, projectId: string) {
  const row = await productionBoardOf(db, projectId);
  return row && row.deletedAt === null ? row : null;
}

/** Serializes the moves and creations of one project's Production board. */
export const lockProduction = (tx: Pick<Database, 'execute'>, projectId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`production:${projectId}`}))`);

/**
 * A block of a day on `from`, as the Production board keeps it: a frame or a scene without a
 * board is one of `from`'s, so it gets that board's id. Labels are the client's to write.
 */
export function adoptedBlock(block: ScheduleBlock, from: string): ScheduleBlock {
  const out = { ...block };
  if (block.shotId !== null && block.shotBoardId === undefined) out.shotBoardId = from;
  if (block.sceneId !== undefined && block.sceneBoardId === undefined) out.sceneBoardId = from;
  return out;
}

/**
 * Moves the project's days to its Production board (decision 0123, §2), in the caller's
 * transaction: every day of another board that is not in the trash, as it is, with its blocks
 * pointing at the board it came from, `moved_from` set and its revision bumped, so an open
 * calendar gets a 409 and reloads instead of saving over it. Days of trashed boards stay where
 * they are. Calls, attendance answers and the crew are not touched. Running it again moves
 * nothing. Returns how many days moved.
 */
export async function adoptDays(
  tx: Transaction,
  projectId: string,
  productionId: string,
): Promise<number> {
  await lockProduction(tx, projectId);
  const days = await tx
    .select({ id: shootingDay.id, boardId: shootingDay.boardId, blocks: shootingDay.blocks })
    .from(shootingDay)
    .where(eq(shootingDay.projectId, projectId))
    .orderBy(asc(shootingDay.id))
    .for('update');
  const elsewhere = days.filter((day) => day.boardId !== productionId);
  if (!elsewhere.length) return 0;
  const live = await tx
    .select({ id: board.id })
    .from(board)
    .where(
      and(
        eq(board.projectId, projectId),
        isNull(board.deletedAt),
        inArray(board.id, [...new Set(elsewhere.map((day) => day.boardId))]),
      ),
    );
  const open = new Set(live.map((row) => row.id));
  let moved = 0;
  for (const day of elsewhere) {
    if (!open.has(day.boardId)) continue;
    await tx
      .update(shootingDay)
      .set({
        boardId: productionId,
        movedFrom: day.boardId,
        blocks: day.blocks.map((block) => adoptedBlock(block, day.boardId)),
        revision: sql`${shootingDay.revision} + 1`,
      })
      .where(eq(shootingDay.id, day.id));
    moved += 1;
  }
  return moved;
}

const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The first line of a location that is not a map link, as search titles it. */
const placeOf = (location: string) =>
  location
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^https?:\/\//i.test(line)) ?? '';

/**
 * The day the Production board's card shows (decision 0123, §5): the first on or after `today`,
 * else the last, numbered by date from 1 as the schedule numbers them, with its first five
 * blocks. Undefined without days.
 */
export function nextShootingDay(
  days: ReadonlyArray<Pick<ShootingDayInput, 'date' | 'callTime' | 'location' | 'blocks'>>,
  today: string,
): BoardPreview['nextDay'] {
  if (!days.length) return undefined;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const found = sorted.findIndex((day) => day.date >= today);
  const at = found >= 0 ? found : sorted.length - 1;
  const day = sorted[at] as (typeof sorted)[number];
  return {
    number: at + 1,
    date: day.date,
    callTime: day.callTime,
    location: placeOf(day.location).slice(0, 160),
    blocks: scheduleTimes(day)
      .slice(0, 5)
      .map(({ block, start }) => {
        const scene = block.type === 'scene';
        return {
          start: clock(start),
          type: block.type,
          title: block.title.slice(0, 160),
          boardId: (scene ? block.sceneBoardId : block.shotBoardId) ?? null,
          label: (scene ? block.sceneLabel : block.shotLabel) ?? null,
        };
      }),
  };
}

/** Today's date (YYYY-MM-DD) in a time zone, the server's when there is none. */
export const todayIn = (timeZone: string | null, now = new Date()) =>
  now.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });

/**
 * The shooting days a storyboard's readers see (decision 0123, §5): with a live Production
 * board, its days, every one of them so that "Day N" counts them all, each with only the blocks
 * that point at `boardId`, and none when the person cannot open it (answer 1); while the project
 * has none, the board's own days, as before. Dates and the frame or scene of each block only.
 */
export async function daysOfBoard(
  db: Pick<Database, 'select' | 'execute'>,
  actor: Pick<Actor, 'id'>,
  projectId: string,
  boardId: string,
): Promise<ScheduledDay[]> {
  const production = await liveProductionBoard(db, projectId);
  const from = production?.id ?? boardId;
  if (production && !(await boardRole(db, actor, production.id))?.role) return [];
  const days = await db
    .select({ date: shootingDay.date, blocks: shootingDay.blocks })
    .from(shootingDay)
    .where(eq(shootingDay.boardId, from));
  return days.map((day) => ({
    date: day.date,
    blocks: day.blocks.flatMap((b) => {
      const shot = (b.shotBoardId ?? from) === boardId ? (b.shotId ?? null) : null;
      const scene = b.type === 'scene' && (b.sceneBoardId ?? from) === boardId ? b.sceneId : undefined;
      if (shot === null && scene === undefined) return [];
      return [scene === undefined ? { shotId: shot } : { shotId: shot, sceneId: scene }];
    }),
  }));
}
