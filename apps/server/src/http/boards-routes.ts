import {
  API_PREFIX,
  type Board,
  type BoardDetail,
  CreateBoard,
  Id,
  type ProjectRole,
  UpdateBoard,
  z,
} from '@inkadra/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import {
  type BoardAccess,
  effectiveRole,
  effectiveRoles,
  projectGrants,
  projectRole,
  requireBoardRole,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset, board } from '../db/schema.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
}

const ProjectParams = z.object({ projectId: Id });
const BoardParams = z.object({ boardId: Id });

export function toBoard(row: typeof board.$inferSelect, myRole: ProjectRole): Board {
  return {
    id: row.id,
    projectId: row.projectId,
    parentBoardId: row.parentBoardId,
    kind: row.kind,
    title: row.title,
    position: row.position,
    coverAssetId: row.coverAssetId,
    docSchemaVersion: row.docSchemaVersion,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    myRole,
  };
}

/** Ids of a board and every board below it, trashed ones included. */
async function subtreeIds(db: Pick<Database, 'execute'>, boardId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive tree as (
      select id from board where id = ${boardId}
      union all
      select b.id from board b join tree t on b.parent_board_id = t.id
    )
    select id from tree`);
  return rows.map((r) => r.id);
}

/** From the first board the person can open down to the board's parent. */
function breadcrumb(access: BoardAccess) {
  const ids = access.chain.map((c) => c.id);
  return access.chain
    .slice(1)
    .filter((_, i) => effectiveRole(ids.slice(i + 1), access.grants, access.projectRole).role)
    .reverse();
}

async function lastChildPosition(db: Pick<Database, 'select'>, parentBoardId: string) {
  const [last] = await db
    .select({ position: board.position })
    .from(board)
    .where(and(eq(board.parentBoardId, parentBoardId), isNull(board.deletedAt)))
    .orderBy(desc(board.position))
    .limit(1);
  return last?.position ?? null;
}

export function registerBoardRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/projects/:projectId/boards'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const [pRole, grants] = await Promise.all([
      projectRole(db, actor, projectId),
      projectGrants(db, actor, projectId),
    ]);
    if (!pRole && grants.size === 0) throw new HttpError('not_found', 'Project not found.');
    const rows = await db
      .select()
      .from(board)
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)))
      .orderBy(asc(board.position), asc(board.id));
    const roles = effectiveRoles(rows, grants, pRole);
    // People with grants only get the subtrees they can open.
    const items = rows.flatMap((r) => {
      const role = roles.get(r.id)?.role;
      return role ? [toBoard(r, role)] : [];
    });
    return { items };
  });

  app.post(v1('/projects/:projectId/boards'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const input = CreateBoard.parse(req.body);
    const parent = await requireBoardRole(db, actor, input.parentBoardId, 'editor');
    if (parent.board.projectId !== projectId)
      throw new HttpError('bad_request', 'The parent board is not in this project.');
    const row = await db.transaction(async (tx) => {
      const position = generateKeyBetween(await lastChildPosition(tx, input.parentBoardId), null);
      const [created] = await tx
        .insert(board)
        .values({
          projectId,
          parentBoardId: input.parentBoardId,
          kind: input.kind,
          title: input.title,
          position,
          createdBy: actor.id,
        })
        .returning();
      if (!created) throw new Error('Board insert returned nothing');
      return created;
    });
    // A new board inherits from its parent, so the parent's role applies.
    return reply.status(201).send(toBoard(row, parent.role));
  });

  app.get(v1('/boards/:boardId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const body: BoardDetail = {
      ...toBoard(access.board, access.role),
      breadcrumb: breadcrumb(access),
    };
    return body;
  });

  app.patch(v1('/boards/:boardId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const patch = UpdateBoard.parse(req.body ?? {});
    const { board: current, role } = await requireBoardRole(db, actor, boardId, 'editor');
    const set: Partial<typeof board.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.coverAssetId !== undefined) {
      if (patch.coverAssetId !== null) {
        const [cover] = await db
          .select({ id: asset.id })
          .from(asset)
          .where(and(eq(asset.id, patch.coverAssetId), eq(asset.projectId, current.projectId)));
        if (!cover)
          throw new HttpError('bad_request', 'The cover is not an asset of this project.');
      }
      set.coverAssetId = patch.coverAssetId;
    }
    if (patch.parentBoardId !== undefined && patch.parentBoardId !== current.parentBoardId) {
      if (current.parentBoardId === null)
        throw new HttpError('bad_request', 'The root board cannot be moved.');
      const target = await requireBoardRole(db, actor, patch.parentBoardId, 'editor');
      if (target.board.projectId !== current.projectId)
        throw new HttpError('bad_request', 'The parent board is not in this project.');
      if ((await subtreeIds(db, boardId)).includes(patch.parentBoardId))
        throw new HttpError('bad_request', 'A board cannot move inside itself.');
      set.parentBoardId = patch.parentBoardId;
      if (patch.position === undefined)
        set.position = generateKeyBetween(await lastChildPosition(db, patch.parentBoardId), null);
    }
    if (Object.keys(set).length === 0) return toBoard(current, role);
    const [row] = await db.update(board).set(set).where(eq(board.id, boardId)).returning();
    if (!row) throw new HttpError('not_found', 'Board not found.');
    return toBoard(row, role);
  });

  app.delete(v1('/boards/:boardId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const { board: current } = await requireBoardRole(db, actor, boardId, 'editor');
    if (current.parentBoardId === null)
      throw new HttpError('bad_request', 'The root board cannot be deleted.');
    await db.transaction(async (tx) => {
      const ids = await subtreeIds(tx, boardId);
      // Boards already in the trash keep their own deletion time.
      await tx
        .update(board)
        .set({ deletedAt: new Date() })
        .where(and(inArray(board.id, ids), isNull(board.deletedAt)));
    });
    return reply.status(204).send();
  });
}
