import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { rememberClipBoard } from '../clip-board-history.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, clipBoardUse, project, projectMember, user } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('personal clip board history', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL);
  const log = pino({ level: 'silent' });
  const owner = randomUUID();
  const other = randomUUID();
  const projectId = randomUUID();
  const ids = Array.from({ length: 23 }, () => randomUUID());
  let token = '';
  let app: Awaited<ReturnType<typeof createApp>>;
  const headers = () => ({ authorization: `Bearer ${token}` });
  const history = async (limit = 20) =>
    (await app.inject({ url: `/api/v1/me/clip-boards?limit=${limit}`, headers: headers() })).json()
      .items as Array<{ id: string; myRole: string; usedAt: string }>;
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    await db.insert(user).values([
      { id: owner, name: 'Owner', email: 'owner@example.com' },
      { id: other, name: 'Other', email: 'other@example.com' },
    ]);
    await db.insert(project).values({ id: projectId, name: 'Project', position: 'a0' });
    await db.insert(projectMember).values({ projectId, userId: owner, role: 'owner' });
    await db.insert(board).values(
      ids.map((id, i) => ({
        id,
        projectId,
        parentBoardId: i === 0 ? null : ids[0],
        title: `Board ${i}`,
        position: `a${i}`,
      })),
    );
    token = (await issueToken(db, owner, { name: 'Clipper', expiresAt: null })).token;
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...testDeps(db, log),
      boards: { addCard: async () => ({ ok: true, elementId: randomUUID() }) },
    });
  });
  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('records confirmed JSON and multipart clips, but not failed ones; isolates users', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/clip',
          headers: headers(),
          payload: { boardId: ids[1], text: 'Quote' },
        })
      ).statusCode,
    ).toBe(201);
    expect((await history()).map((r) => r.id)).toEqual([ids[1]]);
    const boundary = 'clip-history-test';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="boardId"\r\n\r\n${ids[2]}\r\n--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nQuote\r\n--${boundary}--\r\n`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/clip',
          headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect((await history()).map((r) => r.id)).toEqual([ids[2], ids[1]]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/clip',
          headers: headers(),
          payload: { boardId: ids[3] },
        })
      ).statusCode,
    ).toBe(400);
    expect((await history()).map((r) => r.id)).not.toContain(ids[3]);
    const otherToken = (await issueToken(db, other, { name: 'Other', expiresAt: null })).token;
    expect(
      (
        await app.inject({
          url: '/api/v1/me/clip-boards',
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).json().items,
    ).toEqual([]);
    expect((await app.inject({ url: '/api/v1/me/clip-boards' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/me/clip-boards?limit=21', headers: headers() })).statusCode,
    ).toBe(400);
  });

  it('upserts ordering and enforces the cap under concurrent writes', async () => {
    await Promise.all(ids.map((id) => rememberClipBoard(db, owner, id)));
    expect(await history()).toHaveLength(20);
    expect(await db.select().from(clipBoardUse).where(eq(clipBoardUse.userId, owner))).toHaveLength(
      20,
    );
    await rememberClipBoard(db, owner, ids[1]!);
    expect((await history(1))[0]?.id).toBe(ids[1]);
    expect(await history()).toHaveLength(20);
  });

  it('filters current edit access, archived projects and soft-deleted boards before limit', async () => {
    await db
      .delete(projectMember)
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, owner)));
    expect(await history()).toEqual([]);
    // A viewer cannot clip, so the board is no destination until edit access returns.
    await db.insert(projectMember).values({ projectId, userId: owner, role: 'viewer' });
    expect(await history()).toEqual([]);
    await db
      .update(projectMember)
      .set({ role: 'editor' })
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, owner)));
    expect((await history(1))[0]?.myRole).toBe('editor');
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, ids[1]!));
    expect(await history(1)).toHaveLength(1);
    expect((await history()).map((r) => r.id)).not.toContain(ids[1]);
    await db.update(project).set({ archivedAt: new Date() }).where(eq(project.id, projectId));
    expect(await history()).toEqual([]);
    await db.update(project).set({ archivedAt: null }).where(eq(project.id, projectId));
  });

  it('forgets idempotently without access and cascades physical board/user deletion', async () => {
    await db.delete(projectMember).where(eq(projectMember.userId, owner));
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/v1/me/clip-boards/${ids[1]}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(204);
    expect(await db.select().from(clipBoardUse).where(eq(clipBoardUse.boardId, ids[1]!))).toEqual(
      [],
    );
    await rememberClipBoard(db, other, ids[2]!);
    await db.delete(board).where(eq(board.id, ids[2]!));
    expect(await db.select().from(clipBoardUse).where(eq(clipBoardUse.boardId, ids[2]!))).toEqual(
      [],
    );
    await rememberClipBoard(db, other, ids[3]!);
    await db.delete(user).where(eq(user.id, other));
    expect(await db.select().from(clipBoardUse).where(eq(clipBoardUse.userId, other))).toEqual([]);
  });
});
