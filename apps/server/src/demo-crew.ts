import { readFile } from 'node:fs/promises';
import {
  CrewMemberInput,
  castNameKey,
  type DayCall,
  ElementRef,
  ScheduleTime,
  z,
} from '@inkadra/shared';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { board, crewMember, shootingDay } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

/**
 * Crew rows a demo project may hold (decision 0132): the sample's Troupe and what a visitor adds,
 * so the rows of one sandbox stay small next to its boards.
 */
export const DEMO_MAX_CREW = 200;

/**
 * Refuses a write that left a demo project with more than DEMO_MAX_CREW rows; call it in the
 * write's transaction, after it. It takes the lock every crew insert takes (the bulk paste, a
 * cast link), so two writes at once are counted one after the other.
 */
export async function checkDemoCrew(
  tx: Pick<Database, 'execute' | 'select'>,
  projectId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
  const [rows] = await tx
    .select({ n: count() })
    .from(crewMember)
    .where(eq(crewMember.projectId, projectId));
  if ((rows?.n ?? 0) > DEMO_MAX_CREW)
    throw new HttpError('conflict', `A demo project has at most ${DEMO_MAX_CREW} crew rows.`, {
      reason: 'demo_limit',
    });
}

/**
 * The Troupe of a demo sample project (decision 0132). Project archives carry no crew or day
 * calls (decisions 0091 and 0092), so a sample's Troupe sits next to its archive in
 * `<name>.crew.json`, made by e2e/scripts/demo-seed.ts with invented people only. A character is
 * named by its board's title and its card's id, which an import keeps; a call by its day (the
 * date as exported and the day's call, since two units may shoot on one date) and the row's name.
 */
export const DemoCrew = z
  .object({
    crew: z
      .array(
        CrewMemberInput.omit({ userId: true, character: true, position: true })
          .extend({
            character: z
              .object({ board: z.string().min(1).max(200), elementId: ElementRef })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(DEMO_MAX_CREW)
      .refine(
        (rows) => new Set(rows.map((r) => castNameKey(r.name))).size === rows.length,
        'Names must be unique.',
      ),
    calls: z
      .array(
        z
          .object({
            date: z.iso.date(),
            dayCall: ScheduleTime.describe("The day's call: two days may share a date."),
            name: z.string().min(1).max(120),
            call: ScheduleTime.nullable(),
            pickup: z.string().max(1000).nullable(),
            absent: z.boolean().optional(),
          })
          .strict(),
      )
      .max(500)
      .refine(
        (calls) =>
          new Set(calls.map((c) => `${c.date} ${c.dayCall} ${castNameKey(c.name)}`)).size ===
          calls.length,
        'One call per row and day.',
      ),
  })
  .strict();
export type DemoCrew = z.infer<typeof DemoCrew>;

/** The crew file of a demo archive: `last-train.inkadra` has `last-train.crew.json`. */
export const crewFileOf = (archive: string) => `${archive.replace(/\.inkadra$/, '')}.crew.json`;

/** Reads the crew file of an archive, or null when it has none. */
export async function readDemoCrew(archive: string): Promise<DemoCrew | null> {
  let text: string;
  try {
    text = await readFile(crewFileOf(archive), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return DemoCrew.parse(JSON.parse(text));
}

/**
 * Writes a sample's Troupe and day calls into the project a sandbox just imported, before its
 * days move to today. Rows link no account; a character whose board is not in the project is
 * left unlinked, and a call whose day or row is missing is dropped.
 */
export async function applyDemoCrew(db: Database, projectId: string, crew: DemoCrew) {
  await db.transaction(async (tx) => {
    const boards = await tx
      .select({ id: board.id, title: board.title })
      .from(board)
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)));
    const boardOf = new Map(boards.map((b) => [b.title, b.id]));
    const rows = crew.crew.length
      ? await tx
          .insert(crewMember)
          .values(
            crew.crew.map(({ character, ...row }, position) => {
              const boardId = character ? boardOf.get(character.board) : undefined;
              return {
                ...row,
                projectId,
                position,
                userId: null,
                character:
                  boardId && character ? { boardId, elementId: character.elementId } : null,
              };
            }),
          )
          .returning({ id: crewMember.id, name: crewMember.name })
      : [];
    const idOf = new Map(rows.map((r) => [castNameKey(r.name), r.id]));
    const days = await tx
      .select({ id: shootingDay.id, date: shootingDay.date, callTime: shootingDay.callTime })
      .from(shootingDay)
      .where(eq(shootingDay.projectId, projectId));
    for (const day of days) {
      const calls: DayCall[] = crew.calls.flatMap((c) => {
        const crewMemberId = idOf.get(castNameKey(c.name));
        if (c.date !== day.date || c.dayCall !== day.callTime || !crewMemberId) return [];
        return [
          {
            crewMemberId,
            call: c.call,
            pickup: c.pickup,
            ...(c.absent === undefined ? {} : { absent: c.absent }),
          },
        ];
      });
      if (calls.length)
        await tx.update(shootingDay).set({ calls }).where(eq(shootingDay.id, day.id));
    }
  });
}
