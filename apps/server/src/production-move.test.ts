import { fileURLToPath } from 'node:url';
import { ScheduleBlock, type ShootingDayInput, z } from '@inkadra/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { board, crewMember, project, shootingDay, user } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { moveToProductionBoards } from './production.ts';
import { testDeps } from './test-deps.ts';

/** A block as the server before decision 0123 accepts it: five types, none of the new keys. */
const OlderBlock = ScheduleBlock.omit({
  shotBoardId: true,
  shotLabel: true,
  sceneId: true,
  sceneBoardId: true,
  sceneLabel: true,
})
  .extend({ type: z.enum(['setup', 'shot', 'break', 'move', 'note']) })
  .strict();

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
  location: '',
  notes: '',
  blocks,
});

/** The statement of decision 0123 (§2, "Rolling back"), as `upgrades.md` gives it. */
const rollback = (projectId: string) => sql`
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
  where project_id = ${projectId} and moved_from is not null`;

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('moving existing projects to a Production board (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  const request = (as: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(body === undefined ? {} : { payload: body as object }),
    });
  const created = async (as: string, path: string, body: unknown) => {
    const response = await request(as, 'POST', path, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const newProject = async (as: string, name: string) => {
    const made = await created(as, '/projects', { name });
    return { id: made.id as string, root: made.rootBoardId as string };
  };
  const addBoard = async (
    as: string,
    p: { id: string; root: string },
    title: string,
    kind: string,
  ) =>
    (await created(as, `/projects/${p.id}/boards`, { parentBoardId: p.root, title, kind }))
      .id as string;
  const plan = async (as: string, boardId: string, date: string, blocks = [block()]) =>
    (await created(as, `/boards/${boardId}/schedule`, dayInput(date, blocks))).id as string;
  const addCrew = (projectId: string, name: string) =>
    db.insert(crewMember).values({
      projectId,
      name,
      role: '',
      department: 'Camera',
      phone: '',
      email: '',
      pickup: '',
      notes: '',
      position: 0,
    });
  const productionOf = async (projectId: string) =>
    db
      .select()
      .from(board)
      .where(sql`${board.projectId} = ${projectId} and ${board.kind} = 'production'`);
  const snapshot = async () => ({
    boards: await db.select().from(board).orderBy(asc(board.id)),
    days: await db.select().from(shootingDay).orderBy(asc(shootingDay.id)),
  });

  const p: Record<string, { id: string; root: string }> = {};
  const b: Record<string, string> = {};
  const d: Record<string, string> = {};

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...testDeps(db, log),
    });
    for (const [name, locale] of [
      ['owner', 'it'],
      ['dana', 'de-DE'],
      ['eve', null],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      expect(response.statusCode).toBe(200);
      const id = response.json().user.id as string;
      people[name] = { id, cookie: String(response.headers['set-cookie']).split(';')[0] ?? '' };
      await db.update(user).set({ locale }).where(eq(user.id, id));
    }

    // Days on two storyboards, on an ordinary board and on a storyboard in the trash.
    p.multi = await newProject('owner', 'Multi');
    b.sa = await addBoard('owner', p.multi, 'Act one', 'storyboard');
    b.sb = await addBoard('owner', p.multi, 'Teaser', 'storyboard');
    b.ordinary = await addBoard('owner', p.multi, 'Notes', 'board');
    b.cut = await addBoard('owner', p.multi, 'Cut', 'storyboard');
    d.a1 = await plan('owner', b.sa, '2026-11-02', [
      block({ shotId: 'frame-a1', notes: 'Rain' }),
      block({ type: 'note', title: 'Safety talk' }),
    ]);
    d.a2 = await plan('owner', b.sa, '2026-11-05', [block({ shotId: 'frame-a2' })]);
    d.b1 = await plan('owner', b.sb, '2026-11-02', [block({ shotId: 'frame-b1' })]);
    d.o1 = await plan('owner', b.ordinary, '2026-11-04', [block({ shotId: 'frame-o1' })]);
    d.cut = await plan('owner', b.cut, '2026-11-06', [block({ shotId: 'frame-c1' })]);
    expect((await request('owner', 'DELETE', `/boards/${b.cut}`)).statusCode).toBe(204);
    await addCrew(p.multi.id, 'Anna');

    // A crew and nothing else, made by someone writing in German.
    p.crew = await newProject('dana', 'Crew only');
    await addCrew(p.crew.id, 'Bea');

    // Nothing to plan: no day, or only days in the trash, and no crew.
    p.empty = await newProject('owner', 'Empty');
    await addBoard('owner', p.empty, 'Board', 'storyboard');
    p.binned = await newProject('owner', 'Only binned days');
    b.binned = await addBoard('owner', p.binned, 'Gone', 'storyboard');
    d.binned = await plan('owner', b.binned, '2026-11-07');
    expect((await request('owner', 'DELETE', `/boards/${b.binned}`)).statusCode).toBe(204);

    // Archived, by someone with no language set.
    p.archived = await newProject('eve', 'Archived');
    b.archived = await addBoard('eve', p.archived, 'Old', 'storyboard');
    d.archived = await plan('eve', b.archived, '2026-11-08');
    await db.update(project).set({ archivedAt: new Date() }).where(eq(project.id, p.archived.id));

    // A Production board already, and a day an older server left on a storyboard.
    p.has = await newProject('owner', 'Has one');
    b.has = await addBoard('owner', p.has, 'Board', 'storyboard');
    b.hasProduction = await addBoard('owner', p.has, 'Production', 'production');
    const [stray] = await db
      .insert(shootingDay)
      .values({ ...dayInput('2026-11-09', [block()]), projectId: p.has.id, boardId: b.has })
      .returning();
    d.stray = stray?.id as string;

    // A Production board in the trash, and a day planned on a storyboard since.
    p.binnedProduction = await newProject('owner', 'Binned production');
    b.bp = await addBoard('owner', p.binnedProduction, 'Board', 'storyboard');
    b.bpProduction = await addBoard('owner', p.binnedProduction, 'Production', 'production');
    expect((await request('owner', 'DELETE', `/boards/${b.bpProduction}`)).statusCode).toBe(204);
    d.bp = await plan('owner', b.bp, '2026-11-10');

    // A project the move cannot handle: a crew, but no root board to put the board under.
    const [broken] = await db
      .insert(project)
      .values({ name: 'Broken', position: 'a0' })
      .returning({ id: project.id });
    p.broken = { id: broken?.id as string, root: '' };
    await addCrew(p.broken.id, 'Carlo');
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('is on by default and skipped with PRODUCTION_BOARD_MOVE=false', async () => {
    expect(config.PRODUCTION_BOARD_MOVE).toBe(true);
    const off = loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
      PRODUCTION_BOARD_MOVE: 'false',
    });
    expect(off.PRODUCTION_BOARD_MOVE).toBe(false);
    const before = await snapshot();
    await runMigrations(config.DATABASE_URL, migrations, {
      productionBoards: off.PRODUCTION_BOARD_MOVE,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('moves every project that needs it once, with two processes starting together', async () => {
    const warned: unknown[] = [];
    const watch = {
      info: () => {},
      warn: (obj: object) => warned.push((obj as { projectId: string }).projectId),
    };
    const runs = await Promise.all([
      moveToProductionBoards(db, watch),
      moveToProductionBoards(db, watch),
    ]);
    expect(runs[0] + runs[1]).toBe(3);
    // Only the broken project fails, once per run, and nothing else is in the way.
    expect(warned).toEqual([p.broken?.id, p.broken?.id]);
  });

  it('puts the board under the root, after its last child, in the creator language', async () => {
    for (const [key, title] of [
      ['multi', 'Produzione'],
      ['crew', 'Produktion'],
      ['archived', 'Production'],
    ] as const) {
      const at = p[key] as { id: string; root: string };
      const [production, ...more] = await productionOf(at.id);
      expect(more).toEqual([]);
      expect(production).toMatchObject({
        title,
        parentBoardId: at.root,
        createdBy: null,
        deletedAt: null,
        views: [],
      });
      const siblings = await db.select().from(board).where(eq(board.parentBoardId, at.root));
      for (const s of siblings)
        if (s.id !== production?.id) expect(s.position < (production?.position ?? '')).toBe(true);
    }
    // The archived project stays archived.
    const [archived] = await db
      .select()
      .from(project)
      .where(eq(project.id, p.archived?.id ?? ''));
    expect(archived?.archivedAt).not.toBeNull();
  });

  it('moves the days of live boards and leaves those of the trash', async () => {
    const [production] = await productionOf(p.multi?.id ?? '');
    for (const [key, from] of [
      ['a1', b.sa],
      ['a2', b.sa],
      ['b1', b.sb],
      ['o1', b.ordinary],
    ] as const) {
      const [day] = await db
        .select()
        .from(shootingDay)
        .where(eq(shootingDay.id, d[key] ?? ''));
      expect(day).toMatchObject({ boardId: production?.id, movedFrom: from, revision: 2 });
      expect(day?.blocks[0]?.shotBoardId).toBe(from);
    }
    const [a1] = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.id, d.a1 ?? ''));
    expect(a1?.blocks[1]).not.toHaveProperty('shotBoardId');
    expect(a1?.blocks[0]?.notes).toBe('Rain');
    const [archivedProduction] = await productionOf(p.archived?.id ?? '');
    const left = await db
      .select()
      .from(shootingDay)
      .where(inArray(shootingDay.id, [d.cut, d.binned, d.stray, d.bp, d.archived] as string[]));
    expect(Object.fromEntries(left.map((row) => [row.id, [row.boardId, row.movedFrom]]))).toEqual({
      [d.cut as string]: [b.cut, null],
      [d.binned as string]: [b.binned, null],
      [d.stray as string]: [b.has, null],
      [d.bp as string]: [b.bp, null],
      [d.archived as string]: [archivedProduction?.id, b.archived],
    });
  });

  it('leaves alone an empty project and one that has a Production board, even in the trash', async () => {
    expect(await productionOf(p.empty?.id ?? '')).toEqual([]);
    expect(await productionOf(p.binned?.id ?? '')).toEqual([]);
    expect((await productionOf(p.has?.id ?? '')).map((row) => row.id)).toEqual([b.hasProduction]);
    const [binned, ...more] = await productionOf(p.binnedProduction?.id ?? '');
    expect(more).toEqual([]);
    expect(binned).toMatchObject({ id: b.bpProduction });
    expect(binned?.deletedAt).not.toBeNull();
    expect(await productionOf(p.broken?.id ?? '')).toEqual([]);
  });

  it('finds nothing to do the second time', async () => {
    const before = await snapshot();
    expect(await moveToProductionBoards(db)).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('then refuses new days on any other board', async () => {
    const [production] = await productionOf(p.multi?.id ?? '');
    const refused = await request('owner', 'POST', `/boards/${b.sa}/schedule`, {
      ...dayInput('2026-11-12', []),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'conflict',
      details: { reason: 'production_board', boardId: production?.id },
    });
    const edit = await request('owner', 'POST', `/boards/${b.ordinary}/schedule/edit`, {
      changes: [{ id: crypto.randomUUID(), revision: 0, input: dayInput('2026-11-12', []) }],
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.details).toMatchObject({ reason: 'production_board' });
    await plan('owner', production?.id ?? '', '2026-11-12');
    // Without a live Production board a storyboard keeps its days, as before.
    await plan('owner', b.bp ?? '', '2026-11-13');
  });

  it('can be put back by hand with the rollback statement of the record', async () => {
    const [production] = await productionOf(p.multi?.id ?? '');
    // A scene planned after the move: an older server knows neither the type nor its keys.
    const [b1] = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.id, d.b1 ?? ''));
    await db
      .update(shootingDay)
      .set({
        blocks: [
          ...(b1?.blocks ?? []).map((x) => ({ ...x, shotLabel: '3A' })),
          block({ type: 'scene', sceneId: 'scene-9', sceneBoardId: b.sb, sceneLabel: '9' }),
        ],
      })
      .where(eq(shootingDay.id, d.b1 ?? ''));
    await db.execute(rollback(p.multi?.id ?? ''));
    const rows = await db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.projectId, p.multi?.id ?? ''));
    const where = Object.fromEntries(rows.map((row) => [row.id, row.boardId]));
    expect(where).toMatchObject({
      [d.a1 as string]: b.sa,
      [d.a2 as string]: b.sa,
      [d.b1 as string]: b.sb,
      [d.o1 as string]: b.ordinary,
      [d.cut as string]: b.cut,
    });
    // The day made on the Production board after the move stays there.
    expect(rows.filter((row) => row.boardId === production?.id)).toHaveLength(1);
    for (const row of rows) {
      expect(row.movedFrom).toBeNull();
      for (const x of row.blocks) expect(OlderBlock.safeParse(x).error).toBeUndefined();
    }
    const back = rows.find((row) => row.id === d.b1);
    expect(back?.blocks.at(-1)).toMatchObject({ type: 'note', title: 'Scene 9' });
    expect(rows.find((row) => row.id === d.a1)?.blocks[0]?.notes).toBe('Rain');
  });
});
