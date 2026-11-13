import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  addElement,
  CURRENT_SCHEMA_VERSION,
  createBoardDoc,
  newElementId,
  readElement,
  roots,
} from '@inkadra/doc-schema';
import type { ClassificationCatalogs, ClassificationOption } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDatabase, type Database, runMigrations } from './db/client.ts';
import { board, boardDoc, project } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { writeBoardIndex } from './search/index-doc.ts';
import { freshDatabase, testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
const ORIGIN = 'http://localhost:3000';

describe.skipIf(!url)('removing classification values (needs DATABASE_URL)', () => {
  let db: Database;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let deps: ReturnType<typeof testDeps>;
  const cookies = { admin: '', member: '' };

  const call = (
    who: keyof typeof cookies,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: cookies[who], origin: ORIGIN, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const catalogs = async (who: keyof typeof cookies = 'admin') =>
    (await call(who, 'GET', '/instance/classifications?uses=true')).json() as ClassificationCatalogs;
  const save = (next: ClassificationCatalogs) =>
    call('admin', 'PUT', '/instance/classifications', next);
  type Key = 'projectTypes' | 'tags' | 'shotSizes';
  /** Adds a value to a catalog and returns it as saved. */
  const add = async (key: Key, label: string) => {
    const next = await catalogs();
    const id = randomUUID();
    next[key].push({ id, label, archived: false });
    expect((await save(next)).statusCode).toBe(200);
    return (await catalogs())[key].find((o) => o.id === id) as ClassificationOption;
  };
  const without = async (key: Key, id: string) => {
    const next = await catalogs();
    next[key] = next[key].filter((o) => o.id !== id);
    return save(next);
  };
  const find = async (key: Key, id: string) => (await catalogs())[key].find((o) => o.id === id);

  /** A project of `type` whose root board holds a note with `tags` and a frame of `shot`. */
  async function board_(content: { type?: string; tags?: string[]; shot?: string }) {
    const created = await call('admin', 'POST', '/projects', {
      name: 'Ultima corsa',
      ...(content.type ? { type: content.type } : {}),
    });
    expect(created.statusCode).toBe(201);
    const boardId = created.json().rootBoardId as string;
    return { projectId: created.json().id as string, boardId, doc: doc(boardId, content) };
  }
  function doc(boardId: string, content: { tags?: string[]; shot?: string }) {
    const d = createBoardDoc(boardId);
    const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
    if (content.tags)
      addElement(d, { ...base, id: newElementId(), type: 'note', tags: content.tags });
    if (content.shot) {
      const scene = { ...base, id: newElementId(), type: 'scene' as const, number: '1', title: '' };
      addElement(d, scene);
      addElement(d, {
        ...base,
        id: newElementId(),
        parent: scene.id,
        type: 'frame',
        shot: content.shot,
      });
    }
    return d;
  }
  async function store(
    tx: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
    boardId: string,
    d: Y.Doc,
  ) {
    const state = Y.encodeStateAsUpdate(d);
    await tx
      .insert(boardDoc)
      .values({ boardId, state, schemaVersion: CURRENT_SCHEMA_VERSION, size: state.byteLength })
      .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.byteLength } });
    await writeBoardIndex(tx, boardId, d);
  }

  beforeAll(async () => {
    const databaseUrl = await freshDatabase(url as string, 'classifications');
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_RATE_LIMITS: 'off',
      PUBLIC_URL: ORIGIN,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
      REGISTRATION: 'open',
    });
    await runMigrations(databaseUrl, migrations);
    const created = createDatabase(databaseUrl, 6);
    db = created.db;
    end = () => created.sql.end({ timeout: 1 });
    const log = pino({ level: 'silent' });
    deps = testDeps(db, log);
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth: createAuth(config, db),
      log,
      ...deps,
    });
    for (const who of ['admin', 'member'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: ORIGIN },
        payload: { email: `${who}@example.com`, password: 'correct-horse-battery', name: who },
      });
      cookies[who] = String(res.headers['set-cookie']).split(';')[0] ?? '';
    }
    // A database of its own and every migration: slow when the whole suite runs at once.
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await end?.();
  });

  it('advertises the capability and counts uses for administrators only', async () => {
    const version = (await call('member', 'GET', '/instance/version')).json();
    expect(version.capabilities).toContain('classification-delete');
    const tag = await add('tags', 'Pioggia');
    expect(tag.uses).toBe(0);
    expect((await catalogs()).projectTypes.every((o) => typeof o.uses === 'number')).toBe(true);
    // Storyboard defaults are words people type too: they are never counted.
    expect((await catalogs()).shotSizes.find((o) => o.id === 'cu')?.uses).toBeUndefined();
    expect((await catalogs('member')).tags.find((o) => o.id === tag.id)).not.toHaveProperty('uses');
  });

  it('removes a value nothing uses, and never takes its id again', async () => {
    const tag = await add('tags', 'Grandine');
    const shot = await add('shotSizes', 'Gimbal');
    const type = await add('projectTypes', 'Videoclip AI');
    for (const [key, option] of [
      ['tags', tag],
      ['shotSizes', shot],
      ['projectTypes', type],
    ] as const) {
      expect((await without(key, option.id)).statusCode).toBe(200);
      expect(await find(key, option.id)).toBeUndefined();
    }
    const again = await catalogs();
    again.tags.push({ id: tag.id, label: 'Grandine', archived: false });
    const reused = await save(again);
    expect(reused.statusCode).toBe(400);
    expect(reused.json().error.message).toMatch(/deleted value/);
    // A default is archived, never removed, used or not.
    expect((await without('shotSizes', 'ecu')).statusCode).toBe(400);
    expect((await without('projectTypes', 'documentary')).statusCode).toBe(400);
  });

  it('keeps a used value, by id or by its original tag text, with a stable reason', async () => {
    const type = await add('projectTypes', 'Spot radio');
    const tag = await add('tags', 'Notte');
    const shot = await add('shotSizes', 'Dal drone');
    const free = await add('tags', 'Alba');
    expect(free.legacy).toBe('alba');
    const { boardId, doc: d } = await board_({
      type: type.id,
      tags: [tag.id, 'Alba'],
      shot: shot.id,
    });
    await store(db, boardId, d);
    const read = await catalogs();
    expect(read.projectTypes.find((o) => o.id === type.id)?.uses).toBe(1);
    expect(read.tags.find((o) => o.id === tag.id)?.uses).toBe(1);
    expect(read.tags.find((o) => o.id === free.id)?.uses).toBe(1);
    expect(read.shotSizes.find((o) => o.id === shot.id)?.uses).toBe(1);
    for (const [key, option] of [
      ['projectTypes', type],
      ['tags', tag],
      ['tags', free],
      ['shotSizes', shot],
    ] as const) {
      const refused = await without(key, option.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.details).toEqual({
        reason: 'classification_in_use',
        values: [{ catalog: key, id: option.id, uses: 1 }],
      });
    }
    // Archiving stays possible, and the original binding cannot change.
    const archived = await catalogs();
    const tagged = archived.tags.find((o) => o.id === tag.id) as ClassificationOption;
    tagged.archived = true;
    expect((await save(archived)).statusCode).toBe(200);
    const moved = await catalogs();
    (moved.tags.find((o) => o.id === tag.id) as ClassificationOption).legacy = 'giorno';
    expect((await save(moved)).statusCode).toBe(400);
  });

  it('lets a use that is being stored win over a removal', async () => {
    const tag = await add('tags', 'Controluce');
    const { boardId } = await board_({});
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let stored = () => {};
    const ready = new Promise<void>((r) => {
      stored = r;
    });
    const use = db.transaction(async (tx) => {
      await store(tx, boardId, doc(boardId, { tags: [tag.id] }));
      stored();
      await gate;
    });
    await ready;
    let settled = false;
    const removal = without('tags', tag.id).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    release();
    await use;
    expect((await removal).statusCode).toBe(409);
    expect((await find('tags', tag.id))?.uses).toBe(1);
  });

  it('brings a removed value back, archived, when a late use arrives', async () => {
    const tag = await add('tags', 'Tramonto');
    const shot = await add('shotSizes', 'Spalla');
    expect((await without('tags', tag.id)).statusCode).toBe(200);
    expect((await without('shotSizes', shot.id)).statusCode).toBe(200);
    // An undo, an offline copy or a restored version stores the old ids again.
    const { boardId } = await board_({});
    await store(db, boardId, doc(boardId, { tags: [tag.id], shot: shot.id }));
    expect(await find('tags', tag.id)).toMatchObject({
      label: 'Tramonto',
      archived: true,
      legacy: 'tramonto',
      uses: 1,
    });
    expect(await find('shotSizes', shot.id)).toMatchObject({ label: 'Spalla', archived: true });

    // Its name taken meanwhile: it comes back under a numbered one, without the binding.
    const snow = await add('tags', 'Neve');
    expect((await without('tags', snow.id)).statusCode).toBe(200);
    const newSnow = await add('tags', 'Neve');
    expect(newSnow.legacy).toBe('neve');
    await store(db, boardId, doc(boardId, { tags: [snow.id] }));
    const back = await find('tags', snow.id);
    expect(back).toMatchObject({ label: 'Neve (2)', archived: true });
    expect(back?.legacy).toBeUndefined();
    expect((await save(await catalogs())).statusCode).toBe(200);
  });

  it('round-trips an archive whose values were removed meanwhile', async () => {
    const type = await add('projectTypes', 'Fotoromanzo');
    const tag = await add('tags', 'Pioggia battente');
    const shot = await add('shotSizes', 'Dettaglio mani');
    const {
      projectId,
      boardId,
      doc: d,
    } = await board_({
      type: type.id,
      tags: [tag.id],
      shot: shot.id,
    });
    await store(db, boardId, d);
    const started = await call('admin', 'POST', `/projects/${projectId}/exports`);
    expect(started.statusCode).toBe(202);
    await deps.jobs.idle();
    const download = await call('admin', 'GET', `/transfers/${started.json().id}/download`);
    expect(download.statusCode).toBe(200);
    // The project is gone for good: nothing uses the three values, which are removed.
    await db.delete(project).where(eq(project.id, projectId));
    for (const [key, option] of [
      ['projectTypes', type],
      ['tags', tag],
      ['shotSizes', shot],
    ] as const)
      expect((await without(key, option.id)).statusCode).toBe(200);

    const imported = await call('admin', 'POST', '/projects/import', download.rawPayload, {
      'content-type': 'application/zip',
    });
    expect(imported.statusCode).toBe(202);
    await deps.jobs.idle();
    const done = (await call('admin', 'GET', `/transfers/${imported.json().id}`)).json();
    expect(done).toMatchObject({ status: 'ready' });
    // The type and the tag come back under their ids; the storyboard value turns into its text,
    // as any value unknown here does (decision 0071).
    expect(await find('projectTypes', type.id)).toMatchObject({ archived: true, uses: 1 });
    expect(await find('tags', tag.id)).toMatchObject({ archived: true, uses: 1 });
    expect(await find('shotSizes', shot.id)).toBeUndefined();
    const [root] = await db
      .select({ id: board.id })
      .from(board)
      .where(sql`${board.projectId} = ${done.projectId} and ${board.parentBoardId} is null`);
    const [row] = await db
      .select()
      .from(boardDoc)
      .where(eq(boardDoc.boardId, root?.id ?? ''));
    const back = new Y.Doc();
    Y.applyUpdate(back, row?.state ?? new Uint8Array());
    const frames = [...roots(back).elements.values()]
      .map((m) => readElement(m))
      .filter((el) => el?.type === 'frame');
    expect(frames).toMatchObject([{ shot: 'Dettaglio mani' }]);
  });
});
