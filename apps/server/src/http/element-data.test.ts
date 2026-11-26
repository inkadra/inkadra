import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import type { ElementDataMoved, ScheduleBlock } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  board,
  boardDoc,
  boardGrant,
  comment,
  commentReaction,
  elementMove,
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
import { notify, Recipients } from '../notifications.ts';
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

  /** Stores a board document holding these cards, as the routes that check a card read it. */
  async function storeDoc(boardId: string, ids: string[]) {
    const doc = createBoardDoc(boardId);
    for (const id of ids) {
      const map = new Y.Map<unknown>();
      roots(doc).elements.set(id, map);
      for (const [key, value] of Object.entries({ id, type: 'note', parent: null }))
        map.set(key, value);
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db
      .insert(boardDoc)
      .values({ boardId, state, size: state.length, schemaVersion: 3 })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.length } });
    doc.destroy();
  }
  const post = (who: Who, path: string, method: 'POST' | 'PUT', payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: {
        cookie: people[who].cookie,
        origin: config.PUBLIC_URL,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });

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
    // A day of a board in the trash is left as it is; it points at the old board.
    const trashed = randomUUID();
    await db.insert(board).values({
      id: trashed,
      projectId,
      parentBoardId: root,
      title: 'Old',
      position: 'a4',
      deletedAt: new Date(),
    });
    const [old] = await db
      .insert(shootingDay)
      .values({
        projectId,
        boardId: trashed,
        date: '2026-12-02',
        callTime: '08:00',
        location: '',
        notes: '',
        blocks: [block({ shotId: frame, shotBoardId: source })],
      })
      .returning();
    // About the board, not the card, although it names one: it stays.
    await db.insert(notification).values({
      userId: people.owner.id,
      type: 'link_opened',
      projectId,
      boardId: source,
      elementId: scene,
    });

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
      // The guest's link is on the source board and does not reach the storyboard.
      guestsOutOfReach: [scene],
    });
    const [oldAfter] = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.id, old?.id ?? ''));
    expect(oldAfter?.blocks[0]?.shotBoardId).toBe(source);
    expect(oldAfter?.revision).toBe(old?.revision);
    const notes = await db.select().from(notification);
    expect(notes.find((n) => n.type === 'link_opened')?.boardId).toBe(source);

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
    expect(notes.find((n) => n.type === 'reply')?.boardId).toBe(storyboard);
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
    expect(again.json<ElementDataMoved>()).toEqual({
      comments: 0,
      reactions: 0,
      reviews: 0,
      reviewEvents: 0,
      picks: 0,
      notifications: 0,
      shootingDays: 0,
      guestsOutOfReach: [],
    });
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

  it('counts guests reached when the storyboard sits under their link’s board', async () => {
    await db.update(board).set({ parentBoardId: source }).where(eq(board.id, storyboard));
    await seed(source, scene);
    const res = await move('owner', source, { toBoardId: storyboard, elementIds: [scene] });
    expect(res.json<ElementDataMoved>().guestsOutOfReach).toEqual([]);
  });

  it('refuses afterwards what would land on the source board about a moved card', async () => {
    await storeDoc(source, [scene, other]);
    const { thread } = await seed(source, scene);
    expect(
      (await move('owner', source, { toBoardId: storyboard, elementIds: [scene] })).statusCode,
    ).toBe(200);
    // The card is still in the source document until the client removes it: refused all the same.
    const comment1 = await post('owner', `/boards/${source}/comments`, 'POST', {
      body: 'Late',
      elementId: scene,
    });
    expect(comment1.statusCode, comment1.body).toBe(404);
    const replied = await post('owner', `/boards/${source}/comments`, 'POST', {
      body: 'Late reply',
      parentId: thread.id,
    });
    expect(replied.statusCode, replied.body).toBe(404);
    const thumbs = encodeURIComponent('👍');
    expect(
      (await post('owner', `/boards/${source}/elements/${scene}/reactions/${thumbs}`, 'PUT'))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await post('owner', `/boards/${source}/elements/${scene}/review`, 'PUT', {
          status: 'approved',
        })
      ).statusCode,
    ).toBe(404);
    // Another card of the board is unaffected; moving back lifts the refusal.
    const fine = await post('owner', `/boards/${source}/comments`, 'POST', {
      body: 'Fine',
      elementId: other,
    });
    expect(fine.statusCode, fine.body).toBe(201);
    expect(
      (await move('owner', storyboard, { toBoardId: source, elementIds: [scene] })).statusCode,
    ).toBe(200);
    const again = await post('owner', `/boards/${source}/comments`, 'POST', {
      body: 'Back',
      elementId: scene,
    });
    expect(again.statusCode, again.body).toBe(201);
    expect(await db.select().from(elementMove)).toEqual([
      expect.objectContaining({ boardId: storyboard, elementId: scene, toBoardId: source }),
    ]);
  });

  it('makes a comment written during the move wait for it, then refuses it', async () => {
    await storeDoc(source, [scene]);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A move in progress: it holds the board row and records the card as moved.
    const moving = db.transaction(async (tx) => {
      await tx.select().from(board).where(eq(board.id, source)).for('no key update');
      await tx
        .insert(elementMove)
        .values({ boardId: source, elementId: scene, toBoardId: storyboard });
      locked();
      await held;
    });
    await isLocked;
    let settled = false;
    const write = post('owner', `/boards/${source}/comments`, 'POST', {
      body: 'During',
      elementId: scene,
    }).then((res) => {
      settled = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await moving;
    expect((await write).statusCode).toBe(404);
    expect(await db.select().from(comment)).toEqual([]);
  });

  it('runs alongside a schedule save of the same day without deadlock', async () => {
    await seed(source, scene);
    const [day] = await db
      .insert(shootingDay)
      .values({
        projectId,
        boardId: production,
        date: '2026-12-01',
        callTime: '08:00',
        location: '',
        notes: '',
        blocks: [block({ shotId: scene, shotBoardId: source })],
      })
      .returning();
    const save = db.transaction(async (tx) => {
      await tx
        .select()
        .from(shootingDay)
        .where(eq(shootingDay.id, day?.id ?? ''))
        .for('update');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tx
        .update(shootingDay)
        .set({ notes: 'Saved', revision: sql`${shootingDay.revision} + 1` })
        .where(eq(shootingDay.id, day?.id ?? ''));
    });
    const res = await move('owner', source, { toBoardId: storyboard, elementIds: [scene] });
    await save;
    expect(res.statusCode, res.body).toBe(200);
    const [after] = await db.select().from(shootingDay);
    expect(after?.notes).toBe('Saved');
    expect(after?.blocks[0]?.shotBoardId).toBe(storyboard);
    expect(after?.revision).toBe((day?.revision ?? 0) + 2);
  });

  it('sends a notification or a day saved from an older view where the card is now', async () => {
    await db
      .insert(elementMove)
      .values({ boardId: source, elementId: scene, toBoardId: storyboard });
    await notify(
      db,
      { actor: { userId: people.commenter.id }, projectId, boardId: source, elementId: scene },
      new Recipients(people.commenter.id).add(people.owner.id, 'comment'),
    );
    const [note] = await db.select().from(notification);
    expect(note?.boardId).toBe(storyboard);
    const res = await post('owner', `/boards/${production}/schedule`, 'POST', {
      date: '2026-12-03',
      callTime: '08:00',
      wrap: null,
      location: '',
      notes: '',
      blocks: [
        block({ shotId: scene, shotBoardId: source }),
        block({ shotId: other, shotBoardId: source }),
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().blocks.map((b: ScheduleBlock) => b.shotBoardId)).toEqual([
      storyboard,
      source,
    ]);
  });
});
