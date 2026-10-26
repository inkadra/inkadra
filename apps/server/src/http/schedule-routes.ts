import {
  API_PREFIX,
  Id,
  MyScheduleQuery,
  type PlannedShootingDay,
  ShootingDayInput,
  UpdateShootingDay,
  z,
} from '@inkadra/shared';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { boardRoles, requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { board, project, shootingDay } from '../db/schema.ts';
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

export function registerScheduleRoutes(
  app: FastifyInstance,
  { db, auth }: { db: Database; auth: Auth },
) {
  // Decision 0022: a cross-board overview checks every day's board like the board's own list.
  app.get(`${API_PREFIX}/me/shooting-days`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { from, to } = MyScheduleQuery.parse(req.query ?? {});
    const rows = await db
      .select({ day: shootingDay, boardTitle: board.title, projectName: project.name })
      .from(shootingDay)
      .innerJoin(board, and(eq(board.id, shootingDay.boardId), isNull(board.deletedAt)))
      .innerJoin(project, and(eq(project.id, shootingDay.projectId), isNull(project.archivedAt)))
      .where(
        and(
          gte(shootingDay.date, from),
          lte(shootingDay.date, to),
          sql`(exists (select 1 from project_member m
              where m.project_id = ${shootingDay.projectId} and m.user_id = ${actor.id})
            or exists (select 1 from board_grant g join board b on b.id = g.board_id
              where b.project_id = ${shootingDay.projectId} and g.user_id = ${actor.id}))`,
        ),
      )
      .orderBy(asc(shootingDay.date), asc(shootingDay.callTime), asc(shootingDay.id));
    const roles = await boardRoles(
      db,
      actor,
      rows.map((r) => r.day.boardId),
    );
    const items: PlannedShootingDay[] = rows
      .filter((r) => roles.has(r.day.boardId))
      .map((r) => ({ ...publicDay(r.day), boardTitle: r.boardTitle, projectName: r.projectName }));
    return { items, nextCursor: null };
  });
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
      .values({ ...input, boardId, projectId: access.board.projectId })
      .returning();
    if (!row) throw new Error('Shooting day missing');
    return reply.code(201).send(publicDay(row));
  });
  app.put(`${base}/:dayId`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, dayId } = DayParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const { revision, ...input } = UpdateShootingDay.parse(req.body);
    const [row] = await db
      .update(shootingDay)
      .set({ ...input, revision: sql`${shootingDay.revision} + 1` })
      .where(
        and(
          eq(shootingDay.id, dayId),
          eq(shootingDay.boardId, boardId),
          eq(shootingDay.revision, revision),
        ),
      )
      .returning();
    if (!row)
      throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
    return publicDay(row);
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
