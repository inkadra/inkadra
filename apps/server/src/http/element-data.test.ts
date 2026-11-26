import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ElementDataMoved, ScheduleBlock } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  board,
  boardGrant,
  comment,
  commentReaction,
  elementReaction,
  elementReview,
  elementReviewEvent,
  notification,
  project,
  projectMember,
  shareGuest,
  shareLink,
  sharePick,
  shootingDay,
} from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';
import { repointBlocks } from './element-data-routes.ts';

const url = process.env.DATABASE_URL;
const log = pino({ level: 'silent' });
const roles = ['owner', 'commenter', 'grantee', 'other'] as const;
type Who = (typeof roles)[number];

const block = (over: Partial<ScheduleBlock>): ScheduleBlock => ({
  id: randomUUID(),
  type: 'shot',
  title: '',
  start: null,
  duration: 10,
  shotId: null,
  cast: [],
  departments: [],
  ...over,
});

describe('repointBlocks', () => {
  const ids = new Set(['frame-0001', 'scene-0001']);
  it('turns the pointers at the moved cards, the implicit ones too', () => {
    const blocks = [
      block({ shotId: 'frame-0001' }),
      block({ type: 'scene', sceneId: 'scene-0001', sceneBoardId: 'from' }),
      block({ shotId: 'frame-0002' }),
    ];
    const out = repointBlocks(blocks, 'from', 'from', 'to', ids);
    expect(out?.map((b) => [b.shotBoardId, b.sceneBoardId])).toEqual([
      ['to', undefined],
      [undefined, 'to'],
      [undefined, undefined],
    ]);
  });
  it('leaves pointers at another board alone, and says when nothing changed', () => {
    expect(repointBlocks([block({ shotId: 'frame-0001' })], 'prod', 'from', 'to', ids)).toBeNull();
    expect(
      repointBlocks(
        [block({ shotId: 'frame-0001', shotBoardId: 'else' })],
        'from',
        'from',
        'to',
        ids,
      ),
    ).toBeNull();
  });
});

