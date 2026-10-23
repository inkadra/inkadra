import type { ProjectRole } from '@inkadra/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { asset, board, projectMember } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

export interface Actor {
  id: string;
  role: 'admin' | 'member';
}

const rank: Record<ProjectRole, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

export function atLeast(role: ProjectRole | null, needed: ProjectRole): boolean {
  return role !== null && rank[role] >= rank[needed];
}

/**
 * Role of an actor on a project. Board-level grants (board_grant) and guest links are
 * resolved here too once the collaboration thread adds them in wave 2.
 */
export async function projectRole(
  db: Database,
  actor: Actor,
  projectId: string,
): Promise<ProjectRole | null> {
  const [row] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, actor.id)));
  return row?.role ?? null;
}

export async function boardRole(
  db: Database,
  actor: Actor,
  boardId: string,
): Promise<{ role: ProjectRole | null; projectId: string } | null> {
  const [row] = await db
    .select({ projectId: board.projectId })
    .from(board)
    .where(and(eq(board.id, boardId), isNull(board.deletedAt)));
  if (!row) return null;
  return { projectId: row.projectId, role: await projectRole(db, actor, row.projectId) };
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

/** Like requireProjectRole, for a board that is not in the trash. */
export async function requireBoardRole(
  db: Database,
  actor: Actor,
  boardId: string,
  needed: ProjectRole,
): Promise<{ board: typeof board.$inferSelect; role: ProjectRole }> {
  const [row] = await db
    .select()
    .from(board)
    .where(and(eq(board.id, boardId), isNull(board.deletedAt)));
  if (!row) throw new HttpError('not_found', 'Board not found.');
  const role = await projectRole(db, actor, row.projectId);
  if (role === null) throw new HttpError('not_found', 'Board not found.');
  if (!atLeast(role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return { board: row, role };
}

/** Like requireProjectRole, for an asset. */
export async function requireAssetRole(
  db: Database,
  actor: Actor,
  assetId: string,
  needed: ProjectRole,
): Promise<{ asset: typeof asset.$inferSelect; role: ProjectRole }> {
  const [row] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (!row) throw new HttpError('not_found', 'Asset not found.');
  const role = await projectRole(db, actor, row.projectId);
  if (role === null) throw new HttpError('not_found', 'Asset not found.');
  if (!atLeast(role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return { asset: row, role };
}
