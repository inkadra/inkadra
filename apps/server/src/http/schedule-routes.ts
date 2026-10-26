import { API_PREFIX, Id, ShootingDayInput, UpdateShootingDay, z } from '@inkadra/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { shootingDay } from '../db/schema.ts';
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
