import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addElement, createBoardDoc, type Element } from '@inkadra/doc-schema';
import {
  BoardPreview,
  ProjectArchiveManifest,
  Schedule,
  type ScheduleBlock,
  type ShootingDay,
  type ShootingDayInput,
} from '@inkadra/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { mergeCastLinks } from '../cast-crew.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, boardDoc, castLink, crewMember, shareLink, shootingDay } from '../db/schema.ts';
import { adoptDays, daysOfBoard, nextShootingDay } from '../production.ts';
import { DocViews, resolveLink } from '../share-links.ts';
import { testDeps } from '../test-deps.ts';
import { exportProject } from '../transfers/export.ts';
import { importProject, remapBlock } from '../transfers/import.ts';
import { readZip, writeZip } from '../transfers/zip.ts';
import { createApp } from './app.ts';
import { keepBlockKeys } from './schedule-routes.ts';

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  id: crypto.randomUUID(),
  type: 'shot',
  title: '',
  start: null,
  duration: 30,
  shotId: null,
  cast: [],
  departments: [],
  ...over,
});

const dayInput = (date: string, blocks: ScheduleBlock[]): ShootingDayInput => ({
  date,
  callTime: '08:00',
  wrap: null,
  location: `Set of ${date}`,
  notes: '',
  blocks,
});

