import type { ProjectRole } from '@inkadra/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { asset, board, boardGrant, projectMember } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

export interface Actor {
  id: string;
  role: 'admin' | 'member';
  /** Set when the request came with a bearer token instead of a session cookie. */
  tokenId?: string;
}

const rank: Record<ProjectRole, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

export function atLeast(role: ProjectRole | null, needed: ProjectRole): boolean {
  return role !== null && rank[role] >= rank[needed];
}

export function higher(a: ProjectRole, b: ProjectRole): boolean {
  return rank[a] > rank[b];
}

export interface Effective {
  role: ProjectRole | null;
  /** Board whose grant gives the role, or null when it comes from the project (or is none). */
  grantBoardId: string | null;
}

/**
 * The single rule for roles (decision 0011): walking from a board up to the project root, the
 * first grant for the person wins; without one, the project role applies.
 *
 * @param chain the board first, then its parent, up to the root board
 */
export function effectiveRole(
  chain: readonly string[],
  grants: ReadonlyMap<string, ProjectRole>,
  projectRole: ProjectRole | null,
): Effective {
  for (const id of chain) {
    const role = grants.get(id);
    if (role) return { role, grantBoardId: id };
  }
  return { role: projectRole, grantBoardId: null };
}

/** effectiveRole for every board of a tree at once. */
export function effectiveRoles(
  boards: ReadonlyArray<{ id: string; parentBoardId: string | null }>,
  grants: ReadonlyMap<string, ProjectRole>,
  projectRole: ProjectRole | null,
): Map<string, Effective> {
  const parent = new Map(boards.map((b) => [b.id, b.parentBoardId]));
  const out = new Map<string, Effective>();
  const resolve = (id: string): Effective => {
    const known = out.get(id);
    if (known) return known;
    const own = grants.get(id);
    const up = parent.get(id);
    const result: Effective = own
      ? { role: own, grantBoardId: id }
      : up
        ? resolve(up)
        : { role: projectRole, grantBoardId: null };
    out.set(id, result);
    return result;
  };
  for (const b of boards) resolve(b.id);
  return out;
}

export async function projectRole(
  db: Pick<Database, 'select'>,
  actor: Pick<Actor, 'id'>,
  projectId: string,
): Promise<ProjectRole | null> {
  const [row] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, actor.id)));
  return row?.role ?? null;
}

/** Ids and titles from a board up to its project's root (the board itself first). */
export async function ancestry(
  db: Pick<Database, 'execute'>,
  boardId: string,
): Promise<Array<{ id: string; title: string }>> {
  const rows = await db.execute<{ id: string; title: string; depth: number }>(sql`
    with recursive up as (
      select id, title, parent_board_id, 0 as depth from board where id = ${boardId}
      union all
      select b.id, b.title, b.parent_board_id, up.depth + 1
      from board b join up on b.id = up.parent_board_id
    )
    select id, title, depth from up order by depth`);
  return rows.map((r) => ({ id: r.id, title: r.title }));
}

/** The person's grants on the given boards. */
async function grantsOn(
  db: Pick<Database, 'select'>,
  userId: string,
  boardIds: string[],
): Promise<Map<string, ProjectRole>> {
  if (boardIds.length === 0) return new Map();
  const rows = await db
    .select({ boardId: boardGrant.boardId, role: boardGrant.role })
    .from(boardGrant)
    .where(and(eq(boardGrant.userId, userId), inArray(boardGrant.boardId, boardIds)));
  return new Map(rows.map((r) => [r.boardId, r.role]));
}

export interface BoardAccess {
  board: typeof board.$inferSelect;
  role: ProjectRole | null;
  grantBoardId: string | null;
  projectRole: ProjectRole | null;
  /** From the board up to the root. */
  chain: Array<{ id: string; title: string }>;
  /** The person's grants on the chain. */
  grants: Map<string, ProjectRole>;
}

/** Effective access of a person to a board that is not in the trash; null if no such board. */
export async function boardAccess(
  db: Database,
  actor: Pick<Actor, 'id'>,
  boardId: string,
): Promise<BoardAccess | null> {
  const [row] = await db
    .select()
    .from(board)
    .where(and(eq(board.id, boardId), isNull(board.deletedAt)));
  if (!row) return null;
  const chain = await ancestry(db, boardId);
  const [grants, pRole] = await Promise.all([
    grantsOn(
      db,
      actor.id,
      chain.map((c) => c.id),
    ),
    projectRole(db, actor, row.projectId),
  ]);
  const { role, grantBoardId } = effectiveRole(
    chain.map((c) => c.id),
    grants,
    pRole,
  );
  return { board: row, role, grantBoardId, projectRole: pRole, chain, grants };
}

