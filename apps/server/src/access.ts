import type { ProjectRole } from '@inkadra/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { board, projectMember } from './db/schema.ts';

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
