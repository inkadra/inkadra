import {
  API_PREFIX,
  castNameKey,
  clockMinutes,
  EditSchedule,
  Id,
  MyScheduleQuery,
  type PlannedShootingDay,
  type ScheduleBlock,
  SetCastLink,
  SetDayAttendance,
  ShootingDayInput,
  scheduleTimes,
  UpdateShootingDay,
  z,
} from '@inkadra/shared';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  type Actor,
  atLeast,
  boardRolesForPeople,
  live,
  projectRole,
  requireBoardRole,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import type { BoardReader } from '../board-content.ts';
import {
  cardBoards,
  castLinksOf,
  characterCards,
  crewCastKeys,
  linkCastName,
} from '../cast-crew.ts';
import type { Database } from '../db/client.ts';
import {
  board,
  crewMember,
  project,
  shootingDay,
  shootingDayAttendance,
  user,
} from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { idempotentCreation } from './idempotency.ts';

const BoardParams = z.object({ boardId: Id });
const DayParams = BoardParams.extend({ dayId: Id });
const Revision = z.object({ revision: z.number().int().min(1) }).strict();
/**
 * Per-person calls and block notes are crew data (decisions 0091, 0092): only project members see them. A grant
 * on one board shows the plan without them, as it does not disclose the project roster.
 */
const publicDay = (
  { createdAt: _created, updatedAt: _updated, calls, ...row }: typeof shootingDay.$inferSelect,
  team: boolean,
) =>
  team
    ? { ...row, calls }
    : { ...row, blocks: row.blocks.map(({ notes: _notes, ...block }) => block) };
/** Project members only; for everyone else, calls and block notes on input are ignored. */
const ownInput = <T extends ShootingDayInput>(input: T, team: boolean): T => {
  if (team) return input;
  const { calls: _calls, ...rest } = input;
  return { ...rest, blocks: rest.blocks.map(({ notes: _notes, ...block }) => block) } as T;
};
const isTeam = async (db: Database, actor: Actor, projectId: string) =>
  (await projectRole(db, actor, projectId)) !== null;

/** The keys of a block that point at another board's frame or scene (decision 0123). */
const SHOT_KEYS = ['shotBoardId', 'shotLabel'] as const;
const SCENE_KEYS = ['sceneId', 'sceneBoardId', 'sceneLabel'] as const;

/**
 * A client from before block notes, or from before the Production board (decision 0123), sends
 * blocks without some keys: a block it kept keeps them, by block id. A newer client sends
 * `notes` (empty to clear it), so only a missing key is filled in. The board and label of a
 * frame are kept while the block still names that frame, those of a scene while it names that
 * scene or none.
 */
export function keepBlockKeys(
  before: ShootingDayInput['blocks'],
  after: ShootingDayInput['blocks'],
): ShootingDayInput['blocks'] {
  const stored = new Map(before.map((b) => [b.id, b]));
  return after.map((block) => {
    const was = stored.get(block.id);
    if (!was) return block;
    const kept: ScheduleBlock = { ...block };
    if (!('notes' in block) && was.notes !== undefined) kept.notes = was.notes;
    const fill = (keys: ReadonlyArray<(typeof SHOT_KEYS)[number] | (typeof SCENE_KEYS)[number]>) => {
      for (const key of keys)
        if (!(key in block) && was[key] !== undefined) Object.assign(kept, { [key]: was[key] });
    };
    if (block.shotId === was.shotId) fill(SHOT_KEYS);
    if ((block.sceneId ?? was.sceneId) === was.sceneId) fill(SCENE_KEYS);
    return kept;
  });
}

/**
 * A new or changed board reference of a block must name a board of the day's project (decision
 * 0123); one the stored block already had is kept, even to a board trashed since.
 */