/** Kept for the collab server: the role on a board and its project id. */
export async function boardRole(
  db: Database,
  actor: Pick<Actor, 'id'>,
  boardId: string,
): Promise<{ role: ProjectRole | null; projectId: string } | null> {
  const access = await boardAccess(db, actor, boardId);
  return access && { role: access.role, projectId: access.board.projectId };
}

/** The person's grants on boards of a project that are not in the trash. */
export async function projectGrants(
  db: Pick<Database, 'select'>,
  actor: Pick<Actor, 'id'>,
  projectId: string,
): Promise<Map<string, ProjectRole>> {
  const rows = await db
    .select({ boardId: boardGrant.boardId, role: boardGrant.role })
    .from(boardGrant)
    .innerJoin(board, eq(board.id, boardGrant.boardId))
    .where(
      and(eq(boardGrant.userId, actor.id), eq(board.projectId, projectId), isNull(board.deletedAt)),
    );
  return new Map(rows.map((r) => [r.boardId, r.role]));
}

/** True when the person has a role on the project or a grant on one of its boards. */
export async function touchesProject(
  db: Pick<Database, 'select'>,
  actor: Pick<Actor, 'id'>,
  projectId: string,
): Promise<boolean> {
  if (await projectRole(db, actor, projectId)) return true;
  const [row] = await db
    .select({ id: boardGrant.boardId })
    .from(boardGrant)
    .innerJoin(board, eq(board.id, boardGrant.boardId))
    .where(
      and(eq(boardGrant.userId, actor.id), eq(board.projectId, projectId), isNull(board.deletedAt)),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Throws unless the actor has at least `needed` on the project. People without any role get
 * 404, so ids of other people's projects cannot be probed.
 */
export async function requireProjectRole(
  db: Database,
  actor: Actor,
  projectId: string,
  needed: ProjectRole,
): Promise<ProjectRole> {
  const role = await projectRole(db, actor, projectId);
  if (role === null) throw new HttpError('not_found', 'Project not found.');
  if (!atLeast(role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return role;
}

/** Like requireProjectRole, for a board that is not in the trash, with grants applied. */
export async function requireBoardRole(
  db: Database,
  actor: Actor,
  boardId: string,
  needed: ProjectRole,
): Promise<BoardAccess & { role: ProjectRole }> {
  const access = await boardAccess(db, actor, boardId);
  if (!access || access.role === null) throw new HttpError('not_found', 'Board not found.');
  if (!atLeast(access.role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return { ...access, role: access.role };
}

/**
 * Role needed to write into a project through a board: the board role when a board is given
 * (it must belong to the project), the project role otherwise.
 */
export async function requireWriteAccess(
  db: Database,
  actor: Actor,
  projectId: string,
  boardId: string | undefined,
): Promise<ProjectRole> {
  if (!boardId) return requireProjectRole(db, actor, projectId, 'editor');
  const access = await requireBoardRole(db, actor, boardId, 'editor');
  if (access.board.projectId !== projectId)
    throw new HttpError('bad_request', 'The board is not in this project.');
  return access.role;
}

/**
 * Like requireProjectRole, for an asset. Anyone with a role on the project or one of its
 * boards can read it; `role` is the project role, or `viewer` for people with grants only
 * when their best grant is lower, which is what limits downloads.
 */
export async function requireAssetRole(
  db: Database,
  actor: Actor,
  assetId: string,
  needed: ProjectRole,
): Promise<{ asset: typeof asset.$inferSelect; role: ProjectRole }> {
  const [row] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (!row) throw new HttpError('not_found', 'Asset not found.');
  // Assets are not tied to a board: the best of the project role and the board grants counts.
  const [member, grant] = await Promise.all([
    projectRole(db, actor, row.projectId),
    bestGrant(db, actor, row.projectId),
  ]);
  const role = member && grant ? (higher(grant, member) ? grant : member) : (member ?? grant);
  if (role === null) throw new HttpError('not_found', 'Asset not found.');
  if (!atLeast(role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return { asset: row, role };
}

async function bestGrant(
  db: Pick<Database, 'select'>,
  actor: Pick<Actor, 'id'>,
  projectId: string,
): Promise<ProjectRole | null> {
  const rows = await db
    .select({ role: boardGrant.role })
    .from(boardGrant)
    .innerJoin(board, eq(board.id, boardGrant.boardId))
    .where(
      and(eq(boardGrant.userId, actor.id), eq(board.projectId, projectId), isNull(board.deletedAt)),
    );
  let best: ProjectRole | null = null;
  for (const r of rows) if (!best || higher(r.role, best)) best = r.role;
  return best;
}
