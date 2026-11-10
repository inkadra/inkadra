import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc } from '@inkadra/doc-schema';
import { Crew, CrewMember } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc, crewMember, shootingDay } from '../db/schema.ts';
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
  it('answers every write with the linked account, as the list does', async () => {
    const account = { id: people.actor?.id, name: 'actor', image: null };
    const created = await request('editor', 'POST', base(), {
      ...input,
      name: 'With account',
      userId: people.actor?.id,
    });
    expect(created.statusCode).toBe(201);
    expect(CrewMember.parse(created.json()).account).toEqual(account);
    const id = created.json().id;
    const updated = await request('editor', 'PUT', `${base()}/${id}`, {
      ...input,
      name: 'With account',
      userId: people.actor?.id,
      role: 'Gaffer',
      revision: 1,
    });
    expect(updated.statusCode).toBe(200);
    expect(CrewMember.parse(updated.json()).account).toEqual(account);
    const stale = await request('editor', 'PUT', `${base()}/${id}`, {
      ...input,
      name: 'With account',
      userId: people.actor?.id,
      revision: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.current.account).toEqual(account);
    const bulk = await request('editor', 'POST', `${base()}/bulk`, {
      items: [{ ...input, name: 'Bulk with account', userId: people.actor?.id }],
    });
    expect(Crew.parse(bulk.json()).items[0]?.account).toEqual(account);
  });
  it('saves a person whose unchanged character link points to a removed card', async () => {
    const [row] = await db
      .insert(crewMember)
      .values({
        ...input,
        name: 'Removed card',
        projectId,
        character: { boardId, elementId: 'removedCard01' },
      })
      .returning();
    const update = await request('editor', 'PUT', `${base()}/${row?.id}`, {
      ...input,
      name: 'Removed card',
      role: 'Stand-in',
      character: { boardId, elementId: 'removedCard01' },
      revision: 1,
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ role: 'Stand-in', revision: 2 });
    // A new link is still checked.
    const changed = await request('editor', 'PUT', `${base()}/${row?.id}`, {
      ...input,
      name: 'Removed card',
      character: { boardId, elementId: 'removedCard02' },
      revision: 2,
    });
    expect(changed.statusCode).toBe(400);
  });
  it('merges a duplicate row into another and moves its day calls', async () => {
    const add = async (values: Record<string, unknown>) =>
      CrewMember.parse((await request('editor', 'POST', base(), { ...input, ...values })).json());
    const kept = await add({ name: 'Marta', phone: '', pickup: 'Hotel', onSetContact: false });
    const other = await add({
      name: 'marta ',
      phone: '+39 333',
      pickup: 'Home',
      userId: people.actor?.id ?? null,
    });
    const third = await add({ name: 'Marta', userId: people.viewer?.id ?? null });
    const call = (crewMemberId: string, at: string) => ({ crewMemberId, call: at, pickup: null });
    const day = (date: string, calls: ReturnType<typeof call>[]) => ({
      projectId,
      boardId,
      date,
      callTime: '08:00',
      location: '',
      notes: '',
      blocks: [],
      calls,
    });
    const [both, onlyOther] = await db
      .insert(shootingDay)
      .values([
        day('2030-01-01', [call(kept.id, '07:00'), call(other.id, '06:00')]),
        day('2030-01-02', [call(other.id, '05:00'), call(third.id, '09:00')]),
      ])
      .returning();
    const merge = (who: string, body: object, id = kept.id) =>
      request(who, 'POST', `${base()}/${id}/merge`, body);
    const body = { revision: 1, from: other.id, fromRevision: 1 };
    expect((await merge('viewer', body)).statusCode).toBe(403);
    expect((await merge('stranger', body)).statusCode).toBe(404);
    expect((await merge('editor', { ...body, fromRevision: 2 })).statusCode).toBe(409);
    expect((await merge('editor', { ...body, from: kept.id })).statusCode).toBe(400);
    // Two different accounts: merging would lose one link.
    expect(
      (await merge('editor', { revision: 1, from: third.id, fromRevision: 1 }, other.id))
        .statusCode,
    ).toBe(400);
    const merged = await merge('editor', body);
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({
      id: kept.id,
      name: 'Marta',
      phone: '+39 333',
      pickup: 'Hotel',
      userId: people.actor?.id,
      account: { id: people.actor?.id },
      revision: 2,
    });
    const ids = (await request('viewer', 'GET', base()))
      .json()
      .items.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(other.id);
    const calls = async (id: string | undefined) =>
      (
        await db
          .select()
          .from(shootingDay)
          .where(eq(shootingDay.id, id ?? ''))
      ).map((d) => ({
        calls: d.calls,
        revision: d.revision,
      }))[0];
    expect(await calls(both?.id)).toEqual({ calls: [call(kept.id, '07:00')], revision: 2 });
    expect(await calls(onlyOther?.id)).toEqual({
      calls: [call(kept.id, '05:00'), call(third.id, '09:00')],
      revision: 2,
    });
    expect((await merge('editor', { ...body, revision: 2 })).statusCode).toBe(404);
  });

  it('never leaves a call to a row a merge removes while a day is saved', async () => {
    const add = async (name: string) =>
      CrewMember.parse((await request('editor', 'POST', base(), { ...input, name })).json());
    const gone = await add('Ugo');
    const fields = { date: '2030-02-01', callTime: '08:00', wrap: null, location: '', notes: '' };
    // The day has no call to the row yet, so the merge's own day scan cannot see it.
    const [day] = await db
      .insert(shootingDay)
      .values({ ...fields, projectId, boardId, blocks: [], calls: [] })
      .returning();
    const merge = await client.reserve();
    try {
      // Another session is merging: it holds the row it will delete.
      await merge`begin`;
      await merge`select id from crew_member where id = ${gone.id} for update`;
      let done = false;
      const save = request('editor', 'PUT', `/boards/${boardId}/schedule/${day?.id}`, {
        ...fields,
        blocks: [],
        calls: [{ crewMemberId: gone.id, call: '07:00', pickup: null }],
        revision: 1,
      }).finally(() => {
        done = true;
      });
      // The save waits on the row (before the fix it validated without waiting and finished).
      for (let i = 0; i < 100 && !done; i++) {
        const [waiting] = await client`
          select count(*)::int as n from pg_locks where not granted and locktype = 'transactionid'`;
        if (waiting?.n) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await merge`delete from crew_member where id = ${gone.id}`;
      await merge`commit`;
      expect((await save).statusCode).toBe(200);
      const [after] = await db
        .select()
        .from(shootingDay)
        .where(eq(shootingDay.id, day?.id ?? ''));
      expect(after?.calls).toEqual([]);
    } finally {
      merge.release();
    }
  });
});
