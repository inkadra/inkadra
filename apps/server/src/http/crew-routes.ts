import {
  API_PREFIX,
  BulkCreateCrew,
  type CrewCharacter,
  CrewMemberInput,
  Id,
  UpdateCrewMember,
  z,
} from '@inkadra/shared';
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { boardRoles, requireBoardRole, requireProjectRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import { type BoardReader, storedCharacters } from '../board-content.ts';
import type { Database } from '../db/client.ts';
import { board, crewMember, shootingDay, user } from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

const Params = z.object({ projectId: Id });
const MemberParams = Params.extend({ memberId: Id });
const Revision = z.object({ revision: z.number().int().min(1) }).strict();
const present = (row: typeof crewMember.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export function registerCrewRoutes(
  app: FastifyInstance,
  { db, auth, boardReader }: { db: Database; auth: Auth; boardReader?: BoardReader },
) {
  const base = `${API_PREFIX}/projects/:projectId/crew`;
  /** Every response carries the same shape as the list: the row and its linked account. */
  const readCrew = async (where: SQL | undefined) =>
    (
      await db
        .select({
          member: crewMember,
          account: { id: user.id, name: user.name, image: user.image },
        })
        .from(crewMember)
        .leftJoin(user, eq(user.id, crewMember.userId))
        .where(where)
        .orderBy(asc(crewMember.position), asc(crewMember.id))
    ).map((r) => ({ ...present(r.member), account: r.account }));
  const readRows = (rows: Array<{ id: string }>) =>
    rows.length
      ? readCrew(
          inArray(
            crewMember.id,
            rows.map((r) => r.id),
          ),
        )
      : Promise.resolve([]);
  const characters = (boardId: string) =>
    boardReader?.characters ? boardReader.characters(boardId) : storedCharacters(db, boardId);
  // Project membership is intentional: a grant on one board must not disclose project contacts.
  const validateLinks = async (
    actor: Awaited<ReturnType<typeof requireActor>>,
    projectId: string,
    input: z.infer<typeof CrewMemberInput>,
    stored?: typeof crewMember.$inferSelect,
  ) => {
    if (input.userId) {
      const [account] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!account) throw new HttpError('bad_request', 'Account not found.');
    }
    // An unchanged link to a card deleted since stays savable: the inspector offers Unlink.
    const unchanged =
      stored?.character?.boardId === input.character?.boardId &&
      stored?.character?.elementId === input.character?.elementId;
    if (input.character && !unchanged) {
      const access = await requireBoardRole(db, actor, input.character.boardId, 'viewer');
      if (access.board.projectId !== projectId)
        throw new HttpError('bad_request', 'Character board belongs to another project.');
      if (
        !(await characters(input.character.boardId)).some(
          (c) => c.elementId === input.character?.elementId,
        )
      )
        throw new HttpError('bad_request', 'Character not found.');
    }
  };
  app.get(`${base}/characters`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = Params.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'viewer');
    const boards = await db
      .select({ id: board.id })
      .from(board)
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)));
    const roles = await boardRoles(
      db,
      actor,
      boards.map((row) => row.id),
    );
    const items: CrewCharacter[] = [];
    for (const row of boards) if (roles.has(row.id)) items.push(...(await characters(row.id)));
    return { items };
  });
  app.get(base, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = Params.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'viewer');
    return { items: await readCrew(eq(crewMember.projectId, projectId)), nextCursor: null };
  });
  app.post(base, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = Params.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'editor');
    const input = CrewMemberInput.parse(req.body);
    await validateLinks(actor, projectId, input);
    const [row] = await db
      .insert(crewMember)
      .values({ ...input, projectId })
      .returning();
    if (!row) throw new Error('Crew member missing');
    return reply.code(201).send((await readRows([row]))[0]);
  });
  app.post(`${base}/bulk`, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = Params.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'editor');
    const { items } = BulkCreateCrew.parse(req.body);
    for (const input of items) await validateLinks(actor, projectId, input);
    // Serialize bulk pastes per project, including duplicate detection within the same paste.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
      const existing = await tx
        .select({ name: crewMember.name })
        .from(crewMember)
        .where(eq(crewMember.projectId, projectId));
      const names = new Set(existing.map((r) => r.name.trim().toLowerCase()));
      const values = items
        .filter((r) => {
          const key = r.name.trim().toLowerCase();
          if (names.has(key)) return false;
          names.add(key);
          return true;
        })
        .map((input) => ({ ...input, projectId }));
      return values.length ? tx.insert(crewMember).values(values).returning() : [];
    });
    return reply.code(201).send({ items: await readRows(rows), nextCursor: null });
  });
  app.put(`${base}/:memberId`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId, memberId } = MemberParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'editor');
    const { revision, ...input } = UpdateCrewMember.parse(req.body);
    const [stored] = await db
      .select()
      .from(crewMember)
      .where(and(eq(crewMember.projectId, projectId), eq(crewMember.id, memberId)));
    if (!stored) throw new HttpError('not_found', 'Crew member not found.');
    await validateLinks(actor, projectId, input, stored);
    const [row] = await db
      .update(crewMember)
      .set({ ...input, revision: revision + 1, updatedAt: sql`now()` })
      .where(
        and(
          eq(crewMember.projectId, projectId),
          eq(crewMember.id, memberId),
          eq(crewMember.revision, revision),
        ),
      )
      .returning();
    if (row) return (await readRows([row]))[0];
    const [current] = await readCrew(
      and(eq(crewMember.projectId, projectId), eq(crewMember.id, memberId)),
    );
    if (!current) throw new HttpError('not_found', 'Crew member not found.');
    throw new HttpError('conflict', 'Crew member changed by another person.', { current });
  });
  app.delete(`${base}/:memberId`, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId, memberId } = MemberParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'editor');
    const { revision } = Revision.parse(req.body);
    await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crewMember)
      .where(
        and(
          eq(crewMember.projectId, projectId),
          eq(crewMember.id, memberId),
          eq(crewMember.revision, revision),
        ),
      )
      .returning();
    if (!row) {
      const [current] = await db
        .select({ id: crewMember.id })
        .from(crewMember)
        .where(and(eq(crewMember.projectId, projectId), eq(crewMember.id, memberId)));
      throw new HttpError(current ? 'conflict' : 'not_found', 'Crew member changed or removed.');
    }
    await tx.update(shootingDay).set({
      calls: sql`coalesce((select jsonb_agg(call) from jsonb_array_elements(${shootingDay.calls}) as call where call->>'crewMemberId' <> ${memberId}), '[]'::jsonb)`,
      revision: sql`${shootingDay.revision} + 1`,
    }).where(and(eq(shootingDay.projectId, projectId), sql`${shootingDay.calls} @> ${JSON.stringify([{ crewMemberId: memberId }])}::jsonb`));
    });
    return reply.code(204).send();
  });
}
