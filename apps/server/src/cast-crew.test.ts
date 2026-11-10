import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc } from '@inkadra/doc-schema';
import type { ShootingDayInput } from '@inkadra/shared';
import { asc, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { mergeCastLinks } from './cast-crew.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { boardDoc, castLink, crewMember } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('cast links through the crew (needs DATABASE_URL)', () => {
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
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let projectId = '';
  let planBoard = '';
  let storyBoard = '';
  let cardId = '';
  const request = (
    as: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const block = (cast: string[], start: string): ShootingDayInput['blocks'][number] => ({
    id: crypto.randomUUID(),
    type: 'shot',
    title: 'Scene',
    start,
    duration: 30,
    shotId: null,
    cast,
    departments: [],
  });
  const crew = async () =>
    db
      .select({
        name: crewMember.name,
        department: crewMember.department,
        userId: crewMember.userId,
        character: crewMember.character,
      })
      .from(crewMember)
      .where(eq(crewMember.projectId, projectId))
      .orderBy(asc(crewMember.position), asc(crewMember.createdAt));
  const blank = {
    role: '',
    department: 'Cast',
    phone: '',
    email: '',
    pickup: '',
    notes: '',
    userId: null,
    character: null,
    onSetContact: false,
    position: 0,
  };

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of ['owner', 'actor', 'double', 'guest', 'grantEditor']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: {
          email: `${name.toLowerCase()}@example.com`,
          password: 'correct-horse-battery',
          name,
        },
      });
      people[name] = {
        id: response.json().user.id,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    const project = (await request('owner', 'POST', '/projects', { name: 'Cast' })).json();
    projectId = project.id;
    storyBoard = project.rootBoardId;
    planBoard = (
      await request('owner', 'POST', `/projects/${projectId}/boards`, {
        parentBoardId: storyBoard,
        title: 'Plan',
      })
    ).json().id;
    for (const person of ['actor', 'double'])
      await request('owner', 'PUT', `/projects/${projectId}/members/${people[person]?.id}`, {
        role: 'viewer',
      });
    // Board-only grants: they are not project members.
    await request('owner', 'PUT', `/boards/${planBoard}/grants/${people.guest?.id}`, {
      role: 'viewer',
    });
    await request('owner', 'PUT', `/boards/${planBoard}/grants/${people.grantEditor?.id}`, {
      role: 'editor',
    });
    // The character card lives on the storyboard, the days on the plan board.
    const doc = createBoardDoc(storyBoard);
    cardId = createElement(
      doc,
      'character',
      { x: 0, y: 0 },
      { name: 'Mara', actor: 'Anna Bianchi', contact: 'Agency' },
      { userId: null },
    ).id;
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db.insert(boardDoc).values({
      boardId: storyBoard,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      size: state.length,
      state,
    });
    doc.destroy();
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('merges old board links into crew rows once, without taking a link away', async () => {
    const day = await request('owner', 'POST', `/boards/${planBoard}/schedule`, {
      date: '2026-11-20',
      callTime: '08:00',
      wrap: null,
      location: '',
      notes: '',
      blocks: [block(['Luca Verdi', 'Paolo'], '09:00')],
    });
    expect(day.statusCode).toBe(201);
    // Paolo is already in the crew without an account; "Bruno" is someone else's row.
    await request('owner', 'POST', `/projects/${projectId}/crew`, { ...blank, name: 'Paolo' });
    await request('owner', 'POST', `/projects/${projectId}/crew`, {
      ...blank,
      name: 'Bruno',
      userId: people.double?.id,
    });
    await db.insert(castLink).values([
      // A name in the days keeps the case it is written in.
      { boardId: planBoard, castKey: 'luca verdi', userId: people.actor?.id ?? '' },
      { boardId: planBoard, castKey: 'paolo', userId: people.double?.id ?? '' },
      // A conflicting link gets its own row instead of moving Bruno's.
      { boardId: planBoard, castKey: 'bruno', userId: people.actor?.id ?? '' },
      // A character's name becomes its actor, linked to the card.
      { boardId: storyBoard, castKey: 'mara', userId: people.actor?.id ?? '' },
    ]);
    expect(await mergeCastLinks(db)).toBe(4);
    // Links are merged in board order, which depends on random ids: compare as a set.
    const rows = await crew();
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: 'Paolo', department: 'Cast', userId: people.double?.id, character: null },
        { name: 'Bruno', department: 'Cast', userId: people.double?.id, character: null },
        { name: 'Luca Verdi', department: 'Cast', userId: people.actor?.id, character: null },
        { name: 'bruno', department: 'Cast', userId: people.actor?.id, character: null },
        {
          name: 'Anna Bianchi',
          department: 'Cast',
          userId: people.actor?.id,
          character: { boardId: storyBoard, elementId: cardId },
        },
      ]),
    );
    const marked = await db.select({ mergedAt: castLink.mergedAt }).from(castLink);
    expect(marked.every((row) => row.mergedAt !== null)).toBe(true);
    // Run again (every start runs it): nothing left to merge.
    expect(await mergeCastLinks(db)).toBe(0);
    expect(await crew()).toHaveLength(5);
  });

  it('lets a crew row answer for its character on another board of the project', async () => {
    const day = await request('owner', 'POST', `/boards/${planBoard}/schedule`, {
      date: '2026-11-21',
      callTime: '08:00',
      wrap: null,
      location: '',
      notes: '',
      blocks: [block(['MARA'], '10:00')],
    });
    const answer = await request(
      'actor',
      'PUT',
      `/boards/${planBoard}/schedule/${day.json().id}/attendance`,
      {
        status: 'confirmed',
      },
    );
    expect(answer.statusCode).toBe(200);
    const links = (await request('owner', 'GET', `/boards/${planBoard}/schedule/attendance`)).json()
      .links;
    expect(links).toContainEqual({ castKey: 'mara', userId: people.actor?.id });
    expect(links).toContainEqual({ castKey: 'anna bianchi', userId: people.actor?.id });
    // Somebody else's crew row does not let the double answer for Mara.
    const other = await request(
      'double',
      'PUT',
      `/boards/${planBoard}/schedule/${day.json().id}/attendance`,
      {
        status: 'confirmed',
      },
    );
    expect(other.statusCode).toBe(403);
  });

  it('links a cast name by writing the crew, for project editors only', async () => {
    const link = (as: string, name: string, userId: string | null) =>
      request(as, 'PUT', `/boards/${planBoard}/schedule/cast-links`, { name, userId });
    expect((await link('owner', 'Giulia', people.guest?.id ?? null)).statusCode).toBe(204);
    expect((await crew()).at(-1)).toEqual({
      name: 'Giulia',
      department: 'Cast',
      userId: people.guest?.id,
      character: null,
    });
    // The same name again links the same row; null unlinks it and keeps the person.
    expect((await link('owner', 'giulia', people.actor?.id ?? null)).statusCode).toBe(204);
    expect((await link('owner', 'GIULIA', null)).statusCode).toBe(204);
    expect((await crew()).filter((row) => row.name === 'Giulia')).toEqual([
      { name: 'Giulia', department: 'Cast', userId: null, character: null },
    ]);
    // An editor through a board grant cannot write the project's crew.
    expect((await link('grantEditor', 'Giulia', people.guest?.id ?? null)).statusCode).toBe(403);
  });

  it('shows a board-only grant its own links and never the roster', async () => {
    await request('owner', 'PUT', `/boards/${planBoard}/schedule/cast-links`, {
      name: 'Giulia',
      userId: people.guest?.id,
    });
    const guest = (
      await request('guest', 'GET', `/boards/${planBoard}/schedule/attendance`)
    ).json();
    expect(guest.links).toEqual([{ castKey: 'giulia', userId: people.guest?.id }]);
    const editor = (
      await request('grantEditor', 'GET', `/boards/${planBoard}/schedule/attendance`)
    ).json();
    expect(editor).toMatchObject({ canManage: true, links: [] });
    expect((await request('guest', 'GET', `/projects/${projectId}/crew`)).statusCode).toBe(404);
  });
});