describe.skipIf(!url)('POST /boards/{id}/element-data/move', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const deps = testDeps(db, log);
  const notices = { notify: vi.fn(), recheckAccess: vi.fn() };
  const people = {} as Record<Who, { id: string; cookie: string }>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let projectId: string;
  let root: string;
  let source: string;
  let storyboard: string;
  let production: string;
  let elsewhere: string;
  const scene = 'scene-0001';
  const frame = 'frame-0001';
  const other = 'note-00001';

  const move = (who: Who, from: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/boards/${from}/element-data/move`,
      headers: {
        cookie: people[who].cookie,
        origin: config.PUBLIC_URL,
        'content-type': 'application/json',
      },
      payload: JSON.stringify(payload),
    });
  const boardOf = async (table: typeof elementReaction | typeof elementReview | typeof sharePick) =>
    (await db.select({ boardId: table.boardId }).from(table)).map((r) => r.boardId);

  /** A thread with a reply and a reaction, a card reaction, a review with its history, a pick. */
  async function seed(boardId: string, elementId: string) {
    const [thread] = await db
      .insert(comment)
      .values({ projectId, boardId, elementId, authorId: people.owner.id, body: 'Look' })
      .returning();
    if (!thread) throw new Error('no thread');
    const [reply] = await db
      .insert(comment)
      .values({
        projectId,
        boardId,
        elementId,
        threadId: thread.id,
        authorId: people.commenter.id,
        body: 'Yes',
      })
      .returning();
    await db
      .insert(commentReaction)
      .values({ commentId: thread.id, emoji: '👍', userId: people.commenter.id });
    await db
      .insert(elementReaction)
      .values({ boardId, elementId, emoji: '❤️', userId: people.owner.id });
    await db.insert(elementReview).values({
      boardId,
      elementId,
      projectId,
      status: 'approved',
      changedBy: people.owner.id,
    });
    await db.insert(elementReviewEvent).values({
      boardId,
      elementId,
      previous: 'none',
      status: 'approved',
      userId: people.owner.id,
    });
    const [link] = await db
      .insert(shareLink)
      .values({
        projectId,
        boardId,
        role: 'guest_approve',
        tokenHash: randomUUID(),
        tokenSealed: 'sealed',
        createdBy: people.owner.id,
        proofing: true,
      })
      .returning();
    const [guest] = await db
      .insert(shareGuest)
      .values({
        shareLinkId: link?.id ?? '',
        name: 'Guest',
        sessionExpiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await db.insert(sharePick).values({
      guestId: guest?.id ?? '',
      shareLinkId: link?.id ?? '',
      boardId,
      elementId,
      pick: 'picked',
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });
    await db.insert(notification).values({
      userId: people.owner.id,
      type: 'reply',
      projectId,
      boardId,
      elementId,
      commentId: reply?.id,
    });
    return { thread, reply };
  }

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...deps, notices });
    for (const who of roles) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${who}@example.com`, name: who, password: 'correct-horse-battery' },
      });
      expect(res.statusCode, res.body).toBe(200);
      people[who] = {
        id: res.json().user.id,
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
  });
  beforeEach(async () => {
    await db.execute(sql`truncate project, notification cascade`);
    notices.notify.mockReset();
    projectId = randomUUID();
    root = randomUUID();
    source = randomUUID();
    storyboard = randomUUID();
    production = randomUUID();
    await db.insert(project).values({ id: projectId, name: 'Project', position: 'a0' });
    await db.insert(board).values([
      { id: root, projectId, title: 'Root', position: 'a0' },
      { id: source, projectId, parentBoardId: root, title: 'Ideas', position: 'a1' },
      {
        id: storyboard,
        projectId,
        parentBoardId: root,
        title: 'Storyboard',
        kind: 'storyboard',
        position: 'a2',
      },
      {
        id: production,
        projectId,
        parentBoardId: root,
        title: 'Production',
        kind: 'production',
        position: 'a3',
      },
    ]);
    await db.insert(projectMember).values([
      { projectId, userId: people.owner.id, role: 'owner' },
      { projectId, userId: people.commenter.id, role: 'commenter' },
      { projectId, userId: people.grantee.id, role: 'viewer' },
    ]);
    await db.insert(boardGrant).values([
      { boardId: source, userId: people.grantee.id, role: 'editor' },
      { boardId: storyboard, userId: people.grantee.id, role: 'editor' },
    ]);
    const otherProject = randomUUID();
    elsewhere = randomUUID();
    await db.insert(project).values({ id: otherProject, name: 'Other', position: 'a1' });
    await db
      .insert(board)
      .values({ id: elsewhere, projectId: otherProject, title: 'Root', position: 'a0' });
    await db
      .insert(projectMember)
      .values({ projectId: otherProject, userId: people.owner.id, role: 'owner' });
  });
  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it('moves every kind of data about the cards, in one go, and nothing else', async () => {
    const { thread, reply } = await seed(source, scene);
    await db.insert(comment).values({
      projectId,
      boardId: source,
      elementId: other,
      authorId: people.owner.id,
      body: 'Stays',
    });
    const [day] = await db
      .insert(shootingDay)
      .values({
        projectId,
        boardId: production,
        date: '2026-12-01',
        callTime: '08:00',
        location: '',
        notes: '',
        blocks: [
          block({ shotId: frame, shotBoardId: source }),
          block({ type: 'scene', sceneId: scene, sceneBoardId: source }),
        ],
      })
      .returning();

    const res = await move('owner', source, { toBoardId: storyboard, elementIds: [scene, frame] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ElementDataMoved>()).toEqual({
      comments: 2,
      reactions: 1,
      reviews: 1,
      reviewEvents: 1,
      picks: 1,
      notifications: 1,
      shootingDays: 1,
    });

    const comments = await db.select().from(comment);
    expect(comments.find((c) => c.id === thread.id)?.boardId).toBe(storyboard);
    expect(comments.find((c) => c.id === reply?.id)?.boardId).toBe(storyboard);
    expect(comments.find((c) => c.elementId === other)?.boardId).toBe(source);
    expect(await db.select().from(commentReaction)).toHaveLength(1);
    expect(await boardOf(elementReaction)).toEqual([storyboard]);
    expect(await boardOf(elementReview)).toEqual([storyboard]);
    expect(await boardOf(sharePick)).toEqual([storyboard]);
    const [pick] = await db.select().from(sharePick);
    expect(pick?.updatedAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect((await db.select().from(elementReviewEvent))[0]?.boardId).toBe(storyboard);
    expect((await db.select().from(notification))[0]?.boardId).toBe(storyboard);
    const [after] = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.id, day?.id ?? ''));
    expect(after?.blocks.map((b) => b.shotBoardId ?? b.sceneBoardId)).toEqual([
      storyboard,
      storyboard,
    ]);
    expect(after?.revision).toBe((day?.revision ?? 0) + 1);
    // Both boards hear about it and fetch again.
    const told = notices.notify.mock.calls.map(([boardId, n]) => `${boardId}:${n.type}`);
    expect(told).toEqual(
      expect.arrayContaining([
        `${source}:comments`,
        `${storyboard}:comments`,
        `${source}:review`,
        `${storyboard}:review`,
      ]),
    );

    // The comments read on the storyboard now.
    const counts = await app.inject({
      method: 'GET',
      url: `/api/v1/boards/${storyboard}/comment-counts`,
      headers: { cookie: people.owner.cookie },
    });
    expect(counts.json().items).toEqual([{ elementId: scene, open: 1, resolved: 0 }]);
  });

  it('is safe to retry, and moves back the other way', async () => {
    await seed(source, scene);
    const body = { toBoardId: storyboard, elementIds: [scene] };
    expect((await move('owner', source, body)).statusCode).toBe(200);
    const again = await move('owner', source, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(Object.values(again.json<ElementDataMoved>())).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await boardOf(elementReview)).toEqual([storyboard]);

    const back = await move('owner', storyboard, { toBoardId: source, elementIds: [scene] });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json<ElementDataMoved>().comments).toBe(2);
    expect(await boardOf(elementReview)).toEqual([source]);
  });

  it('refuses, moving nothing, when the other board keeps data about one of the cards', async () => {
    await seed(source, scene);
    await db.insert(comment).values({
      projectId,
      boardId: storyboard,
      elementId: scene,
      authorId: people.owner.id,
      body: 'Already here',
    });
    const res = await move('owner', source, { toBoardId: storyboard, elementIds: [scene] });
    expect(res.statusCode, res.body).toBe(409);
    expect(await boardOf(elementReview)).toEqual([source]);
    expect(
      (await db.select().from(comment)).filter((c) => c.boardId === source).map((c) => c.body),
    ).toEqual(expect.arrayContaining(['Look', 'Yes']));
  });

  it('rolls everything back when a shooting day of the cards cannot be changed', async () => {
    await seed(source, scene);
    await db.insert(shootingDay).values({
      projectId,
      boardId: production,
      date: '2026-12-01',
      callTime: '08:00',
      location: '',
      notes: '',
      blocks: [block({ shotId: scene, shotBoardId: source })],
    });
    // Editor on both boards through grants, but only a viewer of the Production board.
    const res = await move('grantee', source, { toBoardId: storyboard, elementIds: [scene] });
    expect(res.statusCode, res.body).toBe(403);
    expect(await boardOf(elementReview)).toEqual([source]);
    expect((await db.select().from(comment)).every((c) => c.boardId === source)).toBe(true);
    // Without the day the same person may move it.
    await db.delete(shootingDay);
    expect(
      (await move('grantee', source, { toBoardId: storyboard, elementIds: [scene] })).statusCode,
    ).toBe(200);
  });

  it('needs editor on both boards of one project, and valid ids', async () => {
    await seed(source, scene);
    const ok = { toBoardId: storyboard, elementIds: [scene] };
    expect((await move('commenter', source, ok)).statusCode).toBe(403);
    expect((await move('other', source, ok)).statusCode).toBe(404);
    expect((await move('grantee', source, { ...ok, toBoardId: production })).statusCode).toBe(403);
    expect((await move('owner', source, { ...ok, toBoardId: elsewhere })).statusCode).toBe(400);
    expect((await move('owner', source, { ...ok, toBoardId: source })).statusCode).toBe(400);
    expect((await move('owner', source, { ...ok, elementIds: [] })).statusCode).toBe(400);
    expect((await move('owner', source, { ...ok, elementIds: [scene, scene] })).statusCode).toBe(
      400,
    );
    expect((await move('owner', source, { ...ok, elementIds: ['../x'] })).statusCode).toBe(400);
    expect((await move('owner', source, { ...ok, extra: 1 })).statusCode).toBe(400);
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, storyboard));
    expect((await move('owner', source, ok)).statusCode).toBe(404);
    expect(await boardOf(elementReview)).toEqual([source]);
  });
});