describe('the cross-board keys of a block (decision 0123)', () => {
  it('keeps them for a client that does not send them, while it names the same frame', () => {
    const stored = block({
      shotId: 'frame-0001',
      shotBoardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
      shotLabel: '12A',
      notes: 'Rain',
    });
    const { shotBoardId: _b, shotLabel: _l, notes: _n, ...older } = stored;
    expect(keepBlockKeys([stored], [older])).toEqual([stored]);
    // Another frame: the board and label of the old one do not follow it.
    const [moved] = keepBlockKeys([stored], [{ ...older, shotId: 'frame-0002' }]);
    expect(moved).toEqual({ ...older, shotId: 'frame-0002', notes: 'Rain' });
    // A newer client that sends the keys wins.
    const newer = { ...stored, shotLabel: '12B' };
    expect(keepBlockKeys([stored], [newer])).toEqual([newer]);
    const scene = block({
      type: 'scene',
      sceneId: 'scene-0001',
      sceneBoardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
      sceneLabel: '12',
    });
    const { sceneId: _s, sceneBoardId: _sb, sceneLabel: _sl, ...bare } = scene;
    expect(keepBlockKeys([scene], [bare])).toEqual([scene]);
    // Turned into another type, the block lets its scene go instead of getting it back.
    const note = { ...bare, type: 'note' as const };
    expect(keepBlockKeys([scene], [note])).toEqual([note]);
  });

  it('maps them through an import, dropping a board the archive does not hold', () => {
    const ids = new Map([['a', 'A']]);
    const kept = remapBlock(block({ shotId: 'f', shotBoardId: 'a', shotLabel: '1A' }), ids);
    expect(kept).toMatchObject({ shotBoardId: 'A', shotLabel: '1A' });
    const lost = remapBlock(block({ shotId: 'f', shotBoardId: 'gone', shotLabel: '1A' }), ids);
    expect(lost.shotLabel).toBe('1A');
    expect('shotBoardId' in lost).toBe(false);
  });

  it('shows the next day on the card: the first from today, else the last', () => {
    const days = [
      dayInput('2026-11-04', []),
      dayInput('2026-11-02', [
        block({
          shotId: 'f',
          shotBoardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
          shotLabel: '1A',
        }),
        block({ type: 'break', title: 'Lunch', start: '13:00' }),
      ]),
    ];
    expect(nextShootingDay([], '2026-11-01')).toBeUndefined();
    expect(nextShootingDay(days, '2026-11-01')).toEqual({
      number: 1,
      date: '2026-11-02',
      callTime: '08:00',
      location: 'Set of 2026-11-02',
      blocks: [
        {
          start: '08:00',
          type: 'shot',
          title: '',
          boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
          label: '1A',
        },
        { start: '13:00', type: 'break', title: 'Lunch', boardId: null, label: null },
      ],
    });
    expect(nextShootingDay(days, '2026-11-03')?.number).toBe(2);
    expect(nextShootingDay(days, '2026-12-01')?.date).toBe('2026-11-04');
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('the Production board (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const deps = testDeps(db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const created = async (as: string, path: string, payload: unknown) => {
    const response = await request(as, 'POST', path, payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const ids = {
    project: '',
    root: '',
    sa: '',
    sb: '',
    ordinary: '',
    trashed: '',
    production: '',
    otherRoot: '',
  };
  const days: Record<string, ShootingDay> = {};
  const dayRow = async (id: string) =>
    (await db.select().from(shootingDay).where(eq(shootingDay.id, id)))[0];

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...deps });
    for (const name of ['owner', 'member', 'producer', 'storyboarder', 'stranger']) {
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
    const project = await created('owner', '/projects', { name: 'Last Train' });
    ids.project = project.id;
    ids.root = project.rootBoardId;
    ids.otherRoot = (await created('owner', '/projects', { name: 'Other' })).rootBoardId;
    const add = async (title: string, kind: string) =>
      (
        await created('owner', `/projects/${ids.project}/boards`, {
          parentBoardId: ids.root,
          title,
          kind,
        })
      ).id as string;
    ids.sa = await add('Act one', 'storyboard');
    ids.sb = await add('Teaser', 'storyboard');
    ids.ordinary = await add('Notes', 'board');
    ids.trashed = await add('Cut', 'storyboard');
    const plan = async (key: string, boardId: string, input: ShootingDayInput) => {
      days[key] = await created('owner', `/boards/${boardId}/schedule`, input);
    };
    await plan(
      'a1',
      ids.sa,
      dayInput('2026-11-02', [
        block({ shotId: 'frame-a1', cast: ['Bruno Rossi'], notes: 'Rain machine' }),
        block({ type: 'note', title: 'Safety talk' }),
      ]),
    );
    await plan('a2', ids.sa, dayInput('2026-11-05', [block({ shotId: 'frame-a2' })]));
    await plan('b1', ids.sb, dayInput('2026-11-03', [block({ shotId: 'frame-b1' })]));
    await plan('o1', ids.ordinary, dayInput('2026-11-04', [block({ shotId: 'frame-o1' })]));
    await plan('t1', ids.trashed, dayInput('2026-11-06', [block({ shotId: 'frame-t1' })]));
    expect((await request('owner', 'DELETE', `/boards/${ids.trashed}`)).statusCode).toBe(204);
    expect(
      (
        await request('owner', 'PUT', `/projects/${ids.project}/members/${people.member?.id}`, {
          role: 'editor',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request('owner', 'PUT', `/boards/${ids.sa}/grants/${people.storyboarder?.id}`, {
          role: 'editor',
        })
      ).statusCode,
    ).toBe(200);
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('refuses a second Production board in the database, trashed ones included', async () => {
    const project = await created('owner', '/projects', { name: 'Index' });
    const row = (title: string) => ({
      projectId: project.id,
      parentBoardId: project.rootBoardId,
      kind: 'production' as const,
      title,
      position: 'a1',
    });
    await db.insert(board).values({ ...row('First'), deletedAt: new Date() });
    await expect(db.insert(board).values(row('Second'))).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it('creates it and moves the days of the live boards to it', async () => {
    const response = await request('owner', 'POST', `/projects/${ids.project}/boards`, {
      parentBoardId: ids.root,
      title: 'Production',
      kind: 'production',
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ kind: 'production', views: [] });
    ids.production = response.json().id;
    const listed = Schedule.parse(
      (await request('owner', 'GET', `/boards/${ids.production}/schedule`)).json(),
    );
    expect(listed.items.map((d) => d.id).sort()).toEqual(
      [days.a1, days.a2, days.b1, days.o1].map((d) => d?.id).sort(),
    );
    for (const [key, from] of [
      ['a1', ids.sa],
      ['a2', ids.sa],
      ['b1', ids.sb],
      ['o1', ids.ordinary],
    ] as const) {
      const row = await dayRow(days[key]?.id as string);
      expect(row).toMatchObject({ boardId: ids.production, movedFrom: from, revision: 2 });
      expect(row?.blocks[0]?.shotBoardId).toBe(from);
    }
    // A block without a frame names no board; calls and notes are untouched.
    const a1 = await dayRow(days.a1?.id as string);
    expect(a1?.blocks[1]).not.toHaveProperty('shotBoardId');
    expect(a1?.blocks[0]?.notes).toBe('Rain machine');
    // The trashed storyboard keeps its day, as hidden as before.
    expect(await dayRow(days.t1?.id as string)).toMatchObject({
      boardId: ids.trashed,
      movedFrom: null,
      revision: 1,
    });
    // The storyboard's own schedule is empty now; a stale save gets a 409 and reloads.
    expect(
      Schedule.parse((await request('owner', 'GET', `/boards/${ids.sa}/schedule`)).json()).items,
    ).toEqual([]);
    const {
      id: _id,
      projectId: _p,
      boardId: _b,
      revision,
      updatedBy: _u,
      ...input
    } = days.a2 as ShootingDay;
    expect(
      (
        await request('owner', 'PUT', `/boards/${ids.production}/schedule/${days.a2?.id}`, {
          ...input,
          revision,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('moves nothing the second time', async () => {
    const before = await db.select().from(shootingDay).orderBy(asc(shootingDay.id));
    expect(await db.transaction((tx) => adoptDays(tx, ids.project, ids.production))).toBe(0);
    expect(await db.select().from(shootingDay).orderBy(asc(shootingDay.id))).toEqual(before);
  });

  it('refuses a second one and any board under it', async () => {
    const again = await request('member', 'POST', `/projects/${ids.project}/boards`, {
      parentBoardId: ids.root,
      title: 'Another',
      kind: 'production',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.details).toEqual({
      reason: 'production_exists',
      boardId: ids.production,
    });
    const under = await request('owner', 'POST', `/projects/${ids.project}/boards`, {
      parentBoardId: ids.production,
      title: 'Inside',
    });
    expect(under.statusCode).toBe(400);
    expect(
      (
        await request('owner', 'PATCH', `/boards/${ids.ordinary}`, {
          parentBoardId: ids.production,
        })
      ).statusCode,
    ).toBe(400);
  });

  const save = async (as: string, key: string, blocks: unknown[]) => {
    const row = await dayRow(days[key]?.id as string);
    if (!row) throw new Error('day missing');
    return request(as, 'PUT', `/boards/${ids.production}/schedule/${row.id}`, {
      date: row.date,
      callTime: row.callTime,
      wrap: row.wrap,
      location: row.location,
      notes: row.notes,
      blocks,
      revision: row.revision,
    });
  };

  it("keeps the cross-board keys of an older client's save", async () => {
    const row = await dayRow(days.b1?.id as string);
    const labelled = { ...row?.blocks[0], shotLabel: '3A' };
    expect((await save('owner', 'b1', [labelled])).statusCode).toBe(200);
    const { shotBoardId: _b, shotLabel: _l, ...older } = labelled;
    const response = await save('member', 'b1', [{ ...older, duration: 50 }]);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().blocks[0]).toMatchObject({
      shotBoardId: ids.sb,
      shotLabel: '3A',
      duration: 50,
    });
  });

  it('checks the board a block points at', async () => {
    const row = await dayRow(days.o1?.id as string);
    const own = row?.blocks[0] as ScheduleBlock;
    const elsewhere = block({ shotId: 'frame-x', shotBoardId: ids.otherRoot });
    expect((await save('owner', 'o1', [own, elsewhere])).statusCode).toBe(400);
    const sceneBlock = block({
      type: 'scene',
      sceneId: 'scene-0001',
      sceneBoardId: ids.sb,
      sceneLabel: '4',
    });
    // A storyboard in the trash is still a board of the project.
    const cut = block({ shotId: 'frame-t1', shotBoardId: ids.trashed, shotLabel: '9C' });
    expect((await save('owner', 'o1', [own, sceneBlock, cut])).statusCode).toBe(200);
    expect(
      (
        await request('owner', 'POST', `/boards/${ids.production}/schedule`, {
          ...dayInput('2026-11-09', [elsewhere]),
        })
      ).statusCode,
    ).toBe(400);
    // A reference the stored block already had is kept, whatever its board became.
    const stored = await dayRow(days.o1?.id as string);
    const kept = { ...(stored?.blocks[0] as ScheduleBlock), shotBoardId: ids.otherRoot };
    await db
      .update(shootingDay)
      .set({ blocks: [kept, ...(stored?.blocks.slice(1) ?? [])] })
      .where(eq(shootingDay.id, stored?.id as string));
    const resaved = await dayRow(days.o1?.id as string);
    expect((await save('owner', 'o1', resaved?.blocks ?? [])).statusCode).toBe(200);
    // Put it back on its board for the archive below.
    const back = await dayRow(days.o1?.id as string);
    await db
      .update(shootingDay)
      .set({
        blocks: [
          { ...(back?.blocks[0] as ScheduleBlock), shotBoardId: ids.ordinary },
          ...(back?.blocks.slice(1) ?? []),
        ],
      })
      .where(eq(shootingDay.id, back?.id as string));
  });

  it('shows the days by the role on the Production board, calls and notes to members', async () => {
    expect(
      (
        await request('owner', 'PUT', `/boards/${ids.production}/grants/${people.producer?.id}`, {
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(200);
    const path = `/boards/${ids.production}/schedule`;
    const team = Schedule.parse((await request('member', 'GET', path)).json()).items;
    const a1 = team.find((d) => d.id === days.a1?.id);
    expect(a1?.calls).toEqual([]);
    expect(a1?.blocks[0]?.notes).toBe('Rain machine');
    const granted = await request('producer', 'GET', path);
    expect(granted.statusCode).toBe(200);
    const plan = Schedule.parse(granted.json()).items.find((d) => d.id === days.a1?.id);
    expect(plan).not.toHaveProperty('calls');
    expect(plan?.blocks[0]).not.toHaveProperty('notes');
    expect(plan?.blocks[0]?.shotBoardId).toBe(ids.sa);
    // A grant on a storyboard alone shows no schedule (answer 1).
    expect((await request('storyboarder', 'GET', path)).statusCode).toBe(404);
    expect(
      Schedule.parse((await request('storyboarder', 'GET', `/boards/${ids.sa}/schedule`)).json())
        .items,
    ).toEqual([]);
    expect((await request('stranger', 'GET', path)).statusCode).toBe(404);
    // The set plan's sheet reads the same days, keeping the blocks of its storyboard.
    const sheet = await daysOfBoard(db, { id: people.member?.id as string }, ids.project, ids.sa);
    expect(sheet.map((d) => d.date).sort()).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    expect(sheet.flatMap((d) => d.blocks)).toEqual([
      { shotId: 'frame-a1' },
      { shotId: 'frame-a2' },
    ]);
    const scenes = await daysOfBoard(db, { id: people.member?.id as string }, ids.project, ids.sb);
    expect(scenes.flatMap((d) => d.blocks)).toContainEqual({ shotId: null, sceneId: 'scene-0001' });
    expect(
      await daysOfBoard(db, { id: people.storyboarder?.id as string }, ids.project, ids.sa),
    ).toEqual([]);
  });

  it('serves the cards a schedule reads of the storyboards the caller can open (#826)', async () => {
    const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
    const doc = createBoardDoc(ids.sa);
    addElement(doc, { ...base, id: 'scene-sum-1', type: 'scene', number: '4', title: 'Rain' } as Element);
    addElement(doc, { ...base, id: 'frame-sum-1', type: 'frame', parent: 'scene-sum-1' } as Element);
    addElement(doc, { ...base, id: 'note-sum-1', type: 'note' } as Element);
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: ids.sa, state, schemaVersion: 3, size: state.byteLength })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.byteLength } });
    const path = `/projects/${ids.project}/schedule-sources?boards=${ids.sa},${ids.sb},${ids.trashed},${ids.ordinary}`;
    const member = await request('member', 'GET', path);
    expect(member.statusCode, member.body).toBe(200);
    const items = member.json().items as Array<{
      boardId: string;
      readOnly: boolean;
      elements: Array<{ id: string }>;
    }>;
    // A board in the trash is left out; the others in the order asked.
    expect(items.map((i) => i.boardId)).toEqual([ids.sa, ids.sb, ids.ordinary]);
    expect(items[0]?.readOnly).toBe(false);
    // Only the cards the schedule reads: the note stays in the document.
    expect(items[0]?.elements.map((e) => e.id).sort()).toEqual(['frame-sum-1', 'scene-sum-1']);
    // A grant on one storyboard reads that one only: nothing about the other.
    const granted = await request('storyboarder', 'GET', path);
    expect(granted.json().items.map((i: { boardId: string }) => i.boardId)).toEqual([ids.sa]);
    expect((await request('stranger', 'GET', path)).statusCode).toBe(404);
    expect(
      (await request('member', 'GET', `/projects/${ids.project}/schedule-sources?boards=x`))
        .statusCode,
    ).toBe(400);
  });

  it('is never shown to guests', async () => {
    const refused = await request('owner', 'POST', `/boards/${ids.production}/share-links`, {});
    expect(refused.statusCode).toBe(400);
    const el = { w: 100, z: 'a0', createdBy: 'someone', createdAt: 1, x: 0, y: 0 };
    const doc = createBoardDoc(ids.root);
    for (const [id, boardId] of [
      ['card-storyboard', ids.sa],
      ['card-production', ids.production],
    ])
      addElement(doc, { ...el, id, type: 'board', boardId, parent: null } as Element);
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: ids.root, state, schemaVersion: 3, size: state.byteLength })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.byteLength } });
    const link = await created('owner', `/boards/${ids.root}/share-links`, {
      includeSubBoards: true,
    });
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, link.id));
    if (!row) throw new Error('link missing');
    const resolved = await resolveLink(db, new DocViews(), row);
    if (resolved.status !== 'active') throw new Error(resolved.status);
    expect([...resolved.boards.keys()].sort()).toEqual([ids.root, ids.sa].sort());
    const onIt = await resolveLink(db, new DocViews(), {
      ...row,
      boardId: ids.production,
    });
    expect(onIt.status).toBe('suspended');
  });

  it('previews its next day and, to members, its troupe', async () => {
    for (const [i, name] of ['Anna', 'Bea', 'Carlo', 'Dario', 'Elio'].entries())
      await created('owner', `/projects/${ids.project}/crew`, {
        name,
        department: 'Camera',
        role: `Role ${i}`,
        phone: '',
        email: '',
        notes: '',
        pickup: '',
        character: null,
        userId: null,
        onSetContact: false,
        position: i,
      });
    const path = `/boards/${ids.production}/preview`;
    const team = BoardPreview.parse((await request('member', 'GET', path)).json());
    expect(team).toMatchObject({ dayCount: 4, crewCount: 5 });
    expect(team.crew).toEqual([
      { name: 'Anna', role: 'Role 0' },
      { name: 'Bea', role: 'Role 1' },
      { name: 'Carlo', role: 'Role 2' },
      { name: 'Dario', role: 'Role 3' },
    ]);
    // Every day is past: the card shows the last one.
    expect(team.nextDay).toMatchObject({ number: 4, date: '2026-11-05', callTime: '08:00' });
    expect(team.nextDay?.blocks[0]).toMatchObject({ type: 'shot', boardId: ids.sa });
    const granted = BoardPreview.parse((await request('producer', 'GET', path)).json());
    expect(granted.dayCount).toBe(4);
    expect(granted.nextDay?.number).toBe(4);
    expect(granted).not.toHaveProperty('crew');
    expect(granted).not.toHaveProperty('crewCount');
  });

  it('opens crew search results on it', async () => {
    const found = await request('member', 'GET', '/search?q=Anna');
    expect(found.statusCode).toBe(200);
    const hit = found
      .json()
      .items.find((h: { elementType: string | null }) => h.elementType === 'crew');
    expect(hit).toMatchObject({ boardId: ids.production, boardKind: 'production' });
  });

  it('merges legacy cast links with the names written in the days of the project', async () => {
    await db.insert(castLink).values({
      boardId: ids.sa,
      castKey: 'bruno rossi',
      userId: people.member?.id as string,
    });
    await mergeCastLinks(db);
    const [row] = await db
      .select()
      .from(crewMember)
      .where(
        and(
          eq(crewMember.projectId, ids.project),
          eq(crewMember.userId, people.member?.id as string),
        ),
      );
    expect(row?.name).toBe('Bruno Rossi');
  });

  it('comes back from the trash with its days instead of a second one', async () => {
    const storyboardCard = async () =>
      BoardPreview.parse((await request('member', 'GET', `/boards/${ids.sb}/preview`)).json());
    // With a live Production board a storyboard's card counts no days and no crew.
    expect(await storyboardCard()).not.toHaveProperty('dayCount');
    expect((await request('owner', 'DELETE', `/boards/${ids.production}`)).statusCode).toBe(204);
    // Meanwhile a day is planned on a storyboard, as a project without a live one allows.
    days.a3 = await created(
      'owner',
      `/boards/${ids.sa}/schedule`,
      dayInput('2026-11-08', [block({ shotId: 'frame-a3' })]),
    );
    // Without one, it counts the plan to find there: the trashed board's days and the new one,
    // never those of a trashed storyboard; to members only.
    expect(await storyboardCard()).toMatchObject({ dayCount: 5, crewCount: 6 });
    const granted = BoardPreview.parse(
      (await request('storyboarder', 'GET', `/boards/${ids.sa}/preview`)).json(),
    );
    expect(granted).not.toHaveProperty('dayCount');
    const back = await request('member', 'POST', `/projects/${ids.project}/boards`, {
      parentBoardId: ids.root,
      title: 'Production again',
      kind: 'production',
    });
    expect(back.statusCode, back.body).toBe(201);
    expect(back.json()).toMatchObject({ id: ids.production, title: 'Production' });
    const [row] = await db.select().from(board).where(eq(board.id, ids.production));
    expect(row?.deletedAt).toBeNull();
    const listed = Schedule.parse(
      (await request('owner', 'GET', `/boards/${ids.production}/schedule`)).json(),
    );
    expect(listed.items).toHaveLength(5);
    expect(await dayRow(days.a3?.id as string)).toMatchObject({
      boardId: ids.production,
      movedFrom: ids.sa,
    });
  });

  const archive = async (projectId: string) => {
    const path = join(await mkdtemp(join(tmpdir(), 'inkadra-production-')), 'a.zip');
    await exportProject({ db, storage: deps.storage }, projectId, path);
    return path;
  };
  const importDeps = () => ({
    db,
    storage: deps.storage,
    jobs: deps.jobs,
    uploadMaxSize: 0,
    importMaxSize: 1024 ** 3,
  });

  it('exports and imports it in format 2, with the block boards mapped', async () => {
    const path = await archive(ids.project);
    const zip = await readZip(path, { entries: 100, totalBytes: 1e9, compressionRatio: 1e6 });
    expect((await zip.json('manifest.json', ProjectArchiveManifest, 1e6)).formatVersion).toBe(2);
    zip.close();
    const { projectId } = await importProject(importDeps(), path, people.owner?.id as string);
    const boards = await db.select().from(board).where(eq(board.projectId, projectId));
    const byTitle = new Map(boards.map((b) => [b.title, b]));
    const production = boards.filter((b) => b.kind === 'production');
    expect(production).toHaveLength(1);
    const imported = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.projectId, projectId));
    expect(imported).toHaveLength(5);
    expect(new Set(imported.map((d) => d.boardId))).toEqual(new Set([production[0]?.id]));
    const blocks = imported.flatMap((d) => d.blocks);
    const of = (shotId: string) => blocks.find((b) => b.shotId === shotId);
    expect(of('frame-a1')?.shotBoardId).toBe(byTitle.get('Act one')?.id);
    expect(of('frame-b1')).toMatchObject({
      shotBoardId: byTitle.get('Teaser')?.id,
      shotLabel: '3A',
    });
    expect(of('frame-o1')?.shotBoardId).toBe(byTitle.get('Notes')?.id);
    // The trashed storyboard is not in the archive: the label stays, the board goes.
    expect(of('frame-t1')).toMatchObject({ shotLabel: '9C' });
    expect(of('frame-t1')).not.toHaveProperty('shotBoardId');
    expect(blocks.find((b) => b.type === 'scene')?.sceneBoardId).toBe(byTitle.get('Teaser')?.id);
  });

  it('gives a format 1 archive with days a Production board on import', async () => {
    const project = await created('owner', '/projects', { name: 'Old archive' });
    const storyboard = await created('owner', `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      title: 'Storyboard',
      kind: 'storyboard',
    });
    await created(
      'owner',
      `/boards/${storyboard.id}/schedule`,
      dayInput('2026-12-01', [block({ shotId: 'frame-0001' })]),
    );
    const path = await archive(project.id);
    const zip = await readZip(path, { entries: 100, totalBytes: 1e9, compressionRatio: 1e6 });
    const older = join(await mkdtemp(join(tmpdir(), 'inkadra-format1-')), 'a.zip');
    const out = writeZip(older);
    for (const name of zip.names()) {
      if (name === 'manifest.json') {
        const manifest = await zip.json('manifest.json', ProjectArchiveManifest, 1e6);
        await out.addJson(name, { ...manifest, formatVersion: 1 });
      } else await out.addBuffer(name, await zip.buffer(name, 1e7));
    }
    await out.close();
    zip.close();
    const { projectId } = await importProject(importDeps(), older, people.owner?.id as string);
    const boards = await db.select().from(board).where(eq(board.projectId, projectId));
    const root = boards.find((b) => b.parentBoardId === null);
    const sb = boards.find((b) => b.kind === 'storyboard');
    const production = boards.find((b) => b.kind === 'production');
    expect(production).toMatchObject({ title: 'Production', parentBoardId: root?.id, views: [] });
    expect(production && sb && production.position > sb.position).toBe(true);
    const [day] = await db.select().from(shootingDay).where(eq(shootingDay.projectId, projectId));
    expect(day).toMatchObject({ boardId: production?.id, movedFrom: sb?.id });
    expect(day?.blocks[0]?.shotBoardId).toBe(sb?.id);
  });

  it('can be put back by hand with the rollback statement of the record', async () => {
    // A scene planned after the move: an older server knows neither the type nor its keys.
    const moved = await dayRow(days.b1?.id as string);
    await db
      .update(shootingDay)
      .set({
        blocks: [
          ...(moved?.blocks ?? []),
          block({ type: 'scene', sceneId: 'scene-9', sceneBoardId: ids.sb, sceneLabel: '9' }),
        ],
      })
      .where(eq(shootingDay.id, days.b1?.id as string));
    await db.execute(sql`
      update shooting_day
      set board_id = moved_from, moved_from = null,
          blocks = (select coalesce(jsonb_agg(
                      (case when b.v ->> 'type' = 'scene'
                         then b.v || jsonb_build_object('type', 'note', 'title',
                           coalesce(nullif(b.v ->> 'title', ''), 'Scene ' || coalesce(b.v ->> 'sceneLabel', '')))
                         else b.v end)
                      - 'shotBoardId' - 'shotLabel' - 'sceneId' - 'sceneBoardId' - 'sceneLabel'
                      order by b.i), '[]')
                    from jsonb_array_elements(blocks) with ordinality as b(v, i))
      where project_id = ${ids.project} and moved_from is not null`);
    for (const [key, from] of [
      ['a1', ids.sa],
      ['a2', ids.sa],
      ['a3', ids.sa],
      ['b1', ids.sb],
      ['o1', ids.ordinary],
    ] as const) {
      const row = await dayRow(days[key]?.id as string);
      expect(row).toMatchObject({ boardId: from, movedFrom: null });
      // Every block reads as one of the server before 0123: its five types and its keys only.
      for (const b of row?.blocks ?? []) {
        expect(['setup', 'shot', 'break', 'move', 'note']).toContain(b.type);
        for (const key of ['shotBoardId', 'shotLabel', 'sceneId', 'sceneBoardId', 'sceneLabel'])
          expect(b).not.toHaveProperty(key);
      }
    }
    const a1 = await dayRow(days.a1?.id as string);
    expect(a1?.blocks.map((b) => b.type)).toEqual(['shot', 'note']);
    expect(a1?.blocks[0]?.notes).toBe('Rain machine');
    const b1 = await dayRow(days.b1?.id as string);
    expect(b1?.blocks.at(-1)).toMatchObject({ type: 'note', title: 'Scene 9' });
  });
});
