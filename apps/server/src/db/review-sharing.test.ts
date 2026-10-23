import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from './client.ts';
import {
  board,
  boardVersion,
  comment,
  project,
  shareGuest,
  shareLink,
  sharePick,
  user,
} from './schema.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Postgres error code of a failed statement (drizzle wraps the driver error). */
async function failure(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

const CHECK = '23514';
const FOREIGN_KEY = '23503';

describe.skipIf(!url)('review and sharing tables (needs DATABASE_URL)', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused', 2);
  let userId = '';
  let projectId = '';
  let boardA = '';
  let boardB = '';
  let linkA = '';
  let linkB = '';
  let guestA = '';

  beforeAll(async () => {
    await runMigrations(url!, migrationsFolder);
    await db.execute(sql`truncate table "user", project cascade`);
    [{ id: userId }] = (await db
      .insert(user)
      .values({ name: 'Giulia', email: 'giulia@example.com' })
      .returning({ id: user.id })) as [{ id: string }];
    [{ id: projectId }] = (await db
      .insert(project)
      .values({ name: 'Ultima corsa', position: 'a0' })
      .returning({ id: project.id })) as [{ id: string }];
    [{ id: boardA }] = (await db
      .insert(board)
      .values({ projectId, title: 'Radice', position: 'a0' })
      .returning({ id: board.id })) as [{ id: string }];
    [{ id: boardB }] = (await db
      .insert(board)
      .values({ projectId, title: 'Altro', position: 'a1', parentBoardId: boardA })
      .returning({ id: board.id })) as [{ id: string }];
    const link = (tokenHash: string) => ({
      projectId,
      boardId: boardA,
      role: 'guest_comment' as const,
      tokenHash,
      tokenSealed: 'sealed',
      createdBy: userId,
    });
    [{ id: linkA }, { id: linkB }] = (await db
      .insert(shareLink)
      .values([link('hash-a'), link('hash-b')])
      .returning({ id: shareLink.id })) as [{ id: string }, { id: string }];
    [{ id: guestA }] = (await db
      .insert(shareGuest)
      .values({ shareLinkId: linkA, name: 'Cliente', sessionExpiresAt: new Date() })
      .returning({ id: shareGuest.id })) as [{ id: string }];
  });

  afterAll(async () => {
    await client.end();
  });

  const thread = (values: Partial<typeof comment.$inferInsert> = {}) => ({
    projectId,
    boardId: boardA,
    body: 'Ciao',
    ...values,
  });

  it('keeps guest comments on their link and team threads off links', async () => {
    expect(
      await failure(
        db.insert(comment).values(thread({ authorGuestId: guestA, visibility: 'everyone' })),
      ),
    ).toBe(CHECK);
    expect(
      await failure(db.insert(comment).values(thread({ authorId: userId, shareLinkId: linkA }))),
    ).toBe(CHECK);
    expect(
      await failure(
        db.insert(comment).values(
          thread({
            authorId: userId,
            authorGuestId: guestA,
            shareLinkId: linkA,
            visibility: 'everyone',
          }),
        ),
      ),
    ).toBe(CHECK);
    const [ok] = await db
      .insert(comment)
      .values(thread({ authorGuestId: guestA, shareLinkId: linkA, visibility: 'everyone' }))
      .returning({ id: comment.id });
    expect(ok?.id).toBeDefined();
  });

  it('allows replies only to a thread of the same board', async () => {
    const [start] = await db
      .insert(comment)
      .values(thread({ authorId: userId }))
      .returning({ id: comment.id });
    expect(
      await failure(
        db
          .insert(comment)
          .values(thread({ boardId: boardB, threadId: start!.id, authorId: userId })),
      ),
    ).toBe(FOREIGN_KEY);
    await db.insert(comment).values(thread({ threadId: start!.id, authorId: userId }));
  });

  it('ties picks to a guest of the same link and needs a pick or stars', async () => {
    const pick = { guestId: guestA, boardId: boardA, elementId: 'V1StGXR8_Z5jdHi6B-myT' };
    expect(
      await failure(db.insert(sharePick).values({ ...pick, shareLinkId: linkB, pick: 'picked' })),
    ).toBe(FOREIGN_KEY);
    expect(await failure(db.insert(sharePick).values({ ...pick, shareLinkId: linkA }))).toBe(CHECK);
    await db.insert(sharePick).values({ ...pick, shareLinkId: linkA, stars: 4 });
  });

  it('needs a name for named versions', async () => {
    const version = {
      boardId: boardA,
      state: new Uint8Array([0, 0]),
      schemaVersion: 3,
      size: 2,
      elementCount: 0,
    };
    expect(await failure(db.insert(boardVersion).values({ ...version, kind: 'named' }))).toBe(
      CHECK,
    );
    await db.insert(boardVersion).values({ ...version, kind: 'auto' });
  });
});
