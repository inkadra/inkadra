import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { boardVersion, shareLinkOpen } from './db/schema.ts';
import { notify, Recipients } from './notifications.ts';

/**
 * The person who made a share link hears the first time a guest opens it, and again the first
 * time it is opened after the board got a new named version: at most one notification per link
 * and version, decided by a row that can only be inserted once. Nothing about the visit is
 * kept, no address, device or guest (issue 309).
 */

// Opens already recorded by this process, so the usual page load costs no write.
const seen = new WeakMap<Database, Set<string>>();
const MAX_SEEN = 5000;

export async function recordLinkOpen(
  db: Database,
  link: { id: string; projectId: string; boardId: string; createdBy: string | null },
): Promise<boolean> {
  const [latest] = await db
    .select({ id: boardVersion.id })
    .from(boardVersion)
    .where(and(eq(boardVersion.boardId, link.boardId), eq(boardVersion.kind, 'named')))
    .orderBy(desc(boardVersion.createdAt), desc(boardVersion.id))
    .limit(1);
  const versionKey = latest?.id ?? '';
  let known = seen.get(db);
  if (!known) {
    known = new Set();
    seen.set(db, known);
  }
  const key = `${link.id}:${versionKey}`;
  if (known.has(key)) return false;
  const inserted = await db
    .insert(shareLinkOpen)
    .values({ shareLinkId: link.id, versionKey })
    .onConflictDoNothing()
    .returning({ id: shareLinkOpen.shareLinkId });
  if (known.size >= MAX_SEEN) known.clear();
  known.add(key);
  if (inserted.length === 0) return false;
  if (!link.createdBy) return false;
  const count = await notify(
    db,
    {
      actor: {},
      projectId: link.projectId,
      boardId: link.boardId,
      shareLinkId: link.id,
    },
    new Recipients(null).add(link.createdBy, 'link_opened'),
  );
  return count > 0;
}
