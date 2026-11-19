import { eq, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { Database } from './db/client.ts';
import { project, projectMember } from './db/schema.ts';

/** Is `key` a fractional-index key, as board and project positions are? */
export function isOrderKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/** The project's place in the caller's own list (decision 0134); `project.position` without one. */
export const ownPosition = sql<string>`coalesce(${projectMember.position}, ${project.position})`;

/**
 * A position after the last project of the person's own list, for a project they create, import
 * or join (decision 0134). The caller holds `lockAccount` for them, so two never get the same.
 */
export async function nextOwnPosition(db: Pick<Database, 'select'>, userId: string) {
  const [last] = await db
    .select({ position: sql<string | null>`max(${ownPosition})` })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, userId));
  return generateKeyBetween(last?.position ?? null, null);
}
