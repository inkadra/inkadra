import { type CastLink, type CrewCharacter, castNameKey } from '@inkadra/shared';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
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

/** The character cards of each board, read once per board and per request. */
export function characterCards(db: Source, reader: CharacterReader) {
  const boards = new Map<string, Promise<CrewCharacter[]>>();
  return (boardId: string) => {
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

/** Each account's cast names in a project, from its crew rows; one person's only when given. */
export async function castLinksOf(
  db: Source,
  reader: CharacterReader,
  projectId: string,
  userId?: string,
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
  const keys = await crewCastKeys(rows, characterCards(db, reader));
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
 * The row with that name or that character, else the row named after the card's actor, gets the
 * account (and the card when it had none); without one, a new row in Cast is made.
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
  const cards = characterCards(tx, reader);
  const keys = await crewCastKeys(rows, cards);
  const card = (await cards(boardId)).find((c) => castNameKey(c.name) === key);
  const actor = card?.actor.trim() ?? '';
  let matches = rows.filter((_, i) => keys[i]?.has(key));
  if (!matches.length && actor)
    matches = rows.filter((r) => castNameKey(r.name) === castNameKey(actor));
  const bump = { revision: sql`${crewMember.revision} + 1`, updatedAt: sql`now()` };
  if (!userId) {
    const linked = matches.filter((r) => r.userId).map((r) => r.id);
    if (linked.length)
      await tx
        .update(crewMember)
        .set({ userId: null, ...bump })
        .where(inArray(crewMember.id, linked));
    return;
  }
  if (matches.some((r) => r.userId === userId)) return;
  const free = matches.filter((r) => !r.userId || !link.keep);
  const target = free.find(isCastRow) ?? free[0];
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
 * Merged links are marked, not deleted.
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
        projectId: board.projectId,
      })
      .from(castLink)
      .innerJoin(board, eq(board.id, castLink.boardId))
      .where(isNull(castLink.mergedAt))
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
    }
    await tx.update(castLink).set({ mergedAt: sql`now()` }).where(isNull(castLink.mergedAt));
    return links.length;
  });
}
