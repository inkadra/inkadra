import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc } from '@inkadra/doc-schema';
import { Crew, CrewMember } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('private project crew', () => {
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
  let boardId = '';
  let projectId = '';
  let otherBoardId = '';
  const input = {
    name: 'Anna',
    department: 'Camera',
    role: '1° AC',
    phone: '+39 123456789',
    email: '',
    notes: 'Private note',
    pickup: 'Hotel',
    character: null,
    userId: null,
    onSetContact: true,
    position: 0,
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
  const base = () => `/projects/${projectId}/crew`;
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

  it('requires project membership; guests and outsiders get no contacts', async () => {
    expect((await request(null, 'GET', base())).statusCode).toBe(401);
    expect((await request('stranger', 'GET', base())).statusCode).toBe(404);
    expect((await request('stranger', 'POST', base(), input)).statusCode).toBe(404);
    expect((await request('viewer', 'POST', base(), input)).statusCode).toBe(403);
    expect((await request(null, 'GET', `/guest/projects/${projectId}/crew`)).statusCode).toBe(404);
  });
  it('lets an editor create and a viewer read private crew', async () => {
    const create = await request('editor', 'POST', base(), input);
    expect(create.statusCode).toBe(201);
    const row = CrewMember.parse(create.json());
    expect(row.revision).toBe(1);
    const read = await request('viewer', 'GET', base());
    expect(read.statusCode).toBe(200);
    expect(Crew.parse(read.json()).items[0]).toMatchObject({ name: 'Anna', notes: 'Private note' });
    expect(
      (await request('viewer', 'PUT', `${base()}/${row.id}`, { ...input, revision: 1 })).statusCode,
    ).toBe(403);
    const update = await request('editor', 'PUT', `${base()}/${row.id}`, {
      ...input,
      role: 'DIT',
      revision: 1,
    });
    expect(update.statusCode).toBe(200);
    const stale = await request('editor', 'PUT', `${base()}/${row.id}`, { ...input, revision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.current.role).toBe('DIT');
    expect(
      (await request('editor', 'DELETE', `${base()}/${row.id}`, { revision: 1 })).statusCode,
    ).toBe(409);
    expect(
      (await request('editor', 'DELETE', `${base()}/${row.id}`, { revision: 2 })).statusCode,
    ).toBe(204);
  });
  it('validates bulk atomically and skips duplicates', async () => {
    expect(
      (
        await request('editor', 'POST', `${base()}/bulk`, {
          items: [input, { ...input, name: '' }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await request('viewer', 'GET', base())).json().items).toHaveLength(0);
    const result = await request('editor', 'POST', `${base()}/bulk`, {
      items: [input, { ...input, name: 'ANNA' }, { ...input, name: 'Luca' }],
    });
    expect(result.statusCode).toBe(201);
    expect(result.json().items).toHaveLength(2);
    expect(
      (await request('editor', 'POST', `${base()}/bulk`, { items: [input] })).json().items,
    ).toHaveLength(0);
  });
  it('links character cards without copying their actor or contact', async () => {
    const doc = createBoardDoc(boardId);
    const card = createElement(
      doc,
      'character',
      { x: 0, y: 0 },
      { name: 'Mara', actor: 'Anna', contact: 'Private agent' },
      { userId: null },
    );
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db
      .insert(boardDoc)
      .values({ boardId, schemaVersion: CURRENT_SCHEMA_VERSION, size: state.length, state });
    doc.destroy();
    const available = await request('viewer', 'GET', `${base()}/characters`);
    expect(available.statusCode).toBe(200);
    expect(available.json().items).toContainEqual({
      boardId,
      elementId: card.id,
      name: 'Mara',
      actor: 'Anna',
      contact: 'Private agent',
    });
    const linked = await request('editor', 'POST', base(), {
      ...input,
      name: 'Anna linked',
      phone: '',
      character: { boardId, elementId: card.id },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({ phone: '', character: { boardId, elementId: card.id } });
    expect(
      (
        await request('editor', 'POST', base(), {
          ...input,
          character: { boardId, elementId: 'missing-card' },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('does not disclose project contacts through a board-only grant', async () => {
    const grant = await request(
      'owner',
      'PUT',
      `/boards/${boardId}/grants/${people.stranger?.id}`,
      { role: 'editor' },
    );
    expect(grant.statusCode).toBe(200);
    expect((await request('stranger', 'GET', base())).statusCode).toBe(404);
  });
  it('rejects cross-project character links', async () => {
    expect(
      (
        await request('owner', 'POST', base(), {
          ...input,
          character: { boardId: otherBoardId, elementId: 'character001' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
