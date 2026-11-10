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
    for (const name of ['owner', 'editor', 'viewer', 'actor', 'stranger']) {
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
    for (const [person, role] of [
      ['editor', 'editor'],
      ['viewer', 'viewer'],
      ['actor', 'viewer'],
    ] as const) {
      expect(
        (
          await request('owner', 'PUT', `/projects/${projectId}/members/${people[person]?.id}`, {
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
    expect(day).toMatchObject({
      ...input,
      projectId,
      boardId,
      revision: 1,
      updatedBy: { id: people.editor?.id, name: 'editor' },
    });
    const read = await request('viewer', 'GET', base());
    expect(read.statusCode).toBe(200);
    expect(Schedule.parse(read.json()).items).toEqual([day]);
  });
  describe('cast links and presence', () => {
    const presence = () => `${base()}/${day.id}/attendance`;
    const attendance = () => `${base()}/attendance`;
    const link = (as: string, name: string, userId: string | null | undefined) =>
      request(as, 'PUT', `${base()}/cast-links`, { name, userId });

    it('lets only editors link a cast name, and only to someone with access', async () => {
      expect((await link('viewer', 'Anna', people.actor?.id)).statusCode).toBe(403);
      expect((await link('stranger', 'Anna', people.actor?.id)).statusCode).toBe(404);
      expect((await link('editor', 'Anna', people.stranger?.id)).statusCode).toBe(400);
      expect((await link('editor', ' ANNA ', people.actor?.id)).statusCode).toBe(204);
    });
    it('refuses answers from people who are not linked to this day', async () => {
      const answer = { status: 'confirmed' };
      expect((await request(null, 'PUT', presence(), answer)).statusCode).toBe(401);
      expect((await request('stranger', 'PUT', presence(), answer)).statusCode).toBe(404);
      expect((await request('viewer', 'PUT', presence(), answer)).statusCode).toBe(403);
      // An organiser who is not in the cast has nothing to answer either.
      expect((await request('owner', 'PUT', presence(), answer)).statusCode).toBe(403);
      const other = `/boards/${otherBoardId}/schedule/${day.id}/attendance`;
      expect((await request('owner', 'PUT', other, answer)).statusCode).toBe(404);
    });
    it('refuses an answer on behalf of someone else', async () => {
      const response = await request('actor', 'PUT', presence(), {
        status: 'declined',
        userId: people.viewer?.id,
      });
      expect(response.statusCode).toBe(400);
    });
    it('saves and changes the answer of the linked person, per day', async () => {
      const answer = async (status: string) => {
        const response = await request('actor', 'PUT', presence(), { status });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ dayId: day.id, userId: people.actor?.id, status });
      };
      await answer('confirmed');
      await answer('declined');
      const read = await request('editor', 'GET', attendance());
      expect(read.json().responses).toEqual([
        { dayId: day.id, userId: people.actor?.id, status: 'declined' },
      ]);
    });
    it('shows everybody to organisers and only their own to the others', async () => {
      const organiser = (await request('editor', 'GET', attendance())).json();
      expect(organiser.canManage).toBe(true);
      expect(organiser.links).toEqual([{ castKey: 'anna', userId: people.actor?.id }]);
      const actor = (await request('actor', 'GET', attendance())).json();
      expect(actor).toEqual({ ...organiser, canManage: false });
      const viewer = (await request('viewer', 'GET', attendance())).json();
      expect(viewer).toEqual({ canManage: false, links: [], responses: [] });
      expect((await request('stranger', 'GET', attendance())).statusCode).toBe(404);
      expect((await request(null, 'GET', attendance())).statusCode).toBe(401);
    });
    it('forgets the link on request and stops accepting answers', async () => {
      expect((await link('editor', 'anna', null)).statusCode).toBe(204);
      const response = await request('actor', 'PUT', presence(), { status: 'confirmed' });
      expect(response.statusCode).toBe(403);
      expect((await link('editor', 'Anna', people.actor?.id)).statusCode).toBe(204);
    });
  });
  describe('answers when the plan changes', () => {
    const block = input.blocks[0] as ShootingDayInput['blocks'][number];
    const first = { ...block, id: crypto.randomUUID(), start: '09:00', cast: ['Anna'] };
    const second = { ...block, id: crypto.randomUUID(), start: '12:00', cast: ['Bob'] };
    const plan = { ...input, date: '2026-12-01', blocks: [first, second] };
    let dayId = '';
    let revision = 0;
    const save = async (patch: Partial<ShootingDayInput>) => {
      const saved = await request('editor', 'PUT', `${base()}/${dayId}`, {
        ...plan,
        ...patch,
        revision,
      });
      expect(saved.statusCode).toBe(200);
      revision = saved.json().revision;
    };
    /** The plan as it started, with both linked people having confirmed. */
    const answered = async () => {
      await save({});
      for (const person of ['actor', 'viewer']) {
        const answer = { status: 'confirmed' };
        const saved = await request(person, 'PUT', `${base()}/${dayId}/attendance`, answer);
        expect(saved.statusCode).toBe(200);
      }
    };
    const stillAnswered = async () => {
      const { responses } = (await request('editor', 'GET', `${base()}/attendance`)).json();
      return responses
        .filter((response: { dayId: string }) => response.dayId === dayId)
        .map((response: { userId: string }) =>
          response.userId === people.actor?.id ? 'actor' : 'viewer',
        )
        .sort();
    };
    beforeAll(async () => {
      const created = await request('editor', 'POST', base(), plan);
      dayId = created.json().id;
      revision = created.json().revision;
      const linked = await request('editor', 'PUT', `${base()}/cast-links`, {
        name: 'Bob',
        userId: people.viewer?.id,
      });
      expect(linked.statusCode).toBe(204);
    });
    afterAll(async () => {
      await request('editor', 'DELETE', `${base()}/${dayId}`, { revision });
      await request('editor', 'PUT', `${base()}/cast-links`, { name: 'Bob', userId: null });
    });

    it('keeps them when nothing about their time changes', async () => {
      await answered();
      await save({ notes: 'New notes', location: 'Elsewhere', wrap: '20:00' });
      await save({
        blocks: [
          { ...first, title: 'Renamed' },
          second,
          // A later block for someone already called leaves their first call where it was.
          { ...first, id: crypto.randomUUID(), start: '15:00' },
        ],
      });
      expect(await stillAnswered()).toEqual(['actor', 'viewer']);
    });
    it('clears the whole day when its date changes', async () => {
      await answered();
      await save({ date: '2026-12-02' });
      expect(await stillAnswered()).toEqual([]);
    });
    it('clears the whole day when its call time changes', async () => {
      await answered();
      await save({ callTime: '07:30' });
      expect(await stillAnswered()).toEqual([]);
    });
    it('clears only the person whose first block moves', async () => {
      await answered();
      await save({ blocks: [first, { ...second, start: '13:00' }] });
      expect(await stillAnswered()).toEqual(['actor']);
    });
    it('clears someone taken out of the day, not the others', async () => {
      await answered();
      await save({ blocks: [{ ...first, cast: [] }, second] });
      expect(await stillAnswered()).toEqual(['viewer']);
    });
    it('keeps them when a stale write is refused', async () => {
      await answered();
      const stale = await request('editor', 'PUT', `${base()}/${dayId}`, {
        ...plan,
        date: '2026-12-09',
        revision: revision - 1,
      });
      expect(stale.statusCode).toBe(409);
      expect(await stillAnswered()).toEqual(['actor', 'viewer']);
    });
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
    const writer = responses[0]?.statusCode === 200 ? 'editor' : 'owner';
    expect(day.updatedBy).toEqual({ id: people[writer]?.id, name: writer });
    const read = Schedule.parse((await request('viewer', 'GET', base())).json());
    expect(read.items).toEqual([day]);
    expect(
      (await request('editor', 'DELETE', `${base()}/${day.id}`, { revision: 1 })).statusCode,
    ).toBe(409);
  });
  it('atomically creates a destination, moves a block and undoes both days', async () => {
    const source = (await request('editor', 'POST', base(), input)).json();
    const destination = crypto.randomUUID();
    const moved = await request('owner', 'POST', `${base()}/edit`, {
      changes: [
        { id: source.id, revision: 1, input: { ...input, blocks: [] } },
        { id: destination, revision: 0, input: { ...input, date: '2026-11-03' } },
      ],
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: source.id, blocks: [], revision: 2 }),
        expect.objectContaining({
          id: destination,
          blocks: input.blocks,
          updatedBy: { id: people.owner?.id, name: 'owner' },
        }),
      ]),
    );
    const undone = await request('editor', 'POST', `${base()}/edit`, {
      changes: [
        { id: source.id, revision: 2, input },
        { id: destination, revision: 1, input: null },
      ],
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toMatchObject({
      deleted: [destination],
      items: [{ id: source.id, blocks: input.blocks }],
    });
    expect(
      (await request('owner', 'DELETE', `${base()}/${source.id}`, { revision: 3 })).statusCode,
    ).toBe(204);
  });
  it('swaps the dates of two days in one transaction, and neither on a conflict', async () => {
    // A day dragged by its heading onto a taken date (0089, phase 3): both change or none.
    const monday = { ...input, date: '2026-12-07' };
    const wednesday = { ...input, date: '2026-12-09', blocks: [] };
    const a = (await request('editor', 'POST', base(), monday)).json();
    const b = (await request('editor', 'POST', base(), wednesday)).json();
    const swap = (revisions: [number, number], dates: [string, string]) =>
      request('owner', 'POST', `${base()}/edit`, {
        changes: [
          { id: a.id, revision: revisions[0], input: { ...monday, date: dates[0] } },
          { id: b.id, revision: revisions[1], input: { ...wednesday, date: dates[1] } },
        ],
      });
    const dateOf = async (id: string) =>
      (await request('owner', 'GET', base()))
        .json()
        .items.find((item: ShootingDay) => item.id === id);
    const swapped = await swap([1, 1], ['2026-12-09', '2026-12-07']);
    expect(swapped.statusCode).toBe(200);
    expect(await dateOf(a.id)).toMatchObject({ date: '2026-12-09', blocks: input.blocks });
    expect(await dateOf(b.id)).toMatchObject({ date: '2026-12-07', blocks: [] });
    // One stale revision refuses the whole swap back: the other day keeps its new date.
    expect((await swap([2, 1], ['2026-12-07', '2026-12-09'])).statusCode).toBe(409);
    expect(await dateOf(a.id)).toMatchObject({ date: '2026-12-09', revision: 2 });
    expect(await dateOf(b.id)).toMatchObject({ date: '2026-12-07', revision: 2 });
    // Undo is the same swap with the current revisions.
    expect((await swap([2, 2], ['2026-12-07', '2026-12-09'])).statusCode).toBe(200);
    expect(await dateOf(a.id)).toMatchObject({ date: '2026-12-07', revision: 3 });
    for (const id of [a.id, b.id])
      expect(
        (await request('owner', 'DELETE', `${base()}/${id}`, { revision: 3 })).statusCode,
      ).toBe(204);
  });
  it('rolls back every date when one revision conflicts and checks board permissions', async () => {
    // Batch locks sort ids: insert first so the stale update must roll it back.
    const id = '00000000-0000-4000-8000-000000000001';
    const payload = {
      changes: [
        { id, revision: 0, input },
        { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', revision: 1, input },
      ],
    };
    expect((await request('owner', 'POST', `${base()}/edit`, payload)).statusCode).toBe(409);
    const listed = (await request('owner', 'GET', base())).json().items;
    expect(listed.some((item: ShootingDay) => item.id === id)).toBe(false);
    expect((await request('viewer', 'POST', `${base()}/edit`, payload)).statusCode).toBe(403);
    expect((await request('stranger', 'POST', `${base()}/edit`, payload)).statusCode).toBe(404);
    expect(
      (
        await request('owner', 'POST', `${base()}/edit`, {
          changes: [payload.changes[0], payload.changes[0]],
        })
      ).statusCode,
    ).toBe(400);
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
  it('keeps per-person calls for the project only, and block notes for older clients', async () => {
    const current = Schedule.parse((await request('owner', 'GET', base())).json()).items.find(
      (item) => item.id === day.id,
    );
    if (!current) throw new Error('day missing');
    const plain = (blocks: ShootingDayInput['blocks']) => ({
      date: current.date,
      callTime: current.callTime,
      wrap: current.wrap,
      location: current.location,
      notes: current.notes,
      blocks,
    });
    const calls = [
      { crewMemberId: crypto.randomUUID(), call: '07:00', pickup: 'Hotel 06:45' },
      { crewMemberId: crypto.randomUUID(), call: null, pickup: null, absent: true },
    ];
    const noted = current.blocks.map((b, i) => (i === 0 ? { ...b, notes: 'LIGHTS ON' } : b));
    const saved = await request('owner', 'PUT', `${base()}/${day.id}`, {
      ...plain(noted),
      calls,
      revision: current.revision,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ calls, blocks: noted });
    // A client from before calls and notes sends neither: both stay.
    const bare = current.blocks.map(({ notes: _notes, ...b }) => b);
    const old = await request('owner', 'PUT', `${base()}/${day.id}`, {
      ...plain(bare),
      revision: saved.json().revision,
    });
    expect(old.statusCode).toBe(200);
    expect(old.json().calls).toEqual(calls);
    expect(old.json().blocks[0].notes).toBe('LIGHTS ON');
    expect(
      (
        await request('owner', 'PUT', `${base()}/${day.id}`, {
          ...plain(bare),
          calls: [calls[0], calls[0]],
          revision: old.json().revision,
        })
      ).statusCode,
    ).toBe(400);
    // A grant on this board alone shows the plan, never the calls, and cannot write them.
    const grant = `/boards/${boardId}/grants/${people.stranger?.id}`;
    expect((await request('owner', 'PUT', grant, { role: 'editor' })).statusCode).toBe(200);
    try {
      const seen = Schedule.parse((await request('stranger', 'GET', base())).json()).items;
      expect(seen.find((item) => item.id === day.id)).not.toHaveProperty('calls');
      const theirs = await request('stranger', 'PUT', `${base()}/${day.id}`, {
        ...plain(noted),
        calls: [],
        revision: old.json().revision,
      });
      expect(theirs.statusCode).toBe(200);
      expect(theirs.json()).not.toHaveProperty('calls');
      const edit = await request('stranger', 'POST', `${base()}/edit`, {
        changes: [
          {
            id: day.id,
            revision: theirs.json().revision,
            input: { ...plain(noted), calls: [] },
          },
        ],
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().items[0]).not.toHaveProperty('calls');
    } finally {
      expect((await request('owner', 'DELETE', grant)).statusCode).toBe(204);
    }
    const after = Schedule.parse((await request('viewer', 'GET', base())).json()).items.find(
      (item) => item.id === day.id,
    );
    expect(after?.calls).toEqual(calls);
    // Home lists days without anybody's calls.
    const mine = await request(
      'owner',
      'GET',
      `/me/shooting-days?from=${current.date}&to=${current.date}`,
    );
    expect(mine.statusCode).toBe(200);
    for (const item of mine.json().items) expect(item).not.toHaveProperty('calls');
    day = ShootingDay.parse(after);
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
      expect(feed.body).toContain('SUMMARY:Due: Hidden from guests · Feed');
      expect(feed.body).toContain('LOCATION:Rifugio');
      expect(feed.body).toContain('DESCRIPTION:Call 07:30 · Rifugio\\n');
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
