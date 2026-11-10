import {
  API_PREFIX,
  castNameKey,
  EditSchedule,
  Id,
  MyScheduleQuery,
  type PlannedShootingDay,
  SetCastLink,
  SetDayAttendance,
  ShootingDayInput,
  scheduleTimes,
  UpdateShootingDay,
  z,
} from '@inkadra/shared';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { atLeast, boardRolesForPeople, live, requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import {
  board,
  castLink,
  project,
  shootingDay,
  shootingDayAttendance,
  user,
} from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

const BoardParams = z.object({ boardId: Id });
const DayParams = BoardParams.extend({ dayId: Id });
const Revision = z.object({ revision: z.number().int().min(1) }).strict();
const publicDay = ({
  createdAt: _created,
  updatedAt: _updated,
  ...row
}: typeof shootingDay.$inferSelect) => row;

/** When each linked person is first called on a day, in minutes from the shooting date. */
function firstCalls(
  day: Pick<ShootingDayInput, 'callTime' | 'blocks'>,
  links: ReadonlyArray<{ castKey: string; userId: string }>,
) {
  const owners = new Map(links.map((link) => [link.castKey, link.userId]));
  const first = new Map<string, number>();
  for (const { block, start } of scheduleTimes(day)) {
    for (const name of block.cast) {
      const userId = owners.get(castNameKey(name));
      if (userId && start < (first.get(userId) ?? Number.POSITIVE_INFINITY))
        first.set(userId, start);
    }
  }
  return first;
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  { db, auth }: { db: Database; auth: Auth },
) {
  // Decision 0022: a cross-board overview checks every day's board like the board's own list.
  // Every role permits reading, so a board opens with a project role or a grant on it or on
  // one of its ancestors (trashed ones included, as in boardAccess); filtering here keeps the
  // days of boards the person cannot open from being loaded at all.
  app.get(`${API_PREFIX}/me/shooting-days`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { from, to } = MyScheduleQuery.parse(req.query ?? {});
    // The readable board ids are computed first, so shooting_day is probed through its
    // (board_id, date) index instead of being scanned across every project's history.
    const readable = sql`array(
      with recursive granted as (
        select g.board_id as id from board_grant g where g.user_id = ${actor.id} and ${live('g')}
        union
        select c.id from board c join granted on c.parent_board_id = granted.id
      )
      select id from granted
      union
      select b.id from board b join project_member m on m.project_id = b.project_id
        where m.user_id = ${actor.id} and ${live('m')}
    )`;
    const rows = await db
      .select({ day: shootingDay, boardTitle: board.title, projectName: project.name })
      .from(shootingDay)
      .innerJoin(board, and(eq(board.id, shootingDay.boardId), isNull(board.deletedAt)))
      .innerJoin(project, and(eq(project.id, board.projectId), isNull(project.archivedAt)))
      .where(
        and(
          sql`${shootingDay.boardId} = any(${readable})`,
          gte(shootingDay.date, from),
          lte(shootingDay.date, to),
        ),
      )
      .orderBy(asc(shootingDay.date), asc(shootingDay.callTime), asc(shootingDay.id));
    const items: PlannedShootingDay[] = rows.map((r) => ({
      ...publicDay(r.day),
      boardTitle: r.boardTitle,
      projectName: r.projectName,
    }));
    return { items, nextCursor: null };
  });
  const savedBy = async (id: string) => {
    const [person] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, id));
    if (!person) throw new Error('Schedule author missing');
    return person;
  };
  const base = `${API_PREFIX}/boards/:boardId/schedule`;
  app.get(base, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'viewer');
    const rows = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.boardId, boardId))
      .orderBy(asc(shootingDay.date), asc(shootingDay.id));
    return { items: rows.map(publicDay), nextCursor: null };
  });
  app.post(base, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const input = ShootingDayInput.parse(req.body);
    const [row] = await db
      .insert(shootingDay)
      .values({
        ...input,
        boardId,
        projectId: access.board.projectId,
        updatedBy: await savedBy(actor.id),
      })
      .returning();
    if (!row) throw new Error('Shooting day missing');
    return reply.code(201).send(publicDay(row));
  });
  // People who cannot edit the schedule only learn about themselves. A person whose access
  // ended keeps their rows, in case it comes back, but drops out of the answer.
  app.get(`${base}/attendance`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const canManage = atLeast(access.role, 'editor');
    const mine = (column: typeof castLink.userId | typeof shootingDayAttendance.userId) =>
      canManage ? undefined : eq(column, actor.id);
    const [links, responses] = await Promise.all([
      db
        .select({ castKey: castLink.castKey, userId: castLink.userId })
        .from(castLink)
        .where(and(eq(castLink.boardId, boardId), mine(castLink.userId))),
      db
        .select({
          dayId: shootingDayAttendance.dayId,
          userId: shootingDayAttendance.userId,
          status: shootingDayAttendance.status,
        })
        .from(shootingDayAttendance)
        .innerJoin(shootingDay, eq(shootingDay.id, shootingDayAttendance.dayId))
        .where(and(eq(shootingDay.boardId, boardId), mine(shootingDayAttendance.userId))),
    ]);
    const roles = await boardRolesForPeople(db, boardId, [
      ...links.map((link) => link.userId),
      ...responses.map((response) => response.userId),
    ]);
    return {
      canManage,
      links: links.filter((link) => roles.has(link.userId)),
      responses: responses.filter((response) => roles.has(response.userId)),
    };
  });
  app.put(`${base}/cast-links`, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const { name, userId } = SetCastLink.parse(req.body);
    const castKey = castNameKey(name);
    if (!userId) {
      await db
        .delete(castLink)
        .where(and(eq(castLink.boardId, boardId), eq(castLink.castKey, castKey)));
      return reply.code(204).send();
    }
    const roles = await boardRolesForPeople(db, boardId, [userId]);
    if (!roles.has(userId))
      throw new HttpError('bad_request', 'That person has no access to this board.');
    await db
      .insert(castLink)
      .values({ boardId, castKey, userId })
      .onConflictDoUpdate({
        target: [castLink.boardId, castLink.castKey],
        set: { userId, updatedAt: sql`now()` },
      });
    return reply.code(204).send();
  });
  // The person answering is always the signed-in one: the request cannot name anybody else.
  app.put(`${base}/:dayId/attendance`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, dayId } = DayParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'viewer');
    const { status } = SetDayAttendance.parse(req.body);
    const [day] = await db
      .select({ blocks: shootingDay.blocks })
      .from(shootingDay)
      .where(and(eq(shootingDay.id, dayId), eq(shootingDay.boardId, boardId)));
    if (!day) throw new HttpError('not_found', 'Shooting day not found.');
    const links = await db
      .select({ castKey: castLink.castKey })
      .from(castLink)
      .where(and(eq(castLink.boardId, boardId), eq(castLink.userId, actor.id)));
    const cast = new Set(day.blocks.flatMap((block) => block.cast.map(castNameKey)));
    if (!links.some((link) => cast.has(link.castKey)))
      throw new HttpError('forbidden', 'Only people called on this day can answer.');
    await db
      .insert(shootingDayAttendance)
      .values({ dayId, userId: actor.id, status })
      .onConflictDoUpdate({
        target: [shootingDayAttendance.dayId, shootingDayAttendance.userId],
        set: { status, updatedAt: sql`now()` },
      });
    return { dayId, userId: actor.id, status };
  });
  type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
  const updateDay = async (
    tx: Transaction,
    boardId: string,
    dayId: string,
    revision: number,
    input: ShootingDayInput,
    updatedBy: { id: string; name: string },
  ) => {
    const where = and(
      eq(shootingDay.id, dayId),
      eq(shootingDay.boardId, boardId),
      eq(shootingDay.revision, revision),
    );
    const [before] = await tx
      .select({
        date: shootingDay.date,
        callTime: shootingDay.callTime,
        blocks: shootingDay.blocks,
      })
      .from(shootingDay)
      .where(where)
      .for('update');
    if (!before)
      throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
    const [updated] = await tx
      .update(shootingDay)
      .set({ ...input, updatedBy, revision: sql`${shootingDay.revision} + 1` })
      .where(where)
      .returning();
    if (!updated)
      throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
    // An answer was given for a time: when that time moves, the question is open again.
    const ofDay = eq(shootingDayAttendance.dayId, dayId);
    if (before.date !== input.date || before.callTime !== input.callTime) {
      await tx.delete(shootingDayAttendance).where(ofDay);
      return updated;
    }
    const links = await tx
      .select({ castKey: castLink.castKey, userId: castLink.userId })
      .from(castLink)
      .where(eq(castLink.boardId, boardId));
    const was = firstCalls(before, links);
    const now = firstCalls(input, links);
    const moved = [...new Set([...was.keys(), ...now.keys()])].filter(
      (userId) => was.get(userId) !== now.get(userId),
    );
    if (moved.length)
      await tx
        .delete(shootingDayAttendance)
        .where(and(ofDay, inArray(shootingDayAttendance.userId, moved)));
    return updated;
  };
  app.put(`${base}/:dayId`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, dayId } = DayParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const { revision, ...input } = UpdateShootingDay.parse(req.body);
    const updatedBy = await savedBy(actor.id);
    const row = await db.transaction((tx) =>
      updateDay(tx, boardId, dayId, revision, input, updatedBy),
    );
    return publicDay(row);
  });
  app.post(`${base}/edit`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const { changes } = EditSchedule.parse(req.body);
    const updatedBy = await savedBy(actor.id);
    return db.transaction(async (tx) => {
      const items = [];
      const deleted = [];
      // Lock in a stable order so simultaneous cross-day moves cannot deadlock.
      for (const change of [...changes].sort((a, b) => a.id.localeCompare(b.id))) {
        if (change.revision === 0) {
          if (!change.input) {
            deleted.push(change.id);
            continue;
          }
          const [row] = await tx
            .insert(shootingDay)
            .values({
              ...change.input,
              id: change.id,
              boardId,
              projectId: access.board.projectId,
              updatedBy,
            })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new HttpError('conflict', 'The day already exists. Reload the schedule.');
          items.push(publicDay(row));
        } else if (change.input) {
          items.push(
            publicDay(
              await updateDay(tx, boardId, change.id, change.revision, change.input, updatedBy),
            ),
          );
        } else {
          const removed = await tx
            .delete(shootingDay)
            .where(
              and(
                eq(shootingDay.id, change.id),
                eq(shootingDay.boardId, boardId),
                eq(shootingDay.revision, change.revision),
              ),
            )
            .returning({ id: shootingDay.id });
          if (!removed.length)
            throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
          deleted.push(change.id);
        }
      }
      return { items, deleted };
    });
  });
  app.delete(`${base}/:dayId`, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, dayId } = DayParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const { revision } = Revision.parse(req.body);
    const rows = await db
      .delete(shootingDay)
      .where(
        and(
          eq(shootingDay.id, dayId),
          eq(shootingDay.boardId, boardId),
          eq(shootingDay.revision, revision),
        ),
      )
      .returning({ id: shootingDay.id });
    if (!rows.length)
      throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
    return reply.code(204).send();
  });
}
