import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import type {
  Comment,
  CommentThread,
  ElementReactions,
  ReactionEmoji,
  Reactions,
} from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import type { HTTPMethods } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { directBoardReader } from '../board-content.ts';
import { createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, boardDoc, project, projectMember } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const log = pino({ level: 'silent' });
const roles = ['owner', 'commenter', 'viewer', 'other'] as const;
type Who = (typeof roles)[number];
const thumbs = encodeURIComponent('👍');
const heart = encodeURIComponent('❤️');

describe.skipIf(!url)('quick reactions, unread and mentions on comments', () => {
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
  const collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
  const boardReader = directBoardReader(collab, db);
  const notices = { notify: vi.fn() };
  const people = {} as Record<Who, { id: string; cookie: string }>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let projectId: string;
  let root: string;
  const card = 'card-0001';

  const call = (who: Who, method: HTTPMethods, path: string, payload?: unknown) =>
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
  const create = async (who: Who, input: Record<string, unknown> = {}) => {
    const res = await call(who, 'POST', `/boards/${root}/comments`, { body: 'Hello', ...input });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Comment>();
  };
  const threads = async (who: Who) =>
    (await call(who, 'GET', `/boards/${root}/comments?status=all`)).json<{
      items: CommentThread[];
    }>().items;

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
    await db.insert(project).values({ id: projectId, name: 'Project', position: 'a0' });
    await db.insert(board).values({ id: root, projectId, title: 'Root', position: 'a0' });
    for (const role of ['owner', 'commenter', 'viewer'] as const)
      await db.insert(projectMember).values({ projectId, userId: people[role].id, role });
    const doc = createBoardDoc(root);
    const map = new Y.Map<unknown>();
    roots(doc).elements.set(card, map);
    for (const [key, value] of Object.entries({
      id: card,
      type: 'note',
      parent: null,
      createdBy: people.owner.id,
    }))
      map.set(key, value);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db
      .insert(boardDoc)
      .values({ boardId: root, state, size: state.length, schemaVersion: 3 });
    doc.destroy();
  });
  afterAll(async () => {
    await app?.close();
    await deps.jobs.idle();
    await collab.destroy();
    await client.end();
  });

  const react = (who: Who, id: string, emoji = thumbs, method: HTTPMethods = 'PUT') =>
    call(who, method, `/comments/${id}/reactions/${emoji}`);

  it('reacts to a comment and a reply, once per person, and takes it back', async () => {
    const thread = await create('owner');
    const reply = await create('commenter', { parentId: thread.id });
    const first = await react('commenter', thread.id);
    expect(first.json<Reactions>().reactions).toEqual([
      { emoji: '👍', count: 1, mine: true, names: ['commenter'] },
    ]);
    // Idempotent for the same person; a second person adds to the count.
    await react('commenter', thread.id);
    await react('owner', thread.id);
    await react('owner', thread.id, heart);
    expect((await react('owner', reply.id)).statusCode).toBe(200);
    const seen = (await threads('owner'))[0];
    expect(seen?.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, names: ['commenter', 'owner'] },
      { emoji: '❤️', count: 1, mine: true, names: ['owner'] },
    ]);
    expect(seen?.replies[0]?.reactions).toMatchObject([{ emoji: '👍', count: 1, mine: true }]);
    // Others see their own state, and the realtime notice goes out.
    expect((await threads('viewer'))[0]?.reactions[0]).toMatchObject({ count: 2, mine: false });
    expect(notices.notify).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ type: 'comments', threadId: thread.id }),
    );
    const gone = await react('owner', thread.id, thumbs, 'DELETE');
    expect(gone.json<Reactions>().reactions[0]).toMatchObject({
      emoji: '👍',
      count: 1,
      mine: false,
    });
  });

  it('needs the commenter role and a known emoji', async () => {
    const thread = await create('owner');
    expect((await react('viewer', thread.id)).statusCode).toBe(403);
    expect((await react('other', thread.id)).statusCode).toBe(404);
    expect((await react('commenter', thread.id, encodeURIComponent('🎉'))).statusCode).toBe(400);
    // Anyone who can read still sees the reactions.
    await react('commenter', thread.id);
    expect((await threads('viewer'))[0]?.reactions).toHaveLength(1);
  });

  it('reacts to a card, stored apart from the board document', async () => {
    const path = `/boards/${root}/elements/${card}/reactions/${thumbs}`;
    expect((await call('viewer', 'PUT', path)).statusCode).toBe(403);
    expect((await call('commenter', 'PUT', path)).json<Reactions>().reactions).toEqual([
      { emoji: '👍', count: 1, mine: true, names: ['commenter'] },
    ]);
    expect(
      (await call('owner', 'PUT', `/boards/${root}/elements/nope0000/reactions/${thumbs}`))
        .statusCode,
    ).toBe(404);
    await call('owner', 'PUT', path);
    const all = (await call('viewer', 'GET', `/boards/${root}/reactions`)).json<ElementReactions>();
    expect(all.items).toEqual([
      {
        elementId: card,
        reactions: [{ emoji: '👍', count: 2, mine: false, names: ['commenter', 'owner'] }],
      },
    ]);
    expect(notices.notify).toHaveBeenCalledWith(root, { type: 'review', elementId: card });
    await call('commenter', 'DELETE', path);
    await call('owner', 'DELETE', path);
    expect((await call('viewer', 'GET', `/boards/${root}/reactions`)).json().items).toEqual([]);
  });

  it('tracks what each person has read of a thread', async () => {
    const thread = await create('owner');
    // Own comments are never unread; the others' are, until opened.
    expect((await threads('owner'))[0]?.unread).toBe(false);
    expect((await threads('commenter'))[0]?.unread).toBe(true);
    expect((await call('commenter', 'POST', `/comments/${thread.id}/read`)).statusCode).toBe(204);
    expect((await threads('commenter'))[0]?.unread).toBe(false);
    // A reply from someone else makes it unread again, for the thread's writer only.
    const reply = await create('commenter', { parentId: thread.id });
    expect((await threads('owner'))[0]?.unread).toBe(true);
    expect((await threads('commenter'))[0]?.unread).toBe(false);
    // Marking by hand wins over the time, and works through a reply's id; it is per person.
    await call('commenter', 'POST', `/comments/${reply.id}/unread`);
    expect((await threads('commenter'))[0]?.unread).toBe(true);
    expect((await threads('viewer'))[0]?.unread).toBe(true);
    await call('commenter', 'POST', `/comments/${thread.id}/read`);
    expect((await threads('commenter'))[0]?.unread).toBe(false);
    expect((await call('other', 'POST', `/comments/${thread.id}/read`)).statusCode).toBe(404);
  });
});
