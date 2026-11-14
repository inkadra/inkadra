import { createHash } from 'node:crypto';
import {
  API_PREFIX,
  Id as AssetId,
  atLeast,
  type Board,
  type BoardColumns,
  type BoardCount,
  type BoardDetail,
  type BoardPreview,
  CAPABILITY_ROLE,
  type ClipBoard,
  ClipBoardQuery,
  CreateBoard,
  Id,
  NEW_BOARD_VIEWS,
  OPTIONAL_VIEWS,
  type ProjectRole,
  type RecentBoard,
  RecentBoardQuery,
  ScheduleSourcesQuery,
  UpdateBoard,
  z,
} from '@inkadra/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import {
  type BoardAccess,
  boardRoles,
  effectiveRole,
  effectiveRoles,
  live,
  projectGrants,
  projectRole,
  requireBoardRole,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import {
  type BoardReader,
  type ScheduleSourceContent,
  scheduleSource,
  storedColumns,
} from '../board-content.ts';
import { boardCounts, projectBoard, unsortedOf } from '../board-preview.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  board,
  boardDoc,
  clipBoardUse,
  crewMember,
  project,
  shareLink,
  shootingDay,
} from '../db/schema.ts';
import {
  adoptDays,
  liveProductionBoard,
  lockProduction,
  nextShootingDay,
  productionBoardOf,
  todayIn,
} from '../production.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { idempotentCreation } from './idempotency.ts';
import { teamReviews } from './reviews-routes.ts';

interface Deps {
  db: Database;
  auth: Auth;
  /** Reads the live document; without it, the stored one is read. */
  boardReader?: BoardReader;
  config?: Pick<Config, 'DEMO_MODE'>;
}

/**
 * Boards a demo sandbox may have, those in the trash included (decision 0084): each can grow
 * to the demo's caps, so their number bounds what one sandbox can store.
 */
export const DEMO_MAX_BOARDS = 30;

const ProjectParams = z.object({ projectId: Id });

/**
 * Stored size of the storyboards one schedule-sources answer reads (#826): frames carry their
 * drawings, which the schedule shows, so the answer is bounded in bytes and the rest is asked for
 * again (`rest`). A board larger than the budget still comes, alone.
 */
export const SCHEDULE_SOURCES_BYTES = 8 * 1024 * 1024;
/** Summaries of stored documents kept between requests, by board and save, up to this size. */
const SUMMARY_CACHE_BYTES = 32 * 1024 * 1024;
const BoardParams = z.object({ boardId: Id });