async function checkBlockBoards(
  tx: Pick<Database, 'select'>,
  projectId: string,
  stored: ShootingDayInput['blocks'],
  blocks: ShootingDayInput['blocks'],
) {
  const refs = (b: ScheduleBlock) =>
    [b.shotBoardId, b.sceneBoardId].filter((id): id is string => id !== undefined);
  const had = new Set(stored.flatMap((b) => refs(b).map((id) => `${b.id}:${id}`)));
  const wanted = [
    ...new Set(blocks.flatMap((b) => refs(b).filter((id) => !had.has(`${b.id}:${id}`)))),
  ];
  if (!wanted.length) return;
  const found = await tx
    .select({ id: board.id })
    .from(board)
    .where(and(eq(board.projectId, projectId), inArray(board.id, wanted)));
  if (found.length !== wanted.length)
    throw new HttpError('bad_request', 'A block points at a board outside this project.');
}

/** When each linked person is first called on a day, in minutes from the shooting date. */
export function firstCalls(
  day: Pick<ShootingDayInput, 'callTime' | 'blocks'>,
  links: ReadonlyArray<{ castKey: string; userId: string }>,
) {
  // One name can belong to several people (two rows called "Bruno"): each gets its own time.
  const owners = new Map<string, string[]>();
  for (const link of links)
    owners.set(link.castKey, [...(owners.get(link.castKey) ?? []), link.userId]);
  const first = new Map<string, number>();
  for (const { block, start } of scheduleTimes(day)) {
    for (const name of block.cast) {
      for (const userId of owners.get(castNameKey(name)) ?? [])
        if (start < (first.get(userId) ?? Number.POSITIVE_INFINITY)) first.set(userId, start);
    }
  }
  return first;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function registerScheduleRoutes(
  app: FastifyInstance,
  { db, auth, boardReader }: { db: Database; auth: Auth; boardReader?: BoardReader },
) {
  /**
   * Drops calls to rows that are not in the project. Runs in the transaction that writes the
   * days: the referenced rows stay locked `for share` until it commits, so a merge or a delete of
   * a row (which locks it `for update` first) either waits and then finds the call, or runs first
   * and the call is dropped here. One sorted lock per request keeps a batch from deadlocking.
   */
  const cleanInputs = async <T extends ShootingDayInput>(
    tx: Transaction,
    inputs: T[],
    team: boolean,
    projectId: string,
  ) => {
    const clean = inputs.map((input) => ownInput(input, team));
    const calls = clean.flatMap((input) => input.calls ?? []);
    const wanted = [...new Set(calls.map((call) => call.crewMemberId))];
    if (!wanted.length) return clean;
    const members = await tx
      .select({ id: crewMember.id })
      .from(crewMember)
      .where(and(eq(crewMember.projectId, projectId), inArray(crewMember.id, wanted)))
      .orderBy(asc(crewMember.id))
      .for('share');
    const ids = new Set(members.map((member) => member.id));
    return clean.map((input) =>
      input.calls
        ? { ...input, calls: input.calls.filter((call) => ids.has(call.crewMemberId)) }
        : input,
    );
  };
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
    // Home shows no per-person calls, so nobody gets them from here.
    const items: PlannedShootingDay[] = rows.map((r) => ({
      ...publicDay(r.day, false),
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
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const team = await isTeam(db, actor, access.board.projectId);
    const rows = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.boardId, boardId))
      .orderBy(asc(shootingDay.date), asc(shootingDay.id));
    return { items: rows.map((row) => publicDay(row, team)), nextCursor: null };
  });
  app.post(base, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const team = await isTeam(db, actor, access.board.projectId);
    const parsed = ShootingDayInput.parse(req.body);
    const updatedBy = await savedBy(actor.id);
    const result = await idempotentCreation(
      db,
      req,
      actor.id,
      `shooting-days:${boardId}`,
      parsed,
      async (tx) => {
        const [input] = await cleanInputs(tx, [parsed], team, access.board.projectId);
        await checkBlockBoards(tx, access.board.projectId, [], parsed.blocks);
        const [created] = await tx
          .insert(shootingDay)
          .values({ ...(input ?? parsed), boardId, projectId: access.board.projectId, updatedBy })
          .returning();
        if (!created) throw new Error('Shooting day missing');
        return created;
      },
    );
    // A retry is answered with the day as it is now: 404 once it has been deleted.
    if ('replayed' in result) {
      const [now] = await db
        .select()
        .from(shootingDay)
        .where(and(eq(shootingDay.id, result.replayed), eq(shootingDay.boardId, boardId)));
      if (!now) throw new HttpError('not_found', 'Shooting day not found.');
      return reply.code(201).send(publicDay(now, team));
    }
    return reply.code(201).send(publicDay(result.created, team));
  });
  // People who cannot edit the schedule only learn about themselves. A person whose access
  // ended keeps their rows, in case it comes back, but drops out of the answer. The links come
  // from the crew (decision 0091): a grant on one board shows the caller's own only, as it does
  // not disclose the project roster.
  app.get(`${base}/attendance`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const canManage = atLeast(access.role, 'editor');
    const mine = (column: typeof shootingDayAttendance.userId) =>
      canManage ? undefined : eq(column, actor.id);
    const roster = canManage && (await isTeam(db, actor, access.board.projectId));
    const [links, responses] = await Promise.all([
      castLinksOf(db, boardReader, access.board.projectId, roster ? undefined : actor.id, actor),
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
  // Linking a cast name writes the crew (decision 0091), so it takes a project editor; the
  // route stays for older clients and for the presence panel.
  app.put(`${base}/cast-links`, async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const role = await projectRole(db, actor, access.board.projectId);
    if (!role || !atLeast(role, 'editor'))
      throw new HttpError('forbidden', 'Linking the cast edits the project crew.');
    const { name, userId } = SetCastLink.parse(req.body);
    if (userId) {
      const roles = await boardRolesForPeople(db, boardId, [userId]);
      if (!roles.has(userId))
        throw new HttpError('bad_request', 'That person has no access to this board.');
    }
    await db.transaction((tx) =>
      linkCastName(tx, boardReader, { projectId: access.board.projectId, boardId, name, userId }),
    );
    return reply.code(204).send();
  });
  // The person answering is always the signed-in one: the request cannot name anybody else.
  app.put(`${base}/:dayId/attendance`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, dayId } = DayParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const { status } = SetDayAttendance.parse(req.body);
    const [day] = await db
      .select({ blocks: shootingDay.blocks })
      .from(shootingDay)
      .where(and(eq(shootingDay.id, dayId), eq(shootingDay.boardId, boardId)));
    if (!day) throw new HttpError('not_found', 'Shooting day not found.');
    const links = await castLinksOf(db, boardReader, access.board.projectId, actor.id, actor);
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
  const updateDay = async (
    tx: Transaction,
    projectId: string,
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
        calls: shootingDay.calls,
      })
      .from(shootingDay)
      .where(where)
      .for('update');
    if (!before)
      throw new HttpError('conflict', 'The day changed or was removed. Reload the schedule.');
    const blocks = keepBlockKeys(before.blocks, input.blocks);
    await checkBlockBoards(tx, projectId, before.blocks, blocks);
    // Calls missing from the input are left as stored (older clients, people outside the project).
    const [updated] = await tx
      .update(shootingDay)
      .set({
        ...input,
        blocks,
        updatedBy,
        revision: sql`${shootingDay.revision} + 1`,
      })
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
    const links = await castLinksOf(tx, boardReader, projectId);
    const roster = await tx.select().from(crewMember).where(eq(crewMember.projectId, projectId));
    const allowed = await cardBoards(
      tx,
      projectId,
      roster.flatMap((row) => (row.character ? [row.character.boardId] : [])),
    );
    const keys = await crewCastKeys(roster, characterCards(tx, boardReader, allowed));
    const effective = (day: Pick<ShootingDayInput, 'callTime' | 'blocks' | 'calls'>) => {
      const result = firstCalls(day, links);
      // Match the crew's "Your call": the earliest called row for an account wins.
      for (const row of roster) if (row.userId) result.delete(row.userId);
      roster.forEach((row, i) => {
        if (!row.userId) return;
        const own = day.calls?.find((call) => call.crewMemberId === row.id);
        const cast =
          castNameKey(row.department) === 'cast' ||
          castNameKey(row.role) === 'cast' ||
          !!row.character;
        const usual =
          !cast ||
          day.blocks.some((block) => block.cast.some((name) => keys[i]?.has(castNameKey(name))));
        if (!(own?.absent === undefined ? usual : !own.absent)) return;
        const time = clockMinutes(own?.call ?? day.callTime);
        result.set(row.userId, Math.min(time, result.get(row.userId) ?? Infinity));
      });
      return result;
    };
    // Keep scene-time invalidation too: an answer also follows the first scheduled appearance.
    const wasScene = firstCalls(before, links);
    const nowScene = firstCalls(input, links);
    const was = effective(before);
    const now = effective(updated);
    const moved = [...new Set([...was.keys(), ...now.keys()])].filter(
      (userId) =>
        was.get(userId) !== now.get(userId) || wasScene.get(userId) !== nowScene.get(userId),
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
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const team = await isTeam(db, actor, access.board.projectId);
    const { revision, ...input } = UpdateShootingDay.parse(req.body);
    const updatedBy = await savedBy(actor.id);
    const row = await db.transaction(async (tx) => {
      const [clean] = await cleanInputs(tx, [input], team, access.board.projectId);
      const projectId = access.board.projectId;
      return updateDay(tx, projectId, boardId, dayId, revision, clean ?? input, updatedBy);
    });
    return publicDay(row, team);
  });
  app.post(`${base}/edit`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'editor');
    const team = await isTeam(db, actor, access.board.projectId);
    const { changes } = EditSchedule.parse(req.body);
    const updatedBy = await savedBy(actor.id);
    return db.transaction(async (tx) => {
      const items = [];
      const deleted = [];
      // Lock in a stable order so simultaneous cross-day moves cannot deadlock.
      const sorted = [...changes].sort((a, b) => a.id.localeCompare(b.id));
      const inputs = sorted.flatMap((change) => (change.input ? [change.input] : []));
      const cleaned = new Map(
        (await cleanInputs(tx, inputs, team, access.board.projectId)).map((clean, i) => [
          inputs[i],
          clean,
        ]),
      );
      const locked = await tx
        .select()
        .from(shootingDay)
        .where(
          and(
            eq(shootingDay.boardId, boardId),
            inArray(
              shootingDay.id,
              sorted.map((change) => change.id),
            ),
          ),
        )
        .orderBy(asc(shootingDay.id))
        .for('update');
      const notes = locked.flatMap((day) => day.blocks);
      for (const [original, clean] of cleaned) {
        cleaned.set(original, { ...clean, blocks: keepBlockKeys(notes, clean.blocks) });
      }
      for (const change of sorted) {
        if (change.revision === 0) {
          if (!change.input) {
            deleted.push(change.id);
            continue;
          }
          const input = cleaned.get(change.input) ?? change.input;
          // A block moved here from another day of the request keeps its references.
          await checkBlockBoards(tx, access.board.projectId, notes, input.blocks);
          const [row] = await tx
            .insert(shootingDay)
            .values({
              ...input,
              id: change.id,
              boardId,
              projectId: access.board.projectId,
              updatedBy,
            })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new HttpError('conflict', 'The day already exists. Reload the schedule.');
          items.push(publicDay(row, team));
        } else if (change.input) {
          items.push(
            publicDay(
              await updateDay(
                tx,
                access.board.projectId,
                boardId,
                change.id,
                change.revision,
                cleaned.get(change.input) ?? change.input,
                updatedBy,
              ),
              team,
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
