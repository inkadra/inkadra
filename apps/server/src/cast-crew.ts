import { type CastLink, type CrewCharacter, castNameKey } from '@inkadra/shared';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { type Actor, boardRoles } from './access.ts';
import { type BoardReader, storedCharacters } from './board-content.ts';
import type { Database } from './db/client.ts';
import { board, castLink, crewMember, shootingDay } from './db/schema.ts';

/**
 * A crew row in department Cast is the one link from a person to an account (decisions 0091,
 * 0092): personal calls and presence read the cast names of crew rows, never a board's own list.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Source = Database | Transaction;
type CharacterReader = Pick<BoardReader, 'characters'> | undefined;
type CastRow = Pick<typeof crewMember.$inferSelect, 'name' | 'character'>;

/**
 * The boards whose character cards may be read: in the project and not in the trash, and, for a
 * `viewer`, boards that person can open (as `/crew/characters` does). A grant on one board must
 * not reveal the names of cards on another (decision 0091).
 */
export async function cardBoards(
  db: Source,
  projectId: string,
  boardIds: Iterable<string>,
  viewer?: Pick<Actor, 'id'>,
): Promise<Set<string>> {
  const ids = [...new Set(boardIds)];
  if (!ids.length) return new Set();
  const live = await db
    .select({ id: board.id })
    .from(board)
    .where(and(inArray(board.id, ids), eq(board.projectId, projectId), isNull(board.deletedAt)));
  if (!viewer) return new Set(live.map((row) => row.id));
  const roles = await boardRoles(
    db,
    viewer,
    live.map((row) => row.id),
  );
  return new Set(live.flatMap((row) => (roles.has(row.id) ? [row.id] : [])));
}

/** The character cards of each allowed board, read once per board and per request. */
export function characterCards(db: Source, reader: CharacterReader, allowed: ReadonlySet<string>) {
  const boards = new Map<string, Promise<CrewCharacter[]>>();
  return (boardId: string) => {
    if (!allowed.has(boardId)) return Promise.resolve([] as CrewCharacter[]);
    let cards = boards.get(boardId);
    if (!cards) {
      cards = (reader?.characters ? reader.characters(boardId) : storedCharacters(db, boardId))
        // A board that cannot be read leaves its rows matched by their own name.
        .catch(() => []);
      boards.set(boardId, cards);
    }
    return cards;
  };
}

/**
 * The cast names of each row: its own and its character card's, on any board of the project
 * (crew rows are project data, so a card on another board counts as one on this board).
 */
export async function crewCastKeys(
  rows: readonly CastRow[],
  cards: ReturnType<typeof characterCards>,
): Promise<Set<string>[]> {
  return Promise.all(
    rows.map(async ({ name, character }) => {
      const card = character
        ? (await cards(character.boardId)).find((c) => c.elementId === character.elementId)
        : undefined;
      return new Set([name, card?.name ?? ''].filter((n) => n.trim()).map(castNameKey));
    }),
  );
}

/**
 * Each account's cast names in a project, from its crew rows; one person's only when given.
 * With a `viewer`, cards are read only on boards that person can open.
 */
export async function castLinksOf(
  db: Source,
  reader: CharacterReader,
  projectId: string,
  userId?: string,
  viewer?: Pick<Actor, 'id'>,
): Promise<CastLink[]> {
  const rows = await db
    .select({ name: crewMember.name, character: crewMember.character, userId: crewMember.userId })
    .from(crewMember)
    .where(
      and(
        eq(crewMember.projectId, projectId),
        userId ? eq(crewMember.userId, userId) : isNotNull(crewMember.userId),
      ),
    )
    .orderBy(asc(crewMember.position), asc(crewMember.id));
  const allowed = await cardBoards(
    db,
    projectId,
    rows.flatMap((row) => (row.character ? [row.character.boardId] : [])),
    viewer,
  );
  const keys = await crewCastKeys(rows, characterCards(db, reader, allowed));
  const seen = new Set<string>();
  return rows.flatMap((row, i) =>
    [...(keys[i] ?? [])].flatMap((castKey) => {
      const id = `${castKey}\n${row.userId}`;
      if (!row.userId || seen.has(id)) return [];
      seen.add(id);
      return [{ castKey, userId: row.userId }];
    }),
  );
}

const isCastRow = (row: { department: string; role: string; character: unknown }) =>
  castNameKey(row.department) === 'cast' || castNameKey(row.role) === 'cast' || !!row.character;

/**
 * Link the cast name of a board to an account through the crew (decision 0092).
 * The row with that name or that character, else a row named after the card's actor that plays
 * no character yet, gets the account (and the card); without one, a new row in Cast is made, so
 * an actor playing two characters gets a row per character and keeps both names.
 * `keep`: a row linked to somebody else stays theirs and a new row is made instead (the
 * migration of old links never takes a link away); otherwise the link moves, as it did before.
 */
