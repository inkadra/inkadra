import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { boardDocName, createBoardDoc, roots } from '@inkadra/doc-schema';
import { type Comment, type CommentThread, INLINE_REPLIES } from '@inkadra/shared';
import { Queue, QueueEvents } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import type { HTTPMethods } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { boardAccess, boardRoles, boardRolesForPeople } from '../access.ts';
import { createAuth } from '../auth.ts';
import { directBoardReader, storedElement } from '../board-content.ts';
import { directBoardWriter } from '../board-writer.ts';
import { createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  board,
  boardDoc,
  boardGrant,
  comment,
  elementReview,
  elementReviewEvent,
  invitation,
  notification,
  notificationPreference,
  project,
  projectMember,
  shareGuest,
  shareLink,
} from '../db/schema.ts';
import { acceptInvitation, INVITATION_COOKIE } from '../invitations.ts';
import { memoryMailer, noMailer } from '../mailer.ts';
import * as notifications from '../notifications.ts';
import {
  EMAIL_GROUP_DELAY_MS,
  purgeNotifications,
  sendDigests,
  sendImmediateEmails,
} from '../notifications.ts';
import {
  createRedis,
  QUEUES,
  queuedBoardWriter,
  startBoardWorker,
  startWorkers,
} from '../queues.ts';
import { sha256 } from '../secrets.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const log = pino({ level: 'silent' });
const roles = ['owner', 'editor', 'commenter', 'viewer', 'outsider'] as const;
type Who = (typeof roles)[number];

