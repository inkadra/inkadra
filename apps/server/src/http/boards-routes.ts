import { createHash } from 'node:crypto';
import {
  API_PREFIX,
  atLeast,
  Id as AssetId,
  CAPABILITY_ROLE,
  type Board,
  type BoardColumns,
  type BoardDetail,
  type ClipBoard,
  ClipBoardQuery,
  CreateBoard,
  Id,
  type ProjectRole,
  type RecentBoard,
  RecentBoardQuery,
  UpdateBoard,
  z,
} from '@inkadra/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import {
  type BoardAccess,
  boardRoles,
  effectiveRole,
  effectiveRoles,
  projectGrants,
  projectRole,
  requireBoardRole,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import { type BoardReader, storedColumns } from '../board-content.ts';
import { boardCounts, projectPreview } from '../board-preview.ts';
import type { Database } from '../db/client.ts';
import { asset, board, boardDoc, clipBoardUse, project } from '../db/schema.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
  /** Reads the live document; without it, the stored one is read. */
  boardReader?: BoardReader;
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

  app.get(v1('/boards/:boardId/preview'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
    // Reauthorize every request. Browser revalidation avoids stale previews after edits or revocation.
    reply.header('cache-control', 'private, no-cache');
    const preview = projectPreview(row?.state);
    const [metadata] = await db.select().from(board).where(eq(board.id, boardId));
    const candidates = [...new Set([metadata?.coverAssetId, ...preview.assetIds])].filter(
      (id): id is string => AssetId.safeParse(id).success,
    );
    // Cover references and imported documents cannot expose files from another project.
    const files = candidates.length
      ? await db
          .select({ id: asset.id })
          .from(asset)
          .where(
            and(
              inArray(asset.id, candidates),
              eq(asset.projectId, access.board.projectId),
              eq(asset.status, 'ready'),
              inArray(asset.kind, ['image', 'video']),
            ),
          )
      : [];
    const allowed = new Set(files.map((f) => f.id));
    const body = { ...preview, assetIds: candidates.filter((id) => allowed.has(id)).slice(0, 4) };
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
    reply.header('etag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return body;
  });

  app.get(v1('/me/clip-boards'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { limit } = ClipBoardQuery.parse(req.query ?? {});
    const rows = await db
      .select({ board, projectName: project.name, usedAt: clipBoardUse.usedAt })
      .from(clipBoardUse)
      .innerJoin(board, eq(board.id, clipBoardUse.boardId))
      .innerJoin(project, and(eq(project.id, board.projectId), isNull(project.archivedAt)))
      .where(and(eq(clipBoardUse.userId, actor.id), isNull(board.deletedAt)))
      .orderBy(desc(clipBoardUse.usedAt), asc(board.id));
    const roles = await boardRoles(
      db,
      actor,
      rows.map((r) => r.board.id),
    );
    const items: ClipBoard[] = rows.flatMap((r) => {
      const myRole = roles.get(r.board.id);
      // Only boards the caller can still clip into: a viewer cannot be a destination.
      return myRole && atLeast(myRole, CAPABILITY_ROLE.edit)
        ? [
            {
              id: r.board.id,
              projectId: r.board.projectId,
              title: r.board.title,
              projectName: r.projectName,
              myRole,
              usedAt: iso(r.usedAt),
            },
          ]
        : [];
    });
    return { items: items.slice(0, limit) };
  });

  app.delete(v1('/me/clip-boards/:boardId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    // Idempotent, including boards the caller can no longer open.
    await db
      .delete(clipBoardUse)
      .where(and(eq(clipBoardUse.userId, actor.id), eq(clipBoardUse.boardId, boardId)));
    return reply.status(204).send();
  });

  app.get(v1('/me/recent-boards'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { limit } = RecentBoardQuery.parse(req.query ?? {});
    // Document edits move board_doc.updated_at only; renames and moves move the board's own.
    const editedAt = sql<Date>`greatest(${board.updatedAt}, coalesce(${boardDoc.updatedAt}, ${board.updatedAt}))`;
    const rows = await db
      .select({ board, projectName: project.name, editedAt })
      .from(board)
      .innerJoin(project, and(eq(project.id, board.projectId), isNull(project.archivedAt)))
      .leftJoin(boardDoc, eq(boardDoc.boardId, board.id))
      .where(
        and(
          isNull(board.deletedAt),
          sql`(exists (select 1 from project_member m
              where m.project_id = ${board.projectId} and m.user_id = ${actor.id})
            or ${board.id} in (
              with recursive granted as (
                select g.board_id as id from board_grant g where g.user_id = ${actor.id}
                union
                select c.id from board c join granted on c.parent_board_id = granted.id
              )
              select id from granted))`,
        ),
      )
      .orderBy(desc(editedAt), asc(board.id))
      .limit(limit);
    // The same rule as opening the board decides the role shown, and leaves out the rest.
    const roles = await boardRoles(
      db,
      actor,
      rows.map((r) => r.board.id),
    );
    const items: RecentBoard[] = [];
    for (const r of rows) {
      const role = roles.get(r.board.id);
      if (!role) continue;
      items.push({
        ...toBoard(r.board, role),
        projectName: r.projectName,
        editedAt: iso(new Date(r.editedAt)),
      });
    }
    return { items, nextCursor: null };
  });

  app.get(v1('/projects/:projectId/boards'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const [pRole, grants] = await Promise.all([
      projectRole(db, actor, projectId),
      projectGrants(db, actor, projectId),
    ]);
    if (!pRole && grants.size === 0) throw new HttpError('not_found', 'Project not found.');
    const rows = await db
      .select({
        board,
        editedAt: sql<Date>`greatest(${board.updatedAt}, coalesce(${boardDoc.updatedAt}, ${board.updatedAt}))`,
      })
      .from(board)
      .leftJoin(boardDoc, eq(boardDoc.boardId, board.id))
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)))
      .orderBy(asc(board.position), asc(board.id));
    const roles = effectiveRoles(
      rows.map((r) => r.board),
      grants,
      pRole,
    );
    // People with grants only get the subtrees they can open.
    const items = rows.flatMap((r) => {
      const role = roles.get(r.board.id)?.role;
      return role ? [{ ...toBoard(r.board, role), editedAt: iso(new Date(r.editedAt)) }] : [];
    });
    return { items };
  });

  app.get(v1('/projects/:projectId/board-counts'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const [pRole, grants] = await Promise.all([
      projectRole(db, actor, projectId),
      projectGrants(db, actor, projectId),
    ]);
    if (!pRole && grants.size === 0) throw new HttpError('not_found', 'Project not found.');
    const rows = await db
      .select({ board, state: boardDoc.state })
      .from(board)
      .leftJoin(boardDoc, eq(boardDoc.boardId, board.id))
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)));
    const roles = effectiveRoles(
      rows.map((r) => r.board),
      grants,
      pRole,
    );
    // Same visibility as the board list: only boards the caller can open.
    const items = rows.flatMap((r) =>
      roles.get(r.board.id)?.role
        ? [{ boardId: r.board.id, ...boardCounts(r.state ?? undefined) }]
        : [],
    );
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

  app.get(v1('/boards/:boardId/columns'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'viewer');
    // The live document has the columns added since the last store; the stored one is a
    // fallback the contract allows, when collab cannot be asked in time.
    let items = await deps.boardReader?.columns(boardId).catch((err) => {
      req.log.warn({ err, boardId }, 'live columns not read: using the stored document');
      return undefined;
    });
    items ??= await storedColumns(db, boardId);
    const body: BoardColumns = { items };
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