export function toBoard(row: typeof board.$inferSelect, myRole: ProjectRole): Board {
  return {
    id: row.id,
    projectId: row.projectId,
    parentBoardId: row.parentBoardId,
    kind: row.kind,
    views: row.views ?? null,
    title: row.title,
    position: row.position,
    coverAssetId: row.coverAssetId,
    icon: row.icon ?? null,
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

/** Boards of a project the person belongs to, or under a board shared with them. */
const visibleTo = (userId: string) =>
  sql`(exists (select 1 from project_member m
      where m.project_id = ${board.projectId} and m.user_id = ${userId} and ${live('m')})
    or ${board.id} in (
      with recursive granted as (
        select g.board_id as id from board_grant g
        where g.user_id = ${userId} and ${live('g')}
        union
        select c.id from board c join granted on c.parent_board_id = granted.id
      )
      select id from granted))`;

/** Ready images and videos among `candidates` that belong to the project. */
async function projectMedia(db: Pick<Database, 'select'>, projectId: string, candidates: string[]) {
  const valid = candidates.filter((id) => AssetId.safeParse(id).success);
  if (valid.length === 0) return new Set<string>();
  const files = await db
    .select({ id: asset.id })
    .from(asset)
    .where(
      and(
        inArray(asset.id, valid),
        eq(asset.projectId, projectId),
        eq(asset.status, 'ready'),
        inArray(asset.kind, ['image', 'video']),
      ),
    );
  return new Set(files.map((f) => f.id));
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

/** The Production board has no canvas to hold the cards of boards under it (decision 0123). */
const underProduction = () =>
  new HttpError('bad_request', 'A board cannot go under the Production board.', {
    reason: 'production_parent',
  });

/**
 * Creates the project's Production board (decision 0123): one per project, so a live one is a
 * 409 naming it, and a trashed one comes back under the chosen parent with its days instead of
 * a second one being made. Either way the days of the project's other live boards move to it.
 */
async function createProduction(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  projectId: string,
  input: CreateBoard,
  createdBy: string,
) {
  await lockProduction(tx, projectId);
  const existing = await productionBoardOf(tx, projectId);
  if (existing && existing.deletedAt === null)
    throw new HttpError('conflict', 'The project already has a Production board.', {
      reason: 'production_exists',
      boardId: existing.id,
    });
  const position = generateKeyBetween(await lastChildPosition(tx, input.parentBoardId), null);
  const [row] = existing
    ? await tx
        .update(board)
        .set({ deletedAt: null, parentBoardId: input.parentBoardId, position })
        .where(eq(board.id, existing.id))
        .returning()
    : await tx
        .insert(board)
        .values({
          projectId,
          parentBoardId: input.parentBoardId,
          kind: 'production',
          views: NEW_BOARD_VIEWS.production,
          title: input.title,
          position,
          createdBy,
        })
        .returning();
  if (!row) throw new Error('Production board write returned nothing');
  await adoptDays(tx, projectId, row.id);
  return row;
}

export function registerBoardRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  // Least recently read first; a save changes the key, so a stale summary is never served.
  const summaries = new Map<string, { content: ScheduleSourceContent; bytes: number }>();
  let summaryBytes = 0;
  const cacheSummary = (key: string, content: ScheduleSourceContent, bytes: number) => {
    summaries.set(key, { content, bytes });
    summaryBytes += bytes;
    for (const [old, entry] of summaries) {
      if (summaryBytes <= SUMMARY_CACHE_BYTES) break;
      summaries.delete(old);
      summaryBytes -= entry.bytes;
    }
  };

  app.get(v1('/boards/:boardId/preview'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
    // Reauthorize every request. Browser revalidation avoids stale previews after edits or revocation.
    reply.header('cache-control', 'private, no-cache');
    let projection: ReturnType<typeof projectBoard>;
    try {
      projection = projectBoard(row?.state);
    } catch (err) {
      // A malformed stored document has nothing to preview: answer as for an empty board.
      req.log.warn({ err, boardId }, 'board preview: stored document cannot be read');
      projection = projectBoard();
    }
    const { preview, reviewable } = projection;
    const [metadata] = await db.select().from(board).where(eq(board.id, boardId));
    const candidates = [...new Set([metadata?.coverAssetId, ...preview.assetIds])].filter(
      (id): id is string => AssetId.safeParse(id).success,
    );
    const frameAssets = (preview.frames ?? []).flatMap((f) => (f.assetId ? [f.assetId] : []));
    // Cover references and imported documents cannot expose files from another project.
    const allowed = await projectMedia(db, access.board.projectId, [
      ...candidates,
      ...frameAssets.filter((id) => AssetId.safeParse(id).success),
    ]);
    const body: BoardPreview = {
      ...preview,
      assetIds: candidates.filter((id) => allowed.has(id)).slice(0, 4),
    };
    if (body.frames)
      body.frames = body.frames.map(({ assetId, ...f }) =>
        assetId && allowed.has(assetId) ? { ...f, assetId } : f,
      );
    // The card of a sub-board shows what the views would show its viewer (decision 0121).
    const ids = new Set(reviewable);
    const reviews = (await teamReviews(db, boardId)).filter((r) => ids.has(r.elementId));
    body.review = {
      approved: reviews.filter((r) => r.status === 'approved').length,
      changes: reviews.filter((r) => r.status === 'changes_requested').length,
      total: reviewable.length,
    };
    // A storyboard's schedule is the Production board's (decision 0123). While the project has
    // none live (the move switched off, or the board in the trash), the counts tell its members
    // there is a plan to find there: the project's days, on live boards or on the trashed
    // Production board that "Add → Production" brings back, and its crew. The troupe is the
    // project's contacts: a grant on one board does not show it (crew routes), nor the days.
    if (
      metadata?.kind === 'storyboard' &&
      (await projectRole(db, actor, access.board.projectId)) &&
      !(await liveProductionBoard(db, access.board.projectId))
    ) {
      const projectId = access.board.projectId;
      const [[days], [crew]] = await Promise.all([
        db
          .select({ n: count() })
          .from(shootingDay)
          .innerJoin(board, eq(board.id, shootingDay.boardId))
          .where(
            and(
              eq(shootingDay.projectId, projectId),
              or(isNull(board.deletedAt), eq(board.kind, 'production')),
            ),
          ),
        db.select({ n: count() }).from(crewMember).where(eq(crewMember.projectId, projectId)),
      ]);
      body.dayCount = days?.n ?? 0;
      body.crewCount = crew?.n ?? 0;
    }
    if (metadata?.kind === 'production') {
      // Its days are its content: whoever opens the board reads them (decision 0123, §4).
      const [days, [where]] = await Promise.all([
        db
          .select({
            date: shootingDay.date,
            callTime: shootingDay.callTime,
            location: shootingDay.location,
            blocks: shootingDay.blocks,
          })
          .from(shootingDay)
          .where(eq(shootingDay.boardId, boardId))
          .orderBy(asc(shootingDay.date), asc(shootingDay.id)),
        db
          .select({ timeZone: project.timeZone })
          .from(project)
          .where(eq(project.id, access.board.projectId)),
      ]);
      body.dayCount = days.length;
      const next = nextShootingDay(days, todayIn(where?.timeZone ?? null));
      if (next) body.nextDay = next;
      // The troupe stays the members' (decision 0091): a grant on the board shows no one.
      if (await projectRole(db, actor, access.board.projectId)) {
        const where = eq(crewMember.projectId, access.board.projectId);
        const [[crew], people] = await Promise.all([
          db.select({ n: count() }).from(crewMember).where(where),
          db
            .select({ name: crewMember.name, role: crewMember.role })
            .from(crewMember)
            .where(where)
            .orderBy(asc(crewMember.position), asc(crewMember.id))
            .limit(4),
        ]);
        body.crewCount = crew?.n ?? 0;
        body.crew = people.map((p) => ({ name: p.name.slice(0, 120), role: p.role.slice(0, 120) }));
      }
    }
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

  app.get(v1('/me/unsorted'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const rows = await db
      .select({
        id: board.id,
        projectId: board.projectId,
        title: board.title,
        projectName: project.name,
      })
      .from(board)
      .innerJoin(project, and(eq(project.id, board.projectId), isNull(project.archivedAt)))
      .where(and(isNull(board.deletedAt), visibleTo(actor.id)));
    // Only people who can place the cards: the tray is hidden from guests and read-only roles.
    // Documents are large: only the boards that pass are read.
    const roles = await boardRoles(
      db,
      actor,
      rows.map((r) => r.id),
    );
    const placeable = rows.filter((r) => {
      const role = roles.get(r.id);
      return role && atLeast(role, CAPABILITY_ROLE.edit);
    });
    // The tray stored at the last indexing (#803); only documents stored since are decoded,
    // and boards whose stored tray is empty are not read at all.
    const fresh = sql`(coalesce(${boardDoc.indexedAt} >= ${boardDoc.updatedAt}, false)
      and ${boardDoc.unsorted} is not null)`;
    const docs = placeable.length
      ? await db
          .select({
            boardId: boardDoc.boardId,
            unsorted: sql<{
              count: number;
              assetIds: string[];
            } | null>`case when ${fresh} then ${boardDoc.unsorted} end`,
            state: sql<Uint8Array | null>`case when ${fresh} then null else ${boardDoc.state} end`,
          })
          .from(boardDoc)
          .where(
            and(
              inArray(
                boardDoc.boardId,
                placeable.map((r) => r.id),
              ),
              sql`(not ${fresh} or (${boardDoc.unsorted}->>'count')::int > 0)`,
            ),
          )
      : [];
    const stored = new Map(docs.map((d) => [d.boardId, d]));
    const editable = placeable
      .flatMap((r) => {
        const doc = stored.get(r.id);
        if (!doc) return [];
        const unsorted = doc.unsorted ?? unsortedOf(doc.state ?? undefined);
        return unsorted.count > 0 ? [{ ...r, unsorted }] : [];
      })
      .sort((a, b) => b.unsorted.count - a.unsorted.count || a.id.localeCompare(b.id))
      .slice(0, 20);
    const items = await Promise.all(
      editable.map(async (r) => {
        const allowed = await projectMedia(db, r.projectId, r.unsorted.assetIds);
        return {
          boardId: r.id,
          projectId: r.projectId,
          boardTitle: r.title,
          projectName: r.projectName,
          count: r.unsorted.count,
          assetIds: r.unsorted.assetIds.filter((id) => allowed.has(id)).slice(0, 2),
        };
      }),
    );
    return { items, total: items.reduce((sum, item) => sum + item.count, 0) };
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
      .where(and(isNull(board.deletedAt), visibleTo(actor.id)))
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
    // shortcut: roles follow the whole tree, so the list is never split; page it if projects
    // grow past a few thousand boards (#804).
    return { items, nextCursor: null };
  });

  app.get(v1('/projects/:projectId/board-counts'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const [pRole, grants] = await Promise.all([
      projectRole(db, actor, projectId),
      projectGrants(db, actor, projectId),
    ]);
    if (!pRole && grants.size === 0) throw new HttpError('not_found', 'Project not found.');
    const [rows, links] = await Promise.all([
      db
        .select({
          board,
          // The stored counts when the index is current, else the document to decode.
          counts: sql<Omit<
            BoardCount,
            'boardId'
          > | null>`case when ${boardDoc.indexedAt} >= ${boardDoc.updatedAt} then ${boardDoc.counts} end`,
          state: sql<Uint8Array | null>`case when ${boardDoc.indexedAt} >= ${boardDoc.updatedAt} and ${boardDoc.counts} is not null then null else ${boardDoc.state} end`,
        })
        .from(board)
        .leftJoin(boardDoc, eq(boardDoc.boardId, board.id))
        .where(and(eq(board.projectId, projectId), isNull(board.deletedAt))),
      // Client review under way: a live link whose guests can set review statuses.
      db
        .selectDistinct({ boardId: shareLink.boardId })
        .from(shareLink)
        .where(
          and(
            eq(shareLink.projectId, projectId),
            eq(shareLink.role, 'guest_approve'),
            isNull(shareLink.revokedAt),
            or(isNull(shareLink.expiresAt), gt(shareLink.expiresAt, sql`now()`)),
          ),
        ),
    ]);
    const reviewing = new Set(links.map((l) => l.boardId));
    const roles = effectiveRoles(
      rows.map((r) => r.board),
      grants,
      pRole,
    );
    // Same visibility as the board list: only boards the caller can open.
    const items = rows.flatMap((r) =>
      roles.get(r.board.id)?.role
        ? [
            {
              boardId: r.board.id,
              ...(r.counts ?? boardCounts(r.state ?? undefined)),
              clientReview: reviewing.has(r.board.id),
            },
          ]
        : [],
    );
    return { items };
  });

  // What the Production board shows of its storyboards, without opening their documents (#826).
  // The live document when this process holds it, else the stored one.
  // shortcut: with the collab server in another process the stored one is read, which trails the
  // live one by its save delay (seconds); add a queued read if that shows.
  app.get(v1('/projects/:projectId/schedule-sources'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const { boards: ids } = ScheduleSourcesQuery.parse(req.query ?? {});
    const [pRole, grants] = await Promise.all([
      projectRole(db, actor, projectId),
      projectGrants(db, actor, projectId),
    ]);
    if (!pRole && grants.size === 0) throw new HttpError('not_found', 'Project not found.');
    // Roles follow the whole tree, so every board of the project is read for them.
    const rows = await db
      .select()
      .from(board)
      .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)));
    const roles = effectiveRoles(rows, grants, pRole);
    // Only boards the caller can open; the others are left out, as the board list does.
    const readable = ids.flatMap((id) => {
      const role = roles.get(id)?.role;
      return role ? [{ id, role }] : [];
    });
    if (readable.length === 0) return { items: [], rest: [] };
    const saved = await db
      .select({ boardId: boardDoc.boardId, size: boardDoc.size, updatedAt: boardDoc.updatedAt })
      .from(boardDoc)
      .where(
        inArray(
          boardDoc.boardId,
          readable.map((r) => r.id),
        ),
      );
    const savedOf = new Map(saved.map((d) => [d.boardId, d]));
    // In the order asked, within the byte budget; always at least one, so each request moves on.
    const chosen: typeof readable = [];
    const rest: string[] = [];
    let bytes = 0;
    for (const r of readable) {
      const size = savedOf.get(r.id)?.size ?? 0;
      if (chosen.length > 0 && bytes + size > SCHEDULE_SOURCES_BYTES) rest.push(r.id);
      else {
        chosen.push(r);
        bytes += size;
      }
    }
    const content = new Map<string, ScheduleSourceContent>();
    const keyOf = (id: string) => `${id}:${savedOf.get(id)?.updatedAt.getTime() ?? 0}`;
    for (const { id } of chosen) {
      const live = await deps.boardReader?.scheduleSource?.(id);
      const cached = live ? undefined : summaries.get(keyOf(id));
      if (cached) {
        summaries.delete(keyOf(id));
        summaries.set(keyOf(id), cached);
      }
      const found = live ?? cached?.content;
      if (found) content.set(id, found);
    }
    const missing = chosen.filter(({ id }) => !content.has(id) && savedOf.has(id)).map((r) => r.id);
    if (missing.length > 0) {
      const docs = await db
        .select({ boardId: boardDoc.boardId, state: boardDoc.state })
        .from(boardDoc)
        .where(inArray(boardDoc.boardId, missing));
      for (const doc of docs) {
        const summary = scheduleSource(doc.boardId, doc.state);
        content.set(doc.boardId, summary);
        cacheSummary(keyOf(doc.boardId), summary, doc.state.byteLength);
      }
    }
    const items = chosen.map(({ id, role }) => ({
      boardId: id,
      readOnly: !atLeast(role, CAPABILITY_ROLE.edit),
      ...(content.get(id) ?? scheduleSource(id, null)),
    }));
    return { items, rest };
  });

  app.post(v1('/projects/:projectId/boards'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const input = CreateBoard.parse(req.body);
    const parent = await requireBoardRole(db, actor, input.parentBoardId, 'editor');
    if (parent.board.projectId !== projectId)
      throw new HttpError('bad_request', 'The parent board is not in this project.');
    if (parent.board.kind === 'production') throw underProduction();
    const result = await idempotentCreation(
      db,
      req,
      actor.id,
      `boards:${projectId}`,
      input,
      async (tx) => {
        if (deps.config?.DEMO_MODE) {
          // Counted under a lock, so a burst of requests cannot pass the cap together.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`demo-boards:${projectId}`}))`,
          );
          const [made] = await tx
            .select({ n: count() })
            .from(board)
            .where(eq(board.projectId, projectId));
          if ((made?.n ?? 0) >= DEMO_MAX_BOARDS)
            throw new HttpError(
              'conflict',
              `A demo project has at most ${DEMO_MAX_BOARDS} boards.`,
              {
                reason: 'demo_limit',
              },
            );
        }
        if (input.kind === 'production') return createProduction(tx, projectId, input, actor.id);
        const position = generateKeyBetween(await lastChildPosition(tx, input.parentBoardId), null);
        const [created] = await tx
          .insert(board)
          .values({
            projectId,
            parentBoardId: input.parentBoardId,
            kind: input.kind,
            views: NEW_BOARD_VIEWS[input.kind],
            title: input.title,
            position,
            createdBy: actor.id,
          })
          .returning();
        if (!created) throw new Error('Board insert returned nothing');
        return created;
      },
    );
    if ('replayed' in result) {
      // A retry is answered with the board as it is now, like a read: 404 once it is gone.
      const now = await requireBoardRole(db, actor, result.replayed, 'viewer');
      return reply.status(201).send(toBoard(now.board, now.role));
    }
    // A new board inherits from its parent, so the parent's role applies.
    return reply.status(201).send(toBoard(result.created, parent.role));
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
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.views !== undefined) {
      const allowed = OPTIONAL_VIEWS[current.kind];
      // A web tab from before the Production board still sends a storyboard its Schedule and
      // Troupe with the rest: dropped, not refused, so that tab can still turn a view on or off.
      const legacy: readonly string[] = current.kind === 'storyboard' ? ['schedule', 'troupe'] : [];
      if (patch.views.some((v) => !allowed.includes(v) && !legacy.includes(v)))
        throw new HttpError('bad_request', 'This kind of board cannot show that view.');
      set.views = allowed.filter((v) => patch.views?.includes(v));
    }
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
      if (target.board.kind === 'production') throw underProduction();
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