describe.skipIf(!url)('team comments, reviews and notifications', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const deps = testDeps(db, log);
  const collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
  const boardReader = directBoardReader(collab, db);
  const notices = { notify: vi.fn() };
  const people = {} as Record<Who, { id: string; cookie: string }>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let projectId: string;
  let root: string;
  let child: string;
  let foreign: string;
  const card = 'card-0001';

  const call = (
    who: Who | null,
    method: HTTPMethods,
    path: string,
    payload?: unknown,
    headers: Record<string, string | undefined> = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: {
        ...(who ? { cookie: people[who].cookie } : {}),
        origin: config.PUBLIC_URL,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const create = async (who: Who = 'commenter', input: Record<string, unknown> = {}) => {
    const res = await call(who, 'POST', `/boards/${root}/comments`, { body: 'Hello', ...input });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Comment>();
  };
  const list = async (who: Who = 'viewer', query = '') =>
    (await call(who, 'GET', `/boards/${root}/comments${query}`)).json<{
      items: CommentThread[];
      nextCursor: string | null;
    }>();
  const reviewPath = () => `/boards/${root}/elements/${card}/review`;

  async function store(boardId: string, cards: Array<Record<string, unknown>>) {
    const doc = createBoardDoc(boardId);
    for (const data of cards) {
      const map = new Y.Map<unknown>();
      roots(doc).elements.set(String(data.id), map);
      for (const [key, value] of Object.entries({ type: 'note', parent: null, ...data }))
        map.set(key, value);
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db
      .insert(boardDoc)
      .values({ boardId, state, size: state.length, schemaVersion: 3 })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state } });
    doc.destroy();
  }
  async function link(boardId = root, extra: Partial<typeof shareLink.$inferInsert> = {}) {
    const [row] = await db
      .insert(shareLink)
      .values({
        projectId,
        boardId,
        role: 'guest_comment',
        tokenHash: randomUUID(),
        tokenSealed: 'test-only',
        createdBy: people.owner.id,
        ...extra,
      })
      .returning();
    if (!row) throw new Error('Missing link');
    return row;
  }
  async function guest(linkId: string, name = 'Client') {
    const [row] = await db
      .insert(shareGuest)
      .values({ shareLinkId: linkId, name, sessionExpiresAt: new Date(Date.now() + 86400000) })
      .returning();
    if (!row) throw new Error('Missing guest');
    return row;
  }
  async function addNotification(
    who: Who,
    boardId: string | null = root,
    extra: Partial<typeof notification.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(notification)
      .values({
        userId: people[who].id,
        type: 'review',
        actorId: people.editor.id,
        projectId,
        boardId,
        reviewStatus: 'approved',
        ...extra,
      })
      .returning();
    if (!row) throw new Error('Missing notification');
    return row;
  }

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...deps, notices, boardReader });
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
    await app.close();
    await db.execute(sql`truncate project, notification, notification_preference cascade`);
    app = await createApp({ config, db, auth, log, ...deps, notices, boardReader });
    notices.notify.mockReset();
    projectId = randomUUID();
    root = randomUUID();
    child = randomUUID();
    foreign = randomUUID();
    const otherProject = randomUUID();
    await db.insert(project).values([
      { id: projectId, name: 'Project', position: 'a0' },
      { id: otherProject, name: 'Foreign', position: 'a1' },
    ]);
    await db.insert(board).values([
      { id: root, projectId, title: 'Root', position: 'a0' },
      { id: foreign, projectId: otherProject, title: 'Foreign', position: 'a0' },
    ]);
    await db
      .insert(board)
      .values({ id: child, projectId, parentBoardId: root, title: 'Child', position: 'a0' });
    for (const role of roles)
      if (role !== 'outsider')
        await db.insert(projectMember).values({ projectId, userId: people[role].id, role });
    await db
      .insert(projectMember)
      .values({ projectId: otherProject, userId: people.outsider.id, role: 'owner' });
    await store(root, [
      { id: card, createdBy: people.owner.id },
      { id: 'child-card', type: 'board', boardId: child },
    ]);
    await store(child, [{ id: 'child-note', createdBy: people.owner.id }]);
  });
  afterAll(async () => {
    await app?.close();
    await deps.jobs.idle();
    await collab.destroy();
    await client.end();
  });

  it.each(roles)('enforces all comment actions for %s', async (who) => {
    const thread = await create();
    const outsider = who === 'outsider';
    const writer = ['owner', 'editor', 'commenter'].includes(who);
    const reader = outsider ? 404 : 200;
    for (const path of [
      `/boards/${root}/comments`,
      `/boards/${root}/comment-counts`,
      `/comments/${thread.id}/replies`,
    ])
      expect((await call(who, 'GET', path)).statusCode).toBe(reader);
    expect((await call(who, 'POST', `/boards/${root}/comments`, { body: 'New' })).statusCode).toBe(
      outsider ? 404 : writer ? 201 : 403,
    );
    expect(
      (await call(who, 'PATCH', `/comments/${thread.id}`, { body: 'Edited' })).statusCode,
    ).toBe(outsider ? 404 : who === 'commenter' ? 200 : 403);
    for (const action of ['resolve', 'reopen'])
      expect((await call(who, 'POST', `/comments/${thread.id}/${action}`)).statusCode).toBe(
        outsider ? 404 : writer ? 200 : 403,
      );
    expect((await call(who, 'DELETE', `/comments/${thread.id}`)).statusCode).toBe(
      outsider ? 404 : writer ? 204 : 403,
    );
  });

  it('forbids a commenter deleting another writer’s comment', async () => {
    const other = await create('editor');
    expect((await call('commenter', 'DELETE', `/comments/${other.id}`)).statusCode).toBe(403);
    expect((await list()).items[0]?.id).toBe(other.id);
  });

  it('rejects pins on replies and resolving deleted placeholders', async () => {
    const thread = await create('commenter', { elementId: card });
    expect(
      (
        await call('editor', 'POST', `/boards/${root}/comments`, {
          parentId: thread.id,
          body: 'Pin',
          pin: { x: 0, y: 0 },
        })
      ).statusCode,
    ).toBe(400);
    await create('editor', { parentId: thread.id });
    await call('commenter', 'DELETE', `/comments/${thread.id}`);
    for (const action of ['resolve', 'reopen'])
      expect((await call('editor', 'POST', `/comments/${thread.id}/${action}`)).statusCode).toBe(
        404,
      );
  });

  it('preserves the first concurrent resolver and emits one notice', async () => {
    const thread = await create();
    notices.notify.mockClear();
    const results = await Promise.all(
      ['editor', 'owner'].map((who) => call(who as Who, 'POST', `/comments/${thread.id}/resolve`)),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]?.json().resolvedBy).toEqual(results[1]?.json().resolvedBy);
    expect(results[0]?.json().resolvedAt).toBe(results[1]?.json().resolvedAt);
    expect(notices.notify).toHaveBeenCalledTimes(1);
  });

  it('notifies living thread writers, prioritizes mentions, and excludes the actor and deleted authors', async () => {
    const thread = await create('owner');
    await create('editor', { parentId: thread.id });
    const reply = await create('commenter', {
      parentId: thread.id,
      body: `Hi @{${people.editor.id}}`,
    });
    const recipients = async (id: string) =>
      (await db.select().from(notification).where(eq(notification.commentId, id)))
        .map((n) => [n.userId, n.type])
        .sort();
    expect(await recipients(reply.id)).toEqual(
      [
        [people.owner.id, 'reply'],
        [people.editor.id, 'mention'],
      ].sort(),
    );
    await call('owner', 'DELETE', `/comments/${thread.id}`);
    const later = await create('editor', { parentId: thread.id });
    expect(await recipients(later.id)).toEqual([[people.commenter.id, 'reply']]);
  });

  it('limits creation and edits together and review writes per person', async () => {
    const thread = await create();
    for (let i = 0; i < 29; i++)
      expect(
        (await call('commenter', 'PATCH', `/comments/${thread.id}`, { body: `Edit ${i}` }))
          .statusCode,
      ).toBe(200);
    expect(
      (await call('commenter', 'PATCH', `/comments/${thread.id}`, { body: 'Over limit' }))
        .statusCode,
    ).toBe(429);
    expect(
      (await call('commenter', 'POST', `/boards/${root}/comments`, { body: 'Over limit' }))
        .statusCode,
    ).toBe(429);
    expect(
      (await call('editor', 'POST', `/boards/${root}/comments`, { body: 'Other person' }))
        .statusCode,
    ).toBe(201);
    for (let i = 0; i < 30; i++)
      expect(
        (
          await call('commenter', 'PUT', reviewPath(), {
            status: i % 2 ? 'approved' : 'changes_requested',
          })
        ).statusCode,
      ).toBe(200);
    expect((await call('commenter', 'PUT', reviewPath(), { status: 'none' })).statusCode).toBe(429);
    expect((await call('editor', 'PUT', reviewPath(), { status: 'none' })).statusCode).toBe(200);
  });

  it('keeps committed comments, edits and reviews successful when notifications or notices fail', async () => {
    const failing = vi
      .spyOn(notifications, 'notify')
      .mockRejectedValue(new Error('Notification unavailable'));
    notices.notify.mockImplementation(() => {
      throw new Error('Notice unavailable');
    });
    try {
      const thread = await create('commenter', { body: `Saved @{${people.owner.id}}` });
      expect(await db.select().from(comment)).toHaveLength(1);
      expect(
        (
          await call('commenter', 'PATCH', `/comments/${thread.id}`, {
            body: `Edited @{${people.editor.id}}`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await call('commenter', 'PUT', reviewPath(), { status: 'approved' })).statusCode,
      ).toBe(200);
      expect((await db.select().from(elementReview))[0]?.status).toBe('approved');
      expect(failing).toHaveBeenCalledTimes(3);
    } finally {
      failing.mockRestore();
    }
  });

  it('requires authentication for every new endpoint', async () => {
    const thread = await create();
    const endpoints: Array<[HTTPMethods, string, unknown?]> = [
      ['GET', `/boards/${root}/comments`],
      ['GET', `/boards/${root}/comment-counts`],
      ['POST', `/boards/${root}/comments`, { body: 'No' }],
      ['GET', `/comments/${thread.id}/replies`],
      ['PATCH', `/comments/${thread.id}`, { body: 'No' }],
      ['DELETE', `/comments/${thread.id}`],
      ['POST', `/comments/${thread.id}/resolve`],
      ['POST', `/comments/${thread.id}/reopen`],
      ['GET', `/boards/${root}/reviews`],
      ['PUT', reviewPath(), { status: 'approved' }],
      ['GET', `${reviewPath()}/history`],
      ['GET', '/me/notifications'],
      ['GET', '/me/notifications/unread-count'],
      ['POST', '/me/notifications/read-all'],
      ['POST', `/me/notifications/${randomUUID()}/read`],
      ['POST', `/me/notifications/${randomUUID()}/unread`],
      ['GET', '/me/notification-preferences'],
      ['PATCH', '/me/notification-preferences', { email: 'off' }],
    ];
    for (const [method, path, body] of endpoints)
      expect((await call(null, method, path, body)).statusCode, path).toBe(401);
  });

  it('keeps team readers across all link audiences and isolates replies across boards/projects', async () => {
    const a = await link();
    const b = await link();
    const clientA = await guest(a.id);
    const clientB = await guest(b.id, 'Other client');
    const thread = await create('owner', { visibility: 'everyone', shareLinkId: a.id });
    await db.insert(comment).values(
      [clientA, clientB].map((g) => ({
        projectId,
        boardId: root,
        threadId: thread.id,
        authorGuestId: g.id,
        shareLinkId: g.shareLinkId,
        visibility: 'everyone' as const,
        body: g.name ?? '',
      })),
    );
    const reply = await create('commenter', {
      parentId: thread.id,
      visibility: 'team',
      shareLinkId: b.id,
      elementId: 'ignored-card',
    });
    expect(reply).toMatchObject({ visibility: 'everyone', shareLinkId: null, elementId: null });
    const all = await list();
    expect(all.items[0]).toMatchObject({ shareLinkId: a.id, replyCount: 3 });
    expect(all.items[0]?.replies.map((r) => r.author.kind)).toEqual(['guest', 'guest', 'user']);
    expect(
      (
        await call('commenter', 'POST', `/boards/${child}/comments`, {
          body: 'Wrong board',
          parentId: thread.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('outsider', 'POST', `/boards/${foreign}/comments`, {
          body: 'Wrong project',
          parentId: thread.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('owner', 'POST', `/boards/${root}/comments`, {
          body: 'Nested',
          parentId: reply.id,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('validates audience reachability, active state and creator access at every hop', async () => {
    const active = await link();
    const make = (extra: Record<string, unknown>, boardId = root) =>
      call('commenter', 'POST', `/boards/${boardId}/comments`, {
        body: 'Audience',
        visibility: 'everyone',
        shareLinkId: active.id,
        ...extra,
      });
    expect((await make({})).statusCode).toBe(201);
    expect((await make({}, child)).statusCode).toBe(201);
    expect((await make({ visibility: 'team' })).statusCode).toBe(400);
    expect((await make({ shareLinkId: randomUUID() })).statusCode).toBe(400);
    await store(root, [
      { id: 'hidden', type: 'column', guestHidden: true },
      { id: 'child-card', type: 'board', boardId: child, parent: 'hidden' },
    ]);
    expect((await make({}, child)).statusCode).toBe(400);
    await store(root, [{ id: 'child-card', type: 'board', boardId: child }]);
    await db.insert(boardGrant).values({ boardId: child, userId: people.owner.id, role: 'viewer' });
    expect((await make({}, child)).statusCode).toBe(400);
    for (const patch of [
      { revokedAt: new Date() },
      { revokedAt: null, expiresAt: new Date(0) },
      { expiresAt: null, createdBy: people.viewer.id },
    ]) {
      await db.update(shareLink).set(patch).where(eq(shareLink.id, active.id));
      expect((await make({})).statusCode).toBe(400);
    }
    const foreignLink = await link(foreign, {
      projectId: (await db.select().from(board).where(eq(board.id, foreign)))[0]?.projectId,
    });
    expect((await make({ shareLinkId: foreignLink.id })).statusCode).toBe(400);
  });

  it('rejects view-only and unrelated same-project audience links with precise errors', async () => {
    const view = await link(root, { role: 'guest_view' });
    const unrelated = await link(child);
    for (const [shareLinkId, message] of [
      [view.id, 'The link cannot read comments.'],
      [unrelated.id, 'The link does not include this board.'],
    ]) {
      const result = await call('commenter', 'POST', `/boards/${root}/comments`, {
        body: 'Audience',
        visibility: 'everyone',
        shareLinkId,
      });
      expect(result.statusCode).toBe(400);
      expect(result.body).toContain(message);
    }
  });

  it('renders only readable mentions, deduplicates recipients and uses the current body', async () => {
    const body = `Hi @{${people.owner.id}} @{${people.viewer.id}} @{${people.outsider.id}} @{${people.commenter.id}} @{${people.owner.id}}`;
    const thread = await create('commenter', { body, elementId: card, pin: { x: 0.2, y: 1 } });
    expect(thread.mentions.map((m) => m.id).sort()).toEqual(
      [people.owner.id, people.viewer.id, people.commenter.id].sort(),
    );
    const rows = await db.select().from(notification);
    expect(rows.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [people.owner.id, 'mention'],
        [people.viewer.id, 'mention'],
      ].sort(),
    );
    const reply = await create('editor', {
      parentId: thread.id,
      body: `Reply @{${people.commenter.id}}`,
    });
    const recipients = await db
      .select()
      .from(notification)
      .where(eq(notification.commentId, reply.id));
    expect(recipients.map((n) => [n.userId, n.type])).toEqual([[people.commenter.id, 'mention']]);
    await call('editor', 'PATCH', `/comments/${reply.id}`, {
      body: `Edited @{${people.commenter.id}} @{${people.owner.id}}`,
    });
    expect(
      await db.select().from(notification).where(eq(notification.commentId, reply.id)),
    ).toHaveLength(2);
    const ownerNotices = (await call('owner', 'GET', '/me/notifications')).json().items;
    expect(ownerNotices[0].excerpt).toBe('Edited @commenter @owner');
    await db
      .delete(projectMember)
      .where(
        and(eq(projectMember.projectId, projectId), eq(projectMember.userId, people.viewer.id)),
      );
    const shown = await list('owner');
    expect(shown.items[0]?.mentions.some((m) => m.id === people.viewer.id)).toBe(false);
  });

  it('keeps malformed mention tokens as text and ignores non-account card authorship', async () => {
    await store(root, [{ id: card, createdBy: 'external-import-author' }]);
    const body = '@{------------------------------------} @{aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}';
    const created = await create('commenter', { elementId: card, body });
    expect(created.body).toBe(body);
    expect(created.mentions).toEqual([]);
    expect(await db.select().from(notification)).toEqual([]);
  });

  it('counts board/card threads, resolves idempotently, keeps tombstones and removed-card history', async () => {
    const thread = await create('commenter', { elementId: card });
    await create('editor');
    const reply = await create('owner', { parentId: thread.id });
    expect((await call('viewer', 'GET', `/boards/${root}/comment-counts`)).json().items).toEqual(
      expect.arrayContaining([
        { elementId: null, open: 1, resolved: 0 },
        { elementId: card, open: 1, resolved: 0 },
      ]),
    );
    const resolved = await call('editor', 'POST', `/comments/${thread.id}/resolve`);
    expect(resolved.json()).toMatchObject({
      resolvedBy: { kind: 'user', user: { id: people.editor.id } },
    });
    const same = await call('commenter', 'POST', `/comments/${thread.id}/resolve`);
    expect(same.json().resolvedAt).toBe(resolved.json().resolvedAt);
    expect(
      (await list('viewer', '?status=resolved&scope=elements')).items.map((r) => r.id),
    ).toEqual([thread.id]);
    expect((await list('viewer', '?scope=board')).items).toHaveLength(1);
    await call('editor', 'POST', `/comments/${thread.id}/reopen`);
    await store(root, []);
    expect((await list('viewer', `?elementId=${card}`)).items[0]?.id).toBe(thread.id);
    expect(
      (
        await call('commenter', 'POST', `/boards/${root}/comments`, {
          elementId: card,
          body: 'Missing',
        })
      ).statusCode,
    ).toBe(404);
    await call('commenter', 'DELETE', `/comments/${thread.id}`);
    const tombstone = (await list()).items.find((r) => r.id === thread.id);
    expect(tombstone).toMatchObject({
      body: '',
      mentions: [],
      canEdit: false,
      canDelete: false,
      replyCount: 1,
    });
    expect(tombstone?.deletedAt).toBeTruthy();
    expect(
      (await call('commenter', 'PATCH', `/comments/${thread.id}`, { body: 'Gone' })).statusCode,
    ).toBe(404);
    await call('owner', 'DELETE', `/comments/${reply.id}`);
    expect((await list('viewer', '?status=all')).items).toHaveLength(1);
    expect(notices.notify).toHaveBeenCalledWith(root, {
      type: 'comments',
      elementId: card,
      threadId: thread.id,
    });
  });

  it('keeps a successful concurrent reply when its thread start is deleted', async () => {
    const thread = await create();
    const [reply, removed] = await Promise.all([
      call('editor', 'POST', `/boards/${root}/comments`, {
        parentId: thread.id,
        body: 'Concurrent reply',
      }),
      call('commenter', 'DELETE', `/comments/${thread.id}`),
    ]);
    expect(removed.statusCode).toBe(204);
    expect([201, 404]).toContain(reply.statusCode);
    const remaining = (await list()).items;
    if (reply.statusCode === 201) {
      expect(remaining[0]).toMatchObject({ id: thread.id, body: '', replyCount: 1 });
      expect(remaining[0]?.replies[0]?.id).toBe(reply.json().id);
    } else expect(remaining).toEqual([]);
  });

  it('derives thread ids for mention, reply and commentless notifications', async () => {
    const start = await create('commenter', {
      elementId: card,
      body: `Hi @{${people.owner.id}}`,
    });
    const reply = await create('owner', { parentId: start.id });
    await addNotification('editor');
    const ownerItems = (await call('owner', 'GET', '/me/notifications')).json().items;
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({
      type: 'mention',
      commentId: start.id,
      threadId: start.id,
      excerpt: 'Hi @owner',
    });
    const commenterItems = (await call('commenter', 'GET', '/me/notifications')).json().items;
    expect(commenterItems).toHaveLength(1);
    expect(commenterItems[0]).toMatchObject({
      type: 'reply',
      commentId: reply.id,
      threadId: start.id,
    });
    const editorItems = (await call('editor', 'GET', '/me/notifications')).json().items;
    expect(editorItems).toHaveLength(1);
    expect(editorItems[0]).toMatchObject({
      type: 'review',
      commentId: null,
      threadId: null,
    });
  });

  it('keeps derived thread ids when a start with replies becomes a deleted placeholder', async () => {
    const start = await create('owner', { body: `Hi @{${people.editor.id}}` });
    const reply = await create('editor', { parentId: start.id });
    await call('owner', 'DELETE', `/comments/${start.id}`);
    const ownerItems = (await call('owner', 'GET', '/me/notifications')).json().items;
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({
      type: 'reply',
      commentId: reply.id,
      threadId: start.id,
      excerpt: 'Hello',
    });
    const editorItems = (await call('editor', 'GET', '/me/notifications')).json().items;
    expect(editorItems).toHaveLength(1);
    expect(editorItems[0]).toMatchObject({
      type: 'mention',
      commentId: start.id,
      threadId: start.id,
      excerpt: null,
    });
    const replyRow = (await db.select().from(comment).where(eq(comment.id, reply.id)))[0];
    expect(replyRow?.threadId).toBe(start.id);
  });

  it('applies a closest board grant to a downgraded author and retains guest attribution', async () => {
    const thread = await create();
    await db
      .insert(boardGrant)
      .values({ boardId: root, userId: people.commenter.id, role: 'viewer' });
    expect((await list('commenter')).items[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect(
      (await call('commenter', 'PATCH', `/comments/${thread.id}`, { body: 'No longer allowed' }))
        .statusCode,
    ).toBe(403);
    expect((await call('commenter', 'DELETE', `/comments/${thread.id}`)).statusCode).toBe(403);
    expect((await call('commenter', 'POST', `/comments/${thread.id}/resolve`)).statusCode).toBe(
      403,
    );
    const l = await link();
    const g = await guest(l.id);
    await db.insert(comment).values({
      projectId,
      boardId: root,
      authorGuestId: g.id,
      shareLinkId: l.id,
      visibility: 'everyone',
      body: 'Guest thread',
    });
    const guestThread = (await list('owner')).items.find((r) => r.author.kind === 'guest');
    expect(guestThread?.author).toMatchObject({ kind: 'guest', name: 'Client', shareLinkId: l.id });
    expect(
      (
        await call('editor', 'PATCH', `/comments/${guestThread?.id}`, {
          body: 'Cannot impersonate guest',
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('editor', 'DELETE', `/comments/${guestThread?.id}`)).statusCode).toBe(204);
  });

  it('pages threads with stable ties/microseconds and returns the latest 50 inline replies', async () => {
    const ids = Array.from(
      { length: 4 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    for (const [i, id] of ids.entries())
      await db.execute(sql`insert into comment(id, project_id, board_id, author_id, body, created_at)
      values (${id}, ${projectId}, ${root}, ${people.commenter.id}, 'Page', ${`2026-01-01 10:00:00.00000${i < 2 ? 1 : 2}+00`}::timestamptz)`);
    const first = await list('viewer', '?limit=2');
    expect(first.items.map((r) => r.id)).toEqual([ids[3], ids[2]]);
    await call('editor', 'PATCH', `/comments/${ids[0]}`, { body: 'Changed' });
    await create('editor');
    const second = await list('viewer', `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((r) => r.id)).toEqual([ids[1], ids[0]]);
    expect(second.nextCursor).toBeNull();
    const threadId = ids[3] as string;
    const replyIds = Array.from({ length: INLINE_REPLIES + 3 }, () => randomUUID()).sort();
    await db.insert(comment).values(
      replyIds.map((id) => ({
        id,
        projectId,
        boardId: root,
        threadId,
        authorId: people.editor.id,
        body: id,
        createdAt: new Date('2026-02-01T00:00:00Z'),
      })),
    );
    const inline = (await list()).items.find((r) => r.id === threadId);
    expect(inline?.replyCount).toBe(53);
    expect(inline?.replies.map((r) => r.id)).toEqual(replyIds.slice(-50));
    let cursor: string | null = null;
    const all: string[] = [];
    do {
      const page: { items: Comment[]; nextCursor: string | null } = (
        await call(
          'viewer',
          'GET',
          `/comments/${threadId}/replies?limit=17${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json();
      all.push(...page.items.map((r: Comment) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(all).toEqual(replyIds);
    for (const path of [
      `/boards/${root}/comments`,
      `/comments/${threadId}/replies`,
      '/me/notifications',
      `${reviewPath()}/history`,
    ])
      expect((await call('viewer', 'GET', `${path}?cursor=garbage`)).statusCode).toBe(400);
  });

  it.each(roles)('enforces review reads, history and writes for %s', async (who) => {
    const expectedRead = who === 'outsider' ? 404 : 200;
    expect((await call(who, 'GET', `/boards/${root}/reviews`)).statusCode).toBe(expectedRead);
    expect((await call(who, 'GET', `${reviewPath()}/history`)).statusCode).toBe(expectedRead);
    expect(
      (await call(who, 'PUT', reviewPath(), { status: 'approved', note: 'Good' })).statusCode,
    ).toBe(who === 'outsider' ? 404 : who === 'viewer' ? 403 : 200);
    expect(
      (
        await call('owner', 'PUT', `/boards/${child}/elements/${card}/review`, {
          status: 'approved',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('owner', 'GET', `/boards/${foreign}/reviews`)).statusCode).toBe(404);
  });

  it('keeps team/link reviews separate, history append-only and requested_by notified once', async () => {
    await call('commenter', 'PUT', reviewPath(), { status: 'in_review', note: 'Please' });
    const l = await link();
    const g = await guest(l.id);
    await db.insert(elementReview).values({
      boardId: root,
      elementId: card,
      projectId,
      status: 'changes_requested',
      shareLinkId: l.id,
      changedByGuest: g.id,
      changedAt: new Date(Date.now() + 1000),
    });
    await db.insert(elementReviewEvent).values({
      boardId: root,
      elementId: card,
      previous: 'none',
      status: 'changes_requested',
      shareLinkId: l.id,
      guestId: g.id,
    });
    const set = await call('editor', 'PUT', reviewPath(), { status: 'approved' });
    expect(set.json()).toMatchObject({
      status: 'approved',
      changedBy: { kind: 'user', user: { id: people.editor.id } },
    });
    const winner = (await call('viewer', 'GET', `/boards/${root}/reviews`)).json().items[0];
    expect(winner).toMatchObject({
      status: 'changes_requested',
      changedBy: { kind: 'guest', guestId: g.id, shareLinkId: l.id },
    });
    const reviewNotices = await db
      .select()
      .from(notification)
      .where(eq(notification.reviewStatus, 'approved'));
    expect(reviewNotices.map((n) => n.userId).sort()).toEqual(
      [people.owner.id, people.commenter.id].sort(),
    );
    const rows = await db.select().from(elementReview);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.shareLinkId === null)?.requestedBy).toBe(people.commenter.id);
    await call('editor', 'PUT', reviewPath(), { status: 'approved' });
    expect(await db.select().from(elementReviewEvent)).toHaveLength(3);
    const history = (await call('viewer', 'GET', `${reviewPath()}/history?limit=2`)).json();
    const older = (
      await call('viewer', 'GET', `${reviewPath()}/history?limit=2&cursor=${history.nextCursor}`)
    ).json();
    expect(history.items).toHaveLength(2);
    expect(older.items).toHaveLength(1);
    expect(
      history.items.find((r: { changedBy: { kind: string } }) => r.changedBy.kind === 'guest')
        .changedBy.shareLinkId,
    ).toBe(l.id);
    expect(older.items[0]).toMatchObject({ status: 'in_review', previous: 'none' });
    await db
      .update(elementReview)
      .set({ status: 'none' })
      .where(eq(elementReview.shareLinkId, l.id));
    expect((await call('viewer', 'GET', `/boards/${root}/reviews`)).json().items[0].status).toBe(
      'approved',
    );
    await call('commenter', 'PUT', reviewPath(), { status: 'none' });
    expect((await call('viewer', 'GET', `/boards/${root}/reviews`)).json().items).toEqual([]);
    expect(notices.notify).toHaveBeenCalledWith(root, { type: 'review', elementId: card });
  });

  it('skips initial none review events and notifies the card author and requester once each', async () => {
    expect((await call('commenter', 'PUT', reviewPath(), { status: 'none' })).statusCode).toBe(200);
    expect(await db.select().from(elementReviewEvent)).toEqual([]);
    expect(notices.notify).not.toHaveBeenCalled();
    await call('commenter', 'PUT', reviewPath(), { status: 'in_review' });
    await call('editor', 'PUT', reviewPath(), { status: 'approved' });
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.reviewStatus, 'approved'));
    expect(rows.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [people.owner.id, 'review'],
        [people.commenter.id, 'review'],
      ].sort(),
    );
    await call('editor', 'PUT', reviewPath(), { status: 'approved' });
    expect(
      await db.select().from(notification).where(eq(notification.reviewStatus, 'approved')),
    ).toHaveLength(2);
  });

  it('compares review timestamps at full precision and prefers team on an exact tie', async () => {
    const l = await link();
    const g = await guest(l.id);
    await call('commenter', 'PUT', reviewPath(), { status: 'approved' });
    await db.insert(elementReview).values({
      boardId: root,
      elementId: card,
      projectId,
      shareLinkId: l.id,
      changedByGuest: g.id,
      status: 'changes_requested',
    });
    await db.execute(
      sql`update element_review set changed_at = '2026-01-01 00:00:00.000001+00' where board_id = ${root}`,
    );
    const get = async () =>
      (await call('viewer', 'GET', `/boards/${root}/reviews`)).json().items[0].status;
    expect(await get()).toBe('approved');
    await db.execute(
      sql`update element_review set changed_at = '2026-01-01 00:00:00.000002+00' where share_link_id = ${l.id}`,
    );
    expect(await get()).toBe('changes_requested');
  });

  it.each(roles)('scopes notification/preferences endpoints to %s', async (who) => {
    const n = await addNotification(
      who,
      who === 'outsider' ? foreign : root,
      who === 'outsider'
        ? { projectId: (await db.select().from(board).where(eq(board.id, foreign)))[0]?.projectId }
        : {},
    );
    expect(
      (await call(who, 'GET', '/me/notifications')).json().items.map((r: { id: string }) => r.id),
    ).toEqual([n.id]);
    expect((await call(who, 'GET', '/me/notifications/unread-count')).json()).toEqual({
      unread: 1,
    });
    expect((await call(who, 'POST', `/me/notifications/${n.id}/read`)).statusCode).toBe(204);
    expect((await call(who, 'GET', '/me/notifications?unread=true')).json().items).toEqual([]);
    expect((await call(who, 'POST', `/me/notifications/${n.id}/unread`)).statusCode).toBe(204);
    expect((await call(who, 'POST', '/me/notifications/read-all')).json()).toEqual({ unread: 0 });
    const other = who === 'owner' ? 'editor' : 'owner';
    expect((await call(other, 'POST', `/me/notifications/${n.id}/read`)).statusCode).toBe(404);
    expect((await call(who, 'GET', '/me/notification-preferences')).json()).toEqual({
      email: 'immediate',
    });
    expect(
      (await call(who, 'PATCH', '/me/notification-preferences', { email: 'daily' })).json(),
    ).toEqual({ email: 'daily' });
    expect((await call(other, 'GET', '/me/notification-preferences')).json()).toEqual({
      email: 'immediate',
    });
    expect(
      (await call(who, 'PATCH', '/me/notification-preferences', { email: 'invalid' })).statusCode,
    ).toBe(400);
  });

  it('filters list, unread badge and mark-read consistently after access loss, even on empty pages', async () => {
    const old = await addNotification('viewer', root, {
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const hidden = await addNotification('viewer', foreign, {
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const page = (await call('viewer', 'GET', '/me/notifications?limit=1')).json();
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeTruthy();
    expect(
      (await call('viewer', 'GET', `/me/notifications?limit=1&cursor=${page.nextCursor}`)).json()
        .items[0].id,
    ).toBe(old.id);
    expect((await call('viewer', 'GET', '/me/notifications/unread-count')).json()).toEqual({
      unread: 1,
    });
    expect((await call('viewer', 'POST', `/me/notifications/${hidden.id}/read`)).statusCode).toBe(
      404,
    );
    await call('viewer', 'POST', '/me/notifications/read-all', { before: '2026-01-01T12:00:00Z' });
    expect(
      (await db.select().from(notification).where(eq(notification.id, hidden.id)))[0]?.readAt,
    ).toBeNull();
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, root));
    expect((await call('viewer', 'POST', `/me/notifications/${old.id}/unread`)).statusCode).toBe(
      404,
    );
    expect((await call('viewer', 'GET', '/me/notifications')).json().items).toEqual([]);
  });

  it('marks only accessible board, project and instance rows read in one update', async () => {
    await db
      .insert(boardGrant)
      .values({ boardId: child, userId: people.outsider.id, role: 'viewer' });
    const visible = await Promise.all([
      addNotification('outsider', child),
      addNotification('outsider', null),
      addNotification('outsider', null, { projectId: null }),
    ]);
    const hidden = await addNotification('outsider', root);
    const later = await addNotification('outsider', child, {
      createdAt: new Date(Date.now() + 86400000),
    });
    const update = vi.spyOn(db, 'update');
    try {
      expect((await call('outsider', 'POST', '/me/notifications/read-all')).statusCode).toBe(200);
      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      update.mockRestore();
    }
    const rows = await db.select().from(notification);
    for (const row of rows) expect(row.readAt !== null).toBe(visible.some((n) => n.id === row.id));
    expect(rows.find((r) => r.id === hidden.id)?.readAt).toBeNull();
    expect(rows.find((r) => r.id === later.id)?.readAt).toBeNull();
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, child));
    await call('outsider', 'POST', '/me/notifications/read-all', {
      before: new Date(Date.now() + 2 * 86400000).toISOString(),
    });
    expect(
      (await db.select().from(notification).where(eq(notification.id, later.id)))[0]?.readAt,
    ).toBeNull();
  });

  it('bounds notification fan-out per actor without failing writes', async () => {
    const l = await link();
    const g = await guest(l.id);
    const recipients = new notifications.Recipients(null);
    for (const who of roles.filter((r) => r !== 'outsider'))
      recipients.add(people[who].id, 'reply');
    let count = 0;
    for (let i = 0; i < 80; i++)
      count += await notifications.notify(
        db,
        {
          actor: { guestId: g.id },
          projectId,
          boardId: root,
        },
        recipients,
      );
    expect(count).toBe(300);
    expect(await db.select().from(notification)).toHaveLength(300);
    // Another actor has an independent budget.
    expect(
      await notifications.notify(
        db,
        { actor: { userId: people.outsider.id }, projectId, boardId: root },
        recipients,
      ),
    ).toBe(4);
  });

  it('matches batched access to boardAccess for project roles and closest grants', async () => {
    await db.insert(boardGrant).values([
      { boardId: root, userId: people.outsider.id, role: 'commenter' },
      { boardId: child, userId: people.outsider.id, role: 'viewer' },
      { boardId: child, userId: people.owner.id, role: 'viewer' },
    ]);
    for (const id of [root, child, foreign]) {
      const batched = await boardRolesForPeople(
        db,
        id,
        roles.map((who) => people[who].id),
      );
      for (const who of roles)
        expect(batched.get(people[who].id) ?? null).toBe(
          (await boardAccess(db, people[who], id))?.role ?? null,
        );
    }
    for (const who of roles) {
      const batched = await boardRoles(db, people[who], [root, child, foreign, randomUUID()]);
      for (const id of [root, child, foreign])
        expect(batched.get(id) ?? null).toBe(
          (await boardAccess(db, people[who], id))?.role ?? null,
        );
    }
  });

  it('groups immediate emails, rechecks permissions, honors off/read/no-SMTP and retries SMTP failures', async () => {
    const mailer = memoryMailer();
    const mailDeps = { db, log, mailer, publicUrl: config.PUBLIC_URL, instanceName: 'Studio' };
    const first = await create('commenter', { body: `Hi @{${people.owner.id}}`, elementId: card });
    await create('editor', { parentId: first.id });
    await db
      .update(notification)
      .set({ createdAt: new Date(Date.now() - EMAIL_GROUP_DELAY_MS - 1000) });
    await addNotification('viewer', foreign, { createdAt: new Date(Date.now() - 600000) });
    await call('commenter', 'PATCH', '/me/notification-preferences', { email: 'off' });
    await call('commenter', 'PATCH', `/comments/${first.id}`, {
      body: `Current @{${people.owner.id}} <script>`,
    });
    expect(await sendImmediateEmails(mailDeps)).toEqual({ sent: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('owner@example.com');
    expect(mailer.sent[0]?.text).toContain('Current @owner <script>');
    expect(mailer.sent[0]?.html).toContain('&#60;script&#62;');
    expect(await sendImmediateEmails(mailDeps)).toEqual({ sent: 0 });
    const pending = await addNotification('owner', root, {
      createdAt: new Date(Date.now() - 600000),
    });
    expect(await sendImmediateEmails({ ...mailDeps, mailer: noMailer })).toEqual({ sent: 0 });
    await sendImmediateEmails({
      ...mailDeps,
      mailer: {
        enabled: true,
        async send() {
          throw new Error('SMTP unavailable');
        },
      },
    });
    expect(
      (await db.select().from(notification).where(eq(notification.id, pending.id)))[0]?.emailedAt,
    ).toBeNull();
    expect(await sendImmediateEmails(mailDeps)).toEqual({ sent: 1 });
    const fresh = await addNotification('owner');
    expect(await sendImmediateEmails(mailDeps)).toEqual({ sent: 0 });
    await call('owner', 'POST', `/me/notifications/${fresh.id}/read`);
    expect(await sendImmediateEmails(mailDeps, new Date(Date.now() + 600000))).toEqual({ sent: 0 });
  });

  it('pages mail past inaccessible notifications and retains older unread entries for delivery', async () => {
    const mailer = memoryMailer();
    await db.insert(notification).values(
      Array.from({ length: 501 }, () => ({
        userId: people.owner.id,
        type: 'review' as const,
        projectId,
        boardId: foreign,
        createdAt: new Date(Date.now() - 31 * 86400000),
      })),
    );
    await addNotification('owner', root, { createdAt: new Date(Date.now() - 30 * 86400000) });
    expect(
      await sendImmediateEmails({
        db,
        log,
        mailer,
        publicUrl: config.PUBLIC_URL,
        instanceName: 'Studio',
      }),
    ).toEqual({ sent: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain('Root');
    expect(mailer.sent[0]?.text).not.toContain('Foreign');
    const hidden = await db.select().from(notification).where(eq(notification.boardId, foreign));
    expect(hidden).toHaveLength(501);
    expect(hidden.every((n) => n.emailedAt !== null)).toBe(true);
    expect(
      await sendImmediateEmails({
        db,
        log,
        mailer,
        publicUrl: config.PUBLIC_URL,
        instanceName: 'Studio',
      }),
    ).toEqual({ sent: 0 });
  });

  it.each(['immediate', 'daily'] as const)(
    'starts %s email after re-enabling, without the off backlog',
    async (email) => {
      const mailer = memoryMailer();
      const mailDeps = { db, log, mailer, publicUrl: config.PUBLIC_URL, instanceName: 'Studio' };
      const beforeOff = await addNotification('owner');
      await call('owner', 'PATCH', '/me/notification-preferences', { email: 'off' });
      const duringOff = await addNotification('owner');
      await call('owner', 'PATCH', '/me/notification-preferences', { email });
      const fresh = await addNotification('owner');
      const send = email === 'daily' ? sendDigests : sendImmediateEmails;
      expect(await send(mailDeps, new Date(Date.now() + EMAIL_GROUP_DELAY_MS + 1000))).toEqual({
        sent: 1,
      });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.text.match(/Root/g) ?? []).toHaveLength(1);
      const old = await db
        .select()
        .from(notification)
        .where(sql`${notification.id} in (${beforeOff.id}, ${duringOff.id})`);
      expect(old.every((n) => n.emailedAt !== null && n.readAt === null)).toBe(true);
      expect(
        (await db.select().from(notification).where(eq(notification.id, fresh.id)))[0]?.emailedAt,
      ).not.toBeNull();
      expect((await call('owner', 'GET', '/me/notifications')).json().items).toHaveLength(3);
    },
  );

  it('releases a digest claim when the rows become read before sending', async () => {
    const mailer = memoryMailer();
    await call('owner', 'PATCH', '/me/notification-preferences', { email: 'daily' });
    const pending = await addNotification('owner');
    const execute = db.execute.bind(db);
    let accessChecks = 0;
    const race = vi.spyOn(db, 'execute').mockImplementation((async (
      ...args: Parameters<typeof db.execute>
    ) => {
      const result = await execute(...args);
      if (++accessChecks === 2) {
        // Access is checked once while collecting mail and again immediately before sending.
        await db
          .update(notification)
          .set({ readAt: new Date() })
          .where(eq(notification.id, pending.id));
      }
      return result;
    }) as typeof db.execute);
    try {
      expect(
        await sendDigests({
          db,
          log,
          mailer,
          publicUrl: config.PUBLIC_URL,
          instanceName: 'Studio',
        }),
      ).toEqual({ sent: 0 });
      expect((await db.select().from(notificationPreference))[0]?.lastDigestAt).toBeNull();
    } finally {
      race.mockRestore();
    }
  });

  it('sends unread daily digests once a day, retries failures and purges only after 90 days', async () => {
    const mailer = memoryMailer();
    const mailDeps = { db, log, mailer, publicUrl: config.PUBLIC_URL, instanceName: 'Studio' };
    await call('owner', 'PATCH', '/me/notification-preferences', { email: 'daily' });
    const old = new Date(Date.now() - 600000);
    await addNotification('owner', root, { createdAt: old });
    await addNotification('viewer', root, { createdAt: old, readAt: new Date() });
    await sendDigests({
      ...mailDeps,
      mailer: {
        enabled: true,
        async send() {
          throw new Error('SMTP unavailable');
        },
      },
    });
    expect(await sendDigests(mailDeps)).toEqual({ sent: 1 });
    await addNotification('owner');
    expect(await sendDigests(mailDeps)).toEqual({ sent: 0 });
    expect(await sendDigests(mailDeps, new Date(Date.now() + 25 * 3600000))).toEqual({ sent: 1 });
    const expired = await addNotification('owner', root, {
      createdAt: new Date(Date.now() - 91 * 86400000),
    });
    await addNotification('owner', root, { createdAt: new Date(Date.now() - 89 * 86400000) });
    await db.insert(notification).values(
      Array.from({ length: 1001 }, () => ({
        userId: people.owner.id,
        type: 'review' as const,
        createdAt: new Date(Date.now() - 91 * 86400000),
      })),
    );
    expect(await purgeNotifications(db)).toEqual({ removed: 1002 });
    expect(await db.select().from(notification).where(eq(notification.id, expired.id))).toEqual([]);
  });

  it.skipIf(!process.env.REDIS_URL)('runs mail and retention as isolated BullMQ jobs', async () => {
    const redisUrl = process.env.REDIS_URL as string;
    const prefix = `inkadra-comments-${randomUUID()}`;
    const mailer = memoryMailer();
    await addNotification('owner', root, { createdAt: new Date(Date.now() - 600000) });
    await addNotification('owner', root, { createdAt: new Date(Date.now() - 91 * 86400000) });
    const workers = await startWorkers(
      redisUrl,
      log,
      {
        db,
        storage: deps.storage,
        tmpDir: `${deps.root}/tmp`,
        heic: true,
        mailer,
        publicUrl: config.PUBLIC_URL,
        instanceName: 'Studio',
      },
      { prefix },
    );
    const connection = createRedis(redisUrl);
    const email = new Queue(QUEUES.email, { connection, prefix });
    const maintenance = new Queue(QUEUES.maintenance, { connection, prefix });
    const events = new QueueEvents(QUEUES.email, { connection: createRedis(redisUrl), prefix });
    const maintenanceEvents = new QueueEvents(QUEUES.maintenance, {
      connection: createRedis(redisUrl),
      prefix,
    });
    try {
      await Promise.all([events.waitUntilReady(), maintenanceEvents.waitUntilReady()]);
      const job = await email.add('notifications', {});
      await job.waitUntilFinished(events, 5000);
      expect(mailer.sent).toHaveLength(1);
      expect((await email.getJobSchedulers()).map((s) => s.name).sort()).toEqual([
        'digest',
        'notifications',
      ]);
      const cleanup = await maintenance.add('purge-notifications', {});
      await cleanup.waitUntilFinished(maintenanceEvents, 5000);
      expect(await db.select().from(notification)).toHaveLength(1);
    } finally {
      await workers.close();
      for (const queue of [email, maintenance]) {
        for (const scheduler of await queue.getJobSchedulers())
          await queue.removeJobScheduler(scheduler.key);
        await queue.drain(true);
      }
      await Promise.all([
        email.close(),
        maintenance.close(),
        events.close(),
        maintenanceEvents.close(),
      ]);
      connection.disconnect();
    }
  });

  it.each(['direct', ...(process.env.REDIS_URL ? ['queued'] : [])])(
    'uses %s live cards before persistence without weakening board permissions',
    async (mode) => {
      const prefix = `issue39-${randomUUID()}`;
      const queued =
        mode === 'queued' ? queuedBoardWriter(process.env.REDIS_URL as string, { prefix }) : null;
      const worker = queued
        ? startBoardWorker(process.env.REDIS_URL as string, directBoardWriter(collab), log, {
            prefix,
            reader: boardReader,
          })
        : null;
      if (queued) {
        await app.close();
        app = await createApp({
          config,
          db,
          auth,
          log,
          ...deps,
          notices,
          boardReader: queued.reader,
        });
      }
      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(root));
      try {
        const doc = connection.document;
        if (!doc) throw new Error('Missing live document');
        const fresh = 'fresh-card';
        const map = new Y.Map<unknown>();
        roots(doc).elements.set(fresh, map);
        map.set('createdBy', people.owner.id);
        map.set('type', 'note');
        expect(await storedElement(db, root, fresh)).toBeNull();
        // The stored document still contains only the original cards.
        const path = `/boards/${root}/elements/${fresh}/review`;
        for (const who of ['commenter', 'editor'] as const) {
          expect(
            (
              await call(who, 'POST', `/boards/${root}/comments`, {
                body: 'New card',
                elementId: fresh,
              })
            ).statusCode,
          ).toBe(201);
          expect((await call(who, 'PUT', path, { status: 'approved' })).statusCode).toBe(200);
        }
        for (const [who, status] of [
          ['viewer', 403],
          ['outsider', 404],
        ] as const) {
          expect(
            (
              await call(who, 'POST', `/boards/${root}/comments`, {
                body: 'Denied',
                elementId: fresh,
              })
            ).statusCode,
          ).toBe(status);
          expect((await call(who, 'PUT', path, { status: 'approved' })).statusCode).toBe(status);
        }
        roots(doc).elements.delete(card);
        for (const id of ['missing-card', card]) {
          expect(
            (
              await call('editor', 'POST', `/boards/${root}/comments`, {
                body: 'Missing',
                elementId: id,
              })
            ).statusCode,
          ).toBe(404);
          expect(
            (
              await call('editor', 'PUT', `/boards/${root}/elements/${id}/review`, {
                status: 'approved',
              })
            ).statusCode,
          ).toBe(404);
        }
        expect(
          (
            await call('owner', 'POST', `/boards/${child}/comments`, {
              body: 'Wrong board',
              elementId: fresh,
            })
          ).statusCode,
        ).toBe(404);
        expect(await db.select().from(notification)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ userId: people.owner.id, type: 'comment', elementId: fresh }),
          ]),
        );
      } finally {
        await connection.disconnect();
        await worker?.close();
        await queued?.close();
      }
    },
  );

  it.each(['project', 'board', 'registration'] as const)(
    'serializes reusable %s invitation acceptance and retries',
    async (target) => {
      const [inv] = await db
        .insert(invitation)
        .values({
          kind: 'link',
          projectId: target === 'registration' ? null : projectId,
          boardId: target === 'board' ? root : null,
          role: target === 'registration' ? null : 'commenter',
          invitedBy: people.owner.id,
          tokenHash: randomUUID(),
          tokenSealed: 'test-only',
          maxUses: null,
          expiresAt: new Date(Date.now() + 86400000),
        })
        .returning();
      if (!inv) throw new Error('Missing invitation');
      await Promise.all(
        Array.from({ length: 4 }, () => acceptInvitation(db, inv.id, people.outsider.id)),
      );
      await acceptInvitation(db, inv.id, people.outsider.id);
      expect(await db.select().from(notification)).toHaveLength(1);
      expect((await db.select().from(invitation).where(eq(invitation.id, inv.id)))[0]?.uses).toBe(
        5,
      );
      // A different recipient still redeems the reusable link (upgrading their viewer role).
      await acceptInvitation(db, inv.id, people.viewer.id);
      expect(await db.select().from(notification)).toHaveLength(2);
      expect((await db.select().from(invitation).where(eq(invitation.id, inv.id)))[0]?.uses).toBe(
        6,
      );
      // Another invitation to the same target is a different acceptance.
      const [second] = await db
        .insert(invitation)
        .values({
          ...inv,
          id: randomUUID(),
          tokenHash: randomUUID(),
          uses: 0,
        })
        .returning();
      if (!second) throw new Error('Missing second invitation');
      await acceptInvitation(db, second.id, people.outsider.id);
      expect(await db.select().from(notification)).toHaveLength(3);
      await acceptInvitation(db, second.id, people.owner.id);
      expect(await db.select().from(notification)).toHaveLength(3);
    },
  );

  it('deduplicates a reusable link redeemed by sign-up and then the accept endpoint', async () => {
    const token = randomUUID();
    await db.insert(invitation).values({
      kind: 'link',
      projectId,
      role: 'commenter',
      invitedBy: people.owner.id,
      tokenHash: sha256(token),
      tokenSealed: 'test-only',
      maxUses: null,
      expiresAt: new Date(Date.now() + 86400000),
    });
    const signedUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL, cookie: `${INVITATION_COOKIE}=${token}` },
      payload: {
        email: `${randomUUID()}@example.com`,
        name: 'New member',
        password: 'correct-horse-battery',
      },
    });
    expect(signedUp.statusCode, signedUp.body).toBe(200);
    const cookie = String(signedUp.headers['set-cookie']).split(';')[0] ?? '';
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/by-token/${token}/accept`,
      headers: { origin: config.PUBLIC_URL, cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  it('notifies inviters once for email acceptance and never the actor', async () => {
    const [inv] = await db
      .insert(invitation)
      .values({
        kind: 'email',
        email: 'outsider@example.com',
        projectId,
        role: 'viewer',
        invitedBy: people.owner.id,
        tokenHash: randomUUID(),
        tokenSealed: 'test-only',
        maxUses: 1,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!inv) throw new Error('Missing invitation');
    await acceptInvitation(db, inv.id, people.outsider.id);
    await acceptInvitation(db, inv.id, people.outsider.id);
    const rows = await db.select().from(notification);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: people.owner.id,
      actorId: people.outsider.id,
      type: 'invitation_accepted',
    });
  });

  it('rejects cross-site cookies and accepts real same-origin and bearer requests', async () => {
    for (const headers of [
      { origin: 'http://evil.example' },
      { origin: 'null' },
      { origin: config.PUBLIC_URL, 'sec-fetch-site': 'cross-site' },
    ]) {
      const res = await call(
        'owner',
        'POST',
        `/boards/${root}/comments`,
        { body: 'Origin' },
        headers,
      );
      expect(res.statusCode).toBe(headers.origin === config.PUBLIC_URL ? 201 : 403);
    }
    for (const site of ['same-origin', 'same-site', 'cross-site', 'none']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/boards/${root}/comments`,
        headers: { cookie: people.owner.cookie, 'sec-fetch-site': site },
        payload: { body: 'Fetch metadata' },
      });
      expect(res.statusCode).toBe(site === 'same-origin' ? 201 : 403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { cookie: people.owner.cookie },
          payload: { name: 'Existing endpoint' },
        })
      ).statusCode,
    ).toBe(403);
    const token = await issueToken(db, people.owner.id, { name: 'Test' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/boards/${root}/comments`,
          headers: {
            authorization: `Bearer ${token.token}`,
            origin: 'http://other.example',
          },
          payload: { body: 'Bearer' },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/boards/${root}/comments`,
          headers: {
            authorization: 'Bearer invalid',
            origin: 'http://other.example',
          },
          payload: { body: 'Invalid bearer' },
        })
      ).statusCode,
    ).toBe(401);
  });
});