export async function linkCastName(
  tx: Transaction,
  reader: CharacterReader,
  link: {
    projectId: string;
    boardId: string;
    name: string;
    userId: string | null;
    keep?: boolean;
  },
): Promise<void> {
  const { projectId, boardId, userId } = link;
  const key = castNameKey(link.name);
  // The same lock as the bulk paste: two links of one new name make one row.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
  const rows = await tx
    .select()
    .from(crewMember)
    .where(eq(crewMember.projectId, projectId))
    .orderBy(asc(crewMember.position), asc(crewMember.id));
  const allowed = await cardBoards(tx, projectId, [
    boardId,
    ...rows.flatMap((row) => (row.character ? [row.character.boardId] : [])),
  ]);
  const cards = characterCards(tx, reader, allowed);
  const keys = await crewCastKeys(rows, cards);
  const card = (await cards(boardId)).find((c) => castNameKey(c.name) === key);
  const actor = card?.actor.trim() ?? '';
  // Only a row that holds the name counts as linked. A row found by its actor holds no card yet
  // and takes this one, even when it already has the account; the next card of that actor then
  // finds no free row and gets its own.
  const keyed = rows.filter((_, i) => keys[i]?.has(key));
  const bump = { revision: sql`${crewMember.revision} + 1`, updatedAt: sql`now()` };
  if (!userId) {
    const linked = keyed.filter((r) => r.userId).map((r) => r.id);
    if (linked.length)
      await tx
        .update(crewMember)
        .set({ userId: null, ...bump })
        .where(inArray(crewMember.id, linked));
    return;
  }
  if (keyed.some((r) => r.userId === userId)) return;
  const byActor =
    !keyed.length && actor
      ? rows.filter((r) => !r.character && castNameKey(r.name) === castNameKey(actor))
      : [];
  const free = (keyed.length ? keyed : byActor).filter(
    (r) => r.userId === userId || !r.userId || !link.keep,
  );
  const target = free.find((r) => r.userId === userId) ?? free.find(isCastRow) ?? free[0];
  const character = card ? { boardId, elementId: card.elementId } : null;
  if (target) {
    await tx
      .update(crewMember)
      .set({ userId, ...(target.character ? {} : { character }), ...bump })
      .where(eq(crewMember.id, target.id));
    return;
  }
  const last = rows.reduce((max, r) => Math.max(max, r.position), -1);
  await tx.insert(crewMember).values({
    projectId,
    name: (actor || card?.name.trim() || link.name.trim()).slice(0, 120),
    role: '',
    department: 'Cast',
    phone: '',
    email: '',
    pickup: '',
    notes: '',
    userId,
    character,
    position: last + 1,
  });
}

/**
 * One-off migration of the board cast links into crew rows (decision 0091), run with the
 * database migrations. The stored key is lower case, so a row takes the name as the board
 * writes it: its character card's actor or name, else the cast name in its days, else the key.
 * Merged links are marked, not deleted, and only the very rows read: a link an older server adds
 * or changes meanwhile (or after, its `updated_at` then passing `merged_at`) is merged at the next
 * start. An older server removing a merged link leaves the crew row as it is.
 */
export async function mergeCastLinks(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    // Several roles may start together: one of them merges, the others find nothing left.
    await tx.execute(sql`select pg_advisory_xact_lock(10893)`);
    const links = await tx
      .select({
        boardId: castLink.boardId,
        castKey: castLink.castKey,
        userId: castLink.userId,
        // As text: a JavaScript date drops the microseconds the comparison below needs.
        stamp: sql<string>`${castLink.updatedAt}::text`,
        projectId: board.projectId,
      })
      .from(castLink)
      .innerJoin(board, eq(board.id, castLink.boardId))
      .where(or(isNull(castLink.mergedAt), gt(castLink.updatedAt, castLink.mergedAt)))
      .orderBy(asc(castLink.createdAt), asc(castLink.boardId), asc(castLink.castKey));
    for (const link of links) {
      const days = await tx
        .select({ blocks: shootingDay.blocks })
        .from(shootingDay)
        .where(eq(shootingDay.boardId, link.boardId));
      const written = days
        .flatMap((d) => d.blocks.flatMap((b) => b.cast))
        .find((name) => castNameKey(name) === link.castKey);
      await linkCastName(tx, undefined, {
        projectId: link.projectId,
        boardId: link.boardId,
        name: written?.trim() || link.castKey,
        userId: link.userId,
        keep: true,
      });
      // Keep updated_at as it was: it tells a later change from this merge.
      await tx
        .update(castLink)
        .set({
          mergedAt: sql`greatest(now(), ${castLink.updatedAt})`,
          updatedAt: sql`${castLink.updatedAt}`,
        })
        .where(
          and(
            eq(castLink.boardId, link.boardId),
            eq(castLink.castKey, link.castKey),
            eq(castLink.userId, link.userId),
            sql`${castLink.updatedAt}::text = ${link.stamp}`,
          ),
        );
    }
    return links.length;
  });
}
