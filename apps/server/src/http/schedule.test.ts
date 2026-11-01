import { fileURLToPath } from 'node:url';
import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc, roots } from '@inkadra/doc-schema';
import { Schedule, ShootingDay, type ShootingDayInput } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc, instanceSetting, project as projectTable, shootingDay } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('shooting schedule (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    // Fixture setup creates many accounts on one loopback network. Auth limits have dedicated tests.
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let boardId = '';
  let otherBoardId = '';
  let projectId = '';
  let day: ShootingDay;
  const input: ShootingDayInput = {
    date: '2026-11-02',
    callTime: '08:00',
    wrap: '18:00',
    location: 'Station',
    notes: 'Bring lights',
    blocks: [
      {
        id: crypto.randomUUID(),
        type: 'shot',
        title: 'Arrival',
        start: null,
        duration: 45,
        shotId: 'frame-0001',
        cast: ['Anna'],
        departments: ['Camera'],
      },
    ],
  };
  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const base = () => `/boards/${boardId}/schedule`;
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of ['owner', 'editor', 'viewer', 'stranger']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      expect(response.statusCode).toBe(200);
      people[name] = {
        id: response.json().user.id,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    const project = await request('owner', 'POST', '/projects', { name: 'Schedule' });
    expect(project.statusCode).toBe(201);
    const child = await request('owner', 'POST', `/projects/${project.json().id}/boards`, {
      parentBoardId: project.json().rootBoardId,
      title: 'Shooting plan',
    });
    expect(child.statusCode).toBe(201);
    boardId = child.json().id;
    projectId = project.json().id;
    const other = await request('owner', 'POST', '/projects', { name: 'Other' });
    otherBoardId = other.json().rootBoardId;
    for (const role of ['editor', 'viewer']) {
      expect(
        (
          await request('owner', 'PUT', `/projects/${projectId}/members/${people[role]?.id}`, {
            role,
          })
        ).statusCode,
      ).toBe(200);
    }
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('requires authentication and board access', async () => {
    expect((await request(null, 'GET', base())).statusCode).toBe(401);
    expect((await request('stranger', 'GET', base())).statusCode).toBe(404);
    expect((await request('stranger', 'POST', base(), input)).statusCode).toBe(404);
  });
  it('creates and reads a persistent project day as editor/viewer', async () => {
    const response = await request('editor', 'POST', base(), input);
    expect(response.statusCode).toBe(201);
    day = ShootingDay.parse(response.json());
    expect(day).toMatchObject({ ...input, projectId, boardId, revision: 1 });
    const read = await request('viewer', 'GET', base());
    expect(read.statusCode).toBe(200);
    expect(Schedule.parse(read.json()).items).toEqual([day]);
  });
  it('refuses every write by viewers', async () => {
    expect((await request('viewer', 'POST', base(), input)).statusCode).toBe(403);
    expect(
      (await request('viewer', 'PUT', `${base()}/${day.id}`, { ...input, revision: 1 })).statusCode,
    ).toBe(403);
    expect(
      (await request('viewer', 'DELETE', `${base()}/${day.id}`, { revision: 1 })).statusCode,
    ).toBe(403);
  });
  it('validates dates, clocks, duration, block ids and limits', async () => {
    for (const patch of [
      { date: '2026-02-30' },
      { callTime: '24:00' },
      { blocks: [{ ...input.blocks[0], duration: 0 }] },
      { blocks: [input.blocks[0], input.blocks[0]] },
      { notes: 'x'.repeat(10001) },
    ]) {
      expect((await request('editor', 'POST', base(), { ...input, ...patch })).statusCode).toBe(
        400,
      );
    }
  });
  it('atomically refuses stale writes and preserves ordered blocks', async () => {
    const second = {
      ...input.blocks[0],
      id: crypto.randomUUID(),
      type: 'break' as const,
      shotId: null,
    };
    const changed = { ...input, blocks: [second, ...input.blocks], revision: 1 };
    const responses = await Promise.all([
      request('editor', 'PUT', `${base()}/${day.id}`, changed),
      request('owner', 'PUT', `${base()}/${day.id}`, { ...input, revision: 1 }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    day = ShootingDay.parse(responses.find((r) => r.statusCode === 200)?.json());
    expect(day.revision).toBe(2);
    const read = Schedule.parse((await request('viewer', 'GET', base())).json());
    expect(read.items).toEqual([day]);
    expect(
      (await request('editor', 'DELETE', `${base()}/${day.id}`, { revision: 1 })).statusCode,
    ).toBe(409);
  });
  it('scopes ids to the authorised board and respects board grants', async () => {
    expect(
      (
        await request('owner', 'PUT', `/boards/${otherBoardId}/schedule/${day.id}`, {
          ...input,
          revision: day.revision,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await request('owner', 'GET', `/boards/${otherBoardId}/schedule`)).json().items,
    ).toEqual([]);
    const grant = await request('owner', 'PUT', `/boards/${boardId}/grants/${people.editor?.id}`, {
      role: 'viewer',
    });
    // Grants are exercised through the established access API.
    expect(grant.statusCode).toBe(200);
    expect((await request('editor', 'POST', base(), input)).statusCode).toBe(403);
  });
  it('deletes with the current revision', async () => {
    expect(
      (await request('owner', 'DELETE', `${base()}/${day.id}`, { revision: day.revision }))
        .statusCode,
    ).toBe(204);
    expect((await request('viewer', 'GET', base())).json().items).toEqual([]);
  });
  const isoDay = (offset: number) =>
    new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const pack = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc));
  const store = (boardId: string, state: Buffer) =>
    db
      .insert(boardDoc)
      .values({ boardId, schemaVersion: CURRENT_SCHEMA_VERSION, size: state.length, state })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state } });
  it('lists what My Tasks lists, inside a bounded window, skipping damaged documents', async () => {
    const made = (await request('owner', 'POST', '/projects', { name: 'Feed' })).json();
    const feedProject = made.id as string;
    try {
      await request('owner', 'PUT', `/projects/${feedProject}/members/${people.viewer?.id}`, {
        role: 'viewer',
      });
      // Sub-boards without a card in their parent, and one whose stored document is damaged.
      const orphan = (
        await request('owner', 'POST', `/projects/${feedProject}/boards`, {
          parentBoardId: made.rootBoardId,
          title: 'Orphan plan',
        })
      ).json().id as string;
      const broken = (
        await request('owner', 'POST', `/projects/${feedProject}/boards`, {
          parentBoardId: made.rootBoardId,
          title: 'Broken',
        })
      ).json().id as string;
      await store(broken, Buffer.from([255, 255, 255, 255, 255]));
      const document = createBoardDoc(made.rootBoardId);
      for (const [text, due, hidden] of [
        ['Hidden from guests', isoDay(10), true],
        ['Too late', isoDay(400), false],
        ['Too early', isoDay(-100), false],
      ] as const) {
        const todo = createElement(
          document,
          'todo',
          { x: 0, y: 0 },
          { items: [] },
          { userId: null },
        );
        if (hidden) roots(document).elements.get(todo.id)?.set('guestHidden', true);
        const item = addTodoItem(document, todo.id, text);
        if (!item) throw new Error('Fixture item missing');
        updateTodoItem(document, todo.id, item, { assigneeId: people.viewer?.id, dueDate: due });
      }
      await store(made.rootBoardId, pack(document));
      document.destroy();
      const row = (date: string, location: string) => ({
        projectId: feedProject,
        boardId: orphan,
        date,
        callTime: '07:30',
        wrap: '07:30',
        location,
        notes: 'SECRET NOTE',
        blocks: [],
      });
      await db
        .insert(shootingDay)
        .values([row(isoDay(5), 'Rifugio'), row(isoDay(-100), 'Past'), row(isoDay(400), 'Future')]);
      const url = new URL((await request('viewer', 'GET', '/me/calendar-feed')).json().url)
        .pathname;
      const feed = await app.inject({ method: 'GET', url });
      expect(feed.statusCode).toBe(200);
      expect(feed.body).toContain('Hidden from guests');
      expect(feed.body).toContain('SUMMARY:Scadenza: Hidden from guests · Feed');
      expect(feed.body).toContain('LOCATION:Rifugio');
      expect(feed.body).toContain('DESCRIPTION:Conv. 07:30 · Rifugio\\n');
      expect(feed.body).not.toMatch(/Too late|Too early|Past|Future|SECRET NOTE/);
      // wrap == call: no 24 h event.
      expect(feed.body).not.toContain('DTEND:');
      expect(feed.body).toContain('X-WR-CALNAME:Inkadra\r\n');
      expect(feed.body).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
      const again = await app.inject({
        method: 'GET',
        url,
        headers: { 'if-none-match': String(feed.headers.etag) },
      });
      expect(again.statusCode).toBe(304);
      // A cap keeps the feed bounded.
      await db
        .insert(shootingDay)
        .values(Array.from({ length: 2100 }, (_, n) => row(isoDay(1 + (n % 300)), `Set ${n}`)));
      const capped = await app.inject({ method: 'GET', url });
      expect(capped.statusCode).toBe(200);
      expect(capped.body.match(/BEGIN:VEVENT/g)).toHaveLength(2000);
      expect(capped.headers.etag).not.toBe(feed.headers.etag);
    } finally {
      await db.delete(projectTable).where(eq(projectTable.id, feedProject));
    }
  });
  it('serves private calendars, revalidates membership, revokes and rate limits', async () => {
    const ownProject = (await request('owner', 'GET', `/projects/${projectId}`)).json();
    expect(
      (
        await request('owner', 'POST', `/boards/${ownProject.rootBoardId}/schedule`, {
          ...input,
          date: isoDay(1),
        })
      ).statusCode,
    ).toBe(201);
    const document = createBoardDoc(ownProject.rootBoardId);
    for (const hidden of [false, true]) {
      const todo = createElement(document, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
      if (hidden) roots(document).elements.get(todo.id)?.set('guestHidden', true);
      const item = addTodoItem(document, todo.id, hidden ? 'PRIVATE TASK' : 'Visible permit');
      if (!item) throw new Error('Fixture item missing');
      updateTodoItem(document, todo.id, item, {
        assigneeId: people.viewer?.id,
        dueDate: isoDay(13),
      });
    }
    await db
      .insert(boardDoc)
      .values({
        boardId: ownProject.rootBoardId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        size: Y.encodeStateAsUpdate(document).length,
        state: Buffer.from(Y.encodeStateAsUpdate(document)),
      })
      .onConflictDoUpdate({
        target: boardDoc.boardId,
        set: { state: Buffer.from(Y.encodeStateAsUpdate(document)) },
      });
    document.destroy();
    const created = await request('viewer', 'GET', '/me/calendar-feed');
    expect(created.statusCode).toBe(200);
    const path = new URL(created.json().url).pathname;
    const first = await app.inject({ method: 'GET', url: path });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('BEGIN:VCALENDAR');
    expect(first.body).not.toContain(input.notes);
    expect(first.body).toContain('Visible permit');
    // A member sees what My Tasks shows: the guest-only filter does not apply.
    expect(first.body).toContain('PRIVATE TASK');
    expect(first.body).toContain(`DTSTART;VALUE=DATE:${isoDay(13).replace(/-/g, '')}`);
    const cached = await app.inject({
      method: 'GET',
      url: path,
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);
    await request('owner', 'DELETE', `/projects/${projectId}/members/${people.viewer?.id}`);
    const removed = await app.inject({
      method: 'GET',
      url: path,
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.body).not.toContain('BEGIN:VEVENT');
    await request('viewer', 'POST', '/me/calendar-feed', {});
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    const current = new URL((await request('viewer', 'GET', '/me/calendar-feed')).json().url)
      .pathname;
    await db
      .insert(instanceSetting)
      .values({ key: 'administration', value: { calendarFeedEnabled: false } })
      .onConflictDoUpdate({
        target: instanceSetting.key,
        set: { value: { calendarFeedEnabled: false } },
      });
    expect((await app.inject({ method: 'GET', url: current })).statusCode).toBe(404);
    expect((await request('viewer', 'GET', '/me/calendar-feed')).json()).toEqual({
      enabled: false,
      url: null,
    });
    for (let n = 0; n < 60; n++)
      await app.inject({
        method: 'GET',
        url: '/calendar/invalid.ics',
        remoteAddress: '192.0.2.10',
      });
    const limited = await app.inject({
      method: 'GET',
      url: '/calendar/invalid.ics',
      remoteAddress: '192.0.2.10',
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
  });
});
