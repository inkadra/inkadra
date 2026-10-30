import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { addElement, CURRENT_SCHEMA_VERSION, createBoardDoc, roots } from '@inkadra/doc-schema';
import { ProjectArchiveManifest, ProjectTransfer, ProjectTransfers } from '@inkadra/shared';
import { asc, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, type Database, runMigrations } from '../db/client.ts';
import {
  asset,
  board,
  boardDoc,
  boardVersion,
  comment,
  elementReview,
  notification,
  project,
  projectExportSettings,
  projectTransfer,
  shootingDay,
} from '../db/schema.ts';
import { writeBoardIndex } from '../search/index-doc.ts';
import { readAll } from '../storage.ts';
import { freshDatabase, testDeps } from '../test-deps.ts';
import { readableElements } from '../transfers/export.ts';
import { importProject } from '../transfers/import.ts';
import { runTransfer, transferFile, transfersDir } from '../transfers/service.ts';
import { readZip, writeZip } from '../transfers/zip.ts';
import { createApp } from './app.ts';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.DATABASE_URL;

type App = Awaited<ReturnType<typeof createApp>>;
interface Instance {
  app: App;
  db: Database;
  deps: ReturnType<typeof testDeps>;
  close(): Promise<void>;
}

async function instance(databaseUrl: string, env: Record<string, string> = {}): Promise<Instance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
    ...env,
  });
  await runMigrations(databaseUrl, migrations);
  const { db, sql: client } = createDatabase(databaseUrl, 4);
  await db.execute(sql`truncate table "user", project, instance_setting, project_transfer cascade`);
  const log = pino({ level: 'silent' });
  const deps = testDeps(db, log);
  const app = await createApp({
    config: { ...config, DATA_DIR: deps.root },
    db,
    auth: createAuth(config, db),
    log,
    ...deps,
  });
  return {
    app,
    db,
    deps,
    async close() {
      await app.close();
      await client.end({ timeout: 1 });
    },
  };
}

async function signUp(app: App, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: 'http://localhost:3000' },
    payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
  });
  expect(response.statusCode).toBe(200);
  return {
    id: response.json().user.id as string,
    cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
  };
}

const call = (
  app: App,
  who: { cookie: string } | null,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      ...(who ? { cookie: who.cookie, origin: 'http://localhost:3000' } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function storeDoc(db: Database, boardId: string, doc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(doc);
  await db
    .insert(boardDoc)
    .values({ boardId, state, schemaVersion: CURRENT_SCHEMA_VERSION, size: state.byteLength })
    .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.byteLength } });
  await writeBoardIndex(db, boardId, doc);
}

/** Elements without the ids an import rewrites, to compare two instances. */
function comparable(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return readableElements(doc).map(
    ({ assetId, boardId, createdBy, imageAssetId, source, ...rest }) => ({
      ...rest,
      source:
        source && typeof source === 'object' && 'kind' in source && source.kind === 'uploaded-video'
          ? { ...source, assetId: '<remapped>' }
          : source,
      hasAsset: assetId !== undefined,
      hasBoard: boardId !== undefined,
    }),
  );
}

describe.skipIf(!url)('project export and import (needs DATABASE_URL)', () => {
  let source: Instance;
  let target: Instance;
  const people: Record<string, { id: string; cookie: string }> = {};
  let projectId = '';
  let rootId = '';
  let childId = '';
  let png: Buffer;
  let videoId: string;
  let archive: Buffer;

  beforeAll(async () => {
    source = await instance(url as string);
    target = await instance(await freshDatabase(url as string, 'import'), {
      IMPORT_MAX_SIZE: '1MB',
    });
    for (const name of ['owner', 'editor', 'viewer']) people[name] = await signUp(source.app, name);
    const created = await call(source.app, people.owner ?? null, 'POST', '/projects', {
      name: 'Last Train',
      type: 'short_film',
    });
    expect(created.statusCode).toBe(201);
    projectId = created.json().id;
    rootId = created.json().rootBoardId;
    await source.db
      .update(project)
      .set({ iconShape: 'star', iconColor: 'yellow', iconEmoji: '🚂' })
      .where(eq(project.id, projectId));
    for (const role of ['editor', 'viewer'])
      await call(
        source.app,
        people.owner ?? null,
        'PUT',
        `/projects/${projectId}/members/${people[role]?.id}`,
        {
          role,
        },
      );
    const child = await call(
      source.app,
      people.owner ?? null,
      'POST',
      `/projects/${projectId}/boards`,
      {
        parentBoardId: rootId,
        title: 'Platform 9',
      },
    );
    childId = child.json().id;

    png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#335577' } })
      .png()
      .toBuffer();
    const [file] = await source.db
      .insert(asset)
      .values({
        projectId,
        kind: 'image',
        mime: 'image/png',
        filename: 'station.png',
        size: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        storageKey: 'pending',
        status: 'ready',
        createdBy: people.owner?.id,
      })
      .returning();
    const assetId = file?.id as string;
    await source.db
      .update(asset)
      .set({ storageKey: `originals/${assetId}` })
      .where(eq(asset.id, assetId));
    await source.deps.storage.write(`originals/${assetId}`, png, 'image/png');
    const video = Buffer.from('synthetic video original');
    const [footage] = await source.db
      .insert(asset)
      .values({
        projectId,
        kind: 'video',
        mime: 'video/mp4',
        filename: 'last-train.mp4',
        size: video.length,
        storageKey: 'pending',
        status: 'ready',
        createdBy: people.owner?.id,
      })
      .returning();
    videoId = footage!.id;
    await source.db
      .update(asset)
      .set({ storageKey: `originals/${videoId}` })
      .where(eq(asset.id, videoId));
    await source.deps.storage.write(`originals/${videoId}`, video, 'video/mp4');
    // Export settings with the station picture as the logo (decision 0039).
    await source.db.insert(projectExportSettings).values({
      projectId,
      preferences: { framesPerPage: 6, paper: 'letter', audience: 'team' },
      logoAssetId: assetId,
      updatedBy: people.owner?.id,
    });

    const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdAt: 1 };
    const root = createBoardDoc(rootId);
    addElement(root, {
      ...base,
      id: 'note-000001',
      type: 'note',
      createdBy: people.editor?.id ?? null,
      tags: ['night'],
    });
    addElement(root, {
      ...base,
      id: 'image-00001',
      z: 'a1',
      type: 'image',
      assetId,
      caption: 'Arrival',
      source: { kind: 'uploaded-video', assetId: videoId, timeSeconds: 1.125 },
      createdBy: people.owner?.id ?? null,
    });
    addElement(root, {
      ...base,
      id: 'board-00001',
      z: 'a2',
      type: 'board',
      boardId: childId,
      createdBy: people.owner?.id ?? null,
    });
    const note = roots(root).elements.get('note-000001')?.get('body') as Y.XmlFragment;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('The last train leaves at midnight.')]);
    note.insert(0, [paragraph]);
    await storeDoc(source.db, rootId, root);
    const childDoc = createBoardDoc(childId);
    addElement(childDoc, {
      ...base,
      id: 'todo-000001',
      type: 'todo',
      title: 'Props',
      items: [{ id: 'item-000001', text: 'Lantern', done: false }],
      createdBy: people.owner?.id ?? null,
    });
    await storeDoc(source.db, childId, childDoc);

    const [thread] = await source.db
      .insert(comment)
      .values({
        projectId,
        boardId: rootId,
        elementId: 'image-00001',
        authorId: people.editor?.id,
        body: `Lovely light @{${people.owner?.id}}`,
        mentions: [people.owner?.id as string],
      })
      .returning();
    await source.db.insert(comment).values({
      projectId,
      boardId: rootId,
      elementId: 'image-00001',
      threadId: thread?.id,
      authorId: people.owner?.id,
      body: `Thanks @{${people.editor?.id}}`,
      mentions: [people.editor?.id as string],
    });
    // Deleted: it keeps its place in the thread, never its words.
    await source.db.insert(comment).values({
      projectId,
      boardId: rootId,
      elementId: 'image-00001',
      threadId: thread?.id,
      authorId: people.viewer?.id,
      body: 'Something to take back',
      deletedAt: new Date(),
    });
    await source.db.insert(elementReview).values({
      boardId: rootId,
      projectId,
      elementId: 'image-00001',
      status: 'approved',
      changedBy: people.owner?.id,
    });
    const day = await call(
      source.app,
      people.owner ?? null,
      'POST',
      `/boards/${childId}/schedule`,
      {
        date: '2026-11-02',
        callTime: '07:30',
        wrap: null,
        location: 'Old station',
        notes: '',
        blocks: [],
      },
    );
    expect(day.statusCode).toBe(201);
    const state = Y.encodeStateAsUpdate(root);
    await source.db.insert(boardVersion).values({
      boardId: rootId,
      kind: 'named',
      name: 'Before the rain',
      state,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      size: state.byteLength,
      elementCount: 3,
      createdBy: people.owner?.id,
    });
  });

  afterAll(async () => {
    await source?.close();
    await target?.close();
  });

  it('lets owners and editors export, not viewers or strangers', async () => {
    expect(
      (await call(source.app, people.viewer ?? null, 'POST', `/projects/${projectId}/exports`))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(source.app, null, 'POST', `/projects/${projectId}/exports`)).statusCode,
    ).toBe(401);
    const editor = await call(
      source.app,
      people.editor ?? null,
      'POST',
      `/projects/${projectId}/exports`,
    );
    expect(editor.statusCode).toBe(202);
    await source.deps.jobs.idle();
    // Another person's export is not theirs to see or download.
    const id = editor.json().id;
    expect(
      (await call(source.app, people.owner ?? null, 'GET', `/transfers/${id}`)).statusCode,
    ).toBe(404);
    expect(
      (await call(source.app, people.owner ?? null, 'GET', `/transfers/${id}/download`)).statusCode,
    ).toBe(404);
  });

  it('exports the project as a documented archive', async () => {
    const started = await call(
      source.app,
      people.owner ?? null,
      'POST',
      `/projects/${projectId}/exports`,
    );
    expect(started.statusCode).toBe(202);
    expect(started.headers.location).toBe(`/api/v1/transfers/${started.json().id}`);
    expect(ProjectTransfer.parse(started.json())).toMatchObject({
      kind: 'export',
      projectName: 'Last Train',
    });
    await source.deps.jobs.idle();
    const list = ProjectTransfers.parse(
      (await call(source.app, people.owner ?? null, 'GET', '/transfers')).json(),
    );
    const done = list.items.find((t) => t.id === started.json().id);
    expect(done).toMatchObject({ status: 'ready', progress: 1, failure: null });
    expect(done?.summary).toMatchObject({ boards: 2, elements: 4, files: 2, comments: 3 });
    expect(done?.expiresAt).not.toBeNull();

    const download = await call(
      source.app,
      people.owner ?? null,
      'GET',
      `/transfers/${done?.id}/download`,
    );
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(String(download.headers['content-disposition'])).toContain('Last Train');
    archive = download.rawPayload;

    const path = join(await mkdtemp(join(tmpdir(), 'inkadra-export-')), 'a.zip');
    await writeFile(path, archive);
    const zip = await readZip(path, { entries: 100, totalBytes: 1e9, compressionRatio: 1e6 });
    const manifest = await zip.json('manifest.json', ProjectArchiveManifest, 1e6);
    expect(manifest).toMatchObject({
      format: 'inkadra-project',
      formatVersion: 1,
      counts: { boards: 2, assets: 2, versions: 1 },
    });
    const readable = JSON.parse(
      (await zip.buffer(`boards/${rootId}/elements.json`, 1e6)).toString(),
    );
    expect(readable.elements.find((e: { id: string }) => e.id === 'note-000001').text).toContain(
      'midnight',
    );
    expect(zip.has('schedule.json') && zip.has('reviews.json') && zip.has('comments.json')).toBe(
      true,
    );
    expect(await zip.buffer(`files/${(await source.db.select().from(asset))[0]?.id}`, 1e6)).toEqual(
      png,
    );
    expect(zip.names().some((n) => n.startsWith('variants'))).toBe(false);
    // Names only: an archive never carries email addresses.
    const peopleJson = (await zip.buffer('people.json', 1e6)).toString();
    expect(
      JSON.parse(peopleJson)
        .map((p: { name: string }) => p.name)
        .sort(),
    ).toEqual(['editor', 'owner', 'viewer']);
    expect(peopleJson).not.toContain('@example.com');
    const archived = JSON.parse((await zip.buffer('comments.json', 1e6)).toString());
    expect(archived.find((c: { deletedAt: string | null }) => c.deletedAt).body).toBe('');
    zip.close();

    const notes = await source.db
      .select()
      .from(notification)
      .where(eq(notification.type, 'export_ready'));
    expect(notes.map((n) => n.userId)).toContain(people.owner?.id);
    expect(notes.every((n) => n.emailedAt !== null)).toBe(true);
  });

  it('imports the archive on a fresh instance with the same boards, elements and files', async () => {
    // The owner has an account here with the same email: it is still never matched.
    const importer = await signUp(target.app, 'owner');
    const started = await call(target.app, importer, 'POST', '/projects/import', archive, {
      'content-type': 'application/zip',
    });
    expect(started.statusCode).toBe(202);
    await target.deps.jobs.idle();
    const done = ProjectTransfer.parse(
      (await call(target.app, importer, 'GET', `/transfers/${started.json().id}`)).json(),
    );
    expect(done).toMatchObject({ status: 'ready', kind: 'import', projectName: 'Last Train' });
    expect(done.summary).toMatchObject({
      boards: 2,
      elements: 4,
      files: 2,
      comments: 3,
      skippedFiles: 0,
      remappedPeople: 3,
    });
    const newProject = done.projectId as string;
    expect(newProject).not.toBe(projectId);

    const project = await call(target.app, importer, 'GET', `/projects/${newProject}`);
    expect(project.json()).toMatchObject({
      name: 'Last Train',
      type: 'short_film',
      myRole: 'owner',
      icon: { shape: 'star', color: 'yellow', emoji: '🚂' },
    });

    const boardsA = await source.db
      .select()
      .from(board)
      .where(eq(board.projectId, projectId))
      .orderBy(asc(board.createdAt));
    const boardsB = await target.db
      .select()
      .from(board)
      .where(eq(board.projectId, newProject))
      .orderBy(asc(board.createdAt));
    expect(boardsB.map((b) => [b.title, b.kind, b.parentBoardId === null])).toEqual(
      boardsA.map((b) => [b.title, b.kind, b.parentBoardId === null]),
    );
    const rootB = boardsB.find((b) => b.parentBoardId === null)?.id as string;
    const childB = boardsB.find((b) => b.parentBoardId !== null)?.id as string;
    expect(boardsB.find((b) => b.id === childB)?.parentBoardId).toBe(rootB);

    for (const [a, b] of [
      [rootId, rootB],
      [childId, childB],
    ] as const) {
      const [docA] = await source.db.select().from(boardDoc).where(eq(boardDoc.boardId, a));
      const [docB] = await target.db.select().from(boardDoc).where(eq(boardDoc.boardId, b));
      expect(comparable(docB?.state as Uint8Array)).toEqual(comparable(docA?.state as Uint8Array));
    }
    const [docB] = await target.db.select().from(boardDoc).where(eq(boardDoc.boardId, rootB));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, docB?.state as Uint8Array);
    const elements = roots(doc).elements;
    expect(roots(doc).meta.get('boardId')).toBe(rootB);
    expect(elements.get('board-00001')?.get('boardId')).toBe(childB);
    const importedFiles = await target.db
      .select()
      .from(asset)
      .where(eq(asset.projectId, newProject));
    const fileB = importedFiles.find((f) => f.filename === 'station.png');
    const videoB = importedFiles.find((f) => f.filename === 'last-train.mp4');
    expect(videoB?.id).toBeTruthy();
    expect(videoB?.id).not.toBe(videoId);
    expect(elements.get('image-00001')?.get('source')).toEqual({
      kind: 'uploaded-video',
      assetId: videoB?.id,
      timeSeconds: 1.125,
    });
    expect(elements.get('image-00001')?.get('assetId')).toBe(fileB?.id);
    expect(elements.get('image-00001')?.get('createdBy')).toBe(importer.id);
    expect(elements.get('note-000001')?.get('createdBy')).toBe(importer.id);
    expect(fileB).toMatchObject({
      filename: 'station.png',
      mime: 'image/png',
      size: png.length,
      status: 'ready',
    });
    expect(await readAll(await target.deps.storage.read(fileB?.storageKey as string))).toEqual(png);
    const [settings] = await target.db
      .select()
      .from(projectExportSettings)
      .where(eq(projectExportSettings.projectId, newProject));
    expect(settings).toMatchObject({ logoAssetId: fileB?.id, updatedBy: importer.id });
    expect(settings?.preferences).toMatchObject({
      framesPerPage: 6,
      paper: 'letter',
      audience: 'team',
      format: 'pdf',
    });
    // Thumbnails are made again on this instance.
    expect(await target.deps.storage.size(`variants/${fileB?.id}/256.webp`)).not.toBeNull();

    const comments = await target.db
      .select()
      .from(comment)
      .where(eq(comment.projectId, newProject))
      .orderBy(asc(comment.createdAt));
    expect(comments.map((c) => c.body)).toEqual(['Lovely light @owner', 'Thanks @editor', '']);
    expect(comments.every((c) => c.mentions.length === 0)).toBe(true);
    expect(comments.map((c) => c.importedAuthor)).toEqual(['editor', 'owner', 'viewer']);
    expect(comments.every((c) => c.authorId === importer.id)).toBe(true);
    expect(comments[1]?.threadId).toBe(comments[0]?.id);
    const listed = await call(target.app, importer, 'GET', `/boards/${rootB}/comments`);
    expect(JSON.stringify(listed.json())).toContain('"kind":"imported","name":"editor"');
    const [review] = await target.db
      .select()
      .from(elementReview)
      .where(eq(elementReview.boardId, rootB));
    expect(review).toMatchObject({
      elementId: 'image-00001',
      status: 'approved',
      changedBy: importer.id,
      importedAuthor: 'owner',
    });
    const [day] = await target.db
      .select()
      .from(shootingDay)
      .where(eq(shootingDay.projectId, newProject));
    expect(day).toMatchObject({ boardId: childB, location: 'Old station', callTime: '07:30' });
    const [version] = await target.db
      .select()
      .from(boardVersion)
      .where(eq(boardVersion.boardId, rootB));
    expect(version).toMatchObject({
      kind: 'named',
      name: 'Before the rain',
      createdBy: importer.id,
      importedAuthor: 'owner',
    });
  });

  it('imports into the same instance as a second, separate project', async () => {
    const started = await call(
      source.app,
      people.editor ?? null,
      'POST',
      '/projects/import',
      archive,
      {
        'content-type': 'application/zip',
      },
    );
    expect(started.statusCode).toBe(202);
    await source.deps.jobs.idle();
    const done = (
      await call(source.app, people.editor ?? null, 'GET', `/transfers/${started.json().id}`)
    ).json();
    expect(done).toMatchObject({ status: 'ready' });
    expect(done.summary.remappedPeople).toBe(3);
    expect(done.projectId).not.toBe(projectId);
    const files = await source.db.select().from(asset).where(eq(asset.projectId, done.projectId));
    expect(files).toHaveLength(2);
  });

  it('refuses archives it cannot trust', async () => {
    const importer = await signUp(target.app, 'second');
    const send = async (body: Buffer, type = 'application/zip') => {
      const res = await call(target.app, importer, 'POST', '/projects/import', body, {
        'content-type': type,
      });
      if (res.statusCode !== 202) return res.statusCode;
      await target.deps.jobs.idle();
      return (await call(target.app, importer, 'GET', `/transfers/${res.json().id}`)).json()
        .failure;
    };
    const zipOf = async (entries: Record<string, unknown>) => {
      const path = join(await mkdtemp(join(tmpdir(), 'inkadra-bad-')), 'x.zip');
      const zip = writeZip(path);
      for (const [name, value] of Object.entries(entries))
        await zip.addBuffer(name, Buffer.isBuffer(value) ? value : JSON.stringify(value));
      await zip.close();
      const { readFile } = await import('node:fs/promises');
      return readFile(path);
    };
    expect(await send(Buffer.from('not a zip'))).toBe('invalid_archive');
    expect(await send(Buffer.from('x'), 'text/plain')).toBe(415);
    expect(await send(Buffer.alloc(2 * 1024 * 1024))).toBe(413);
    const manifest = {
      format: 'inkadra-project',
      formatVersion: 1,
      appVersion: 'test',
      exportedAt: new Date().toISOString(),
      docSchemaVersion: CURRENT_SCHEMA_VERSION,
      counts: { boards: 0, assets: 0, comments: 0, versions: 0 },
    };
    expect(await send(await zipOf({ 'manifest.json': { ...manifest, formatVersion: 2 } }))).toBe(
      'unsupported_version',
    );
    expect(
      await send(await zipOf({ 'manifest.json': { ...manifest, docSchemaVersion: 99 } })),
    ).toBe('too_new');
    expect(await send(await zipOf({ 'manifest.json': { format: 'something-else' } }))).toBe(
      'invalid_archive',
    );
    // Valid manifest, a project.json that does not match the schema.
    expect(
      await send(await zipOf({ 'manifest.json': manifest, 'project.json': { name: '' } })),
    ).toBe('invalid_archive');
    // One import at a time per person, checked before the archive is received.
    const [active] = await target.db
      .insert(projectTransfer)
      .values({ kind: 'import', status: 'running', userId: importer.id, projectName: '' })
      .returning();
    expect(await send(await zipOf({ 'manifest.json': manifest }))).toBe(409);
    await target.db.delete(projectTransfer).where(eq(projectTransfer.id, active?.id as string));
    const noLength = await target.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      headers: {
        cookie: importer.cookie,
        origin: 'http://localhost:3000',
        'content-type': 'application/zip',
      },
      payload: Readable.from([Buffer.from('x')]),
    });
    expect(noLength.statusCode).toBe(411);
    // Nothing was created by the refused imports, and no archive is left behind.
    const projects = await call(target.app, importer, 'GET', '/projects');
    expect(projects.json().items).toHaveLength(0);
  });

  it('stops a running transfer and removes a finished one with its archive', async () => {
    const [running] = await source.db
      .insert(projectTransfer)
      .values({
        kind: 'export',
        status: 'running',
        userId: people.owner?.id as string,
        projectId,
        projectName: 'Last Train',
      })
      .returning();
    const runningId = running?.id as string;
    expect(
      (await call(source.app, people.owner ?? null, 'GET', `/transfers/${runningId}/download`))
        .statusCode,
    ).toBe(409);
    expect(
      (await call(source.app, people.owner ?? null, 'DELETE', `/transfers/${runningId}`))
        .statusCode,
    ).toBe(204);
    expect(
      (await call(source.app, people.owner ?? null, 'GET', `/transfers/${runningId}`)).json(),
    ).toMatchObject({ status: 'failed', failure: 'cancelled' });

    const list = (await call(source.app, people.owner ?? null, 'GET', '/transfers')).json();
    expect(list.nextCursor).toBeNull();
    const id = list.items.find((t: { status: string }) => t.status === 'ready').id;
    expect(
      (await call(source.app, people.owner ?? null, 'DELETE', `/transfers/${id}`)).statusCode,
    ).toBe(204);
    expect(
      (await call(source.app, people.owner ?? null, 'GET', `/transfers/${id}/download`)).statusCode,
    ).toBe(404);
  });

  /** An archive of one root board and one file, built by hand around `file`. */
  async function handmade(file: {
    data: Buffer;
    size?: number;
    sha256?: string | null;
    compress?: boolean;
    withFile?: boolean;
  }) {
    const ids = {
      root: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
      asset: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a21',
    };
    const at = new Date().toISOString();
    const doc = createBoardDoc(ids.root);
    addElement(doc, {
      id: 'image-00001',
      type: 'image',
      assetId: ids.asset,
      source: { kind: 'uploaded-video', assetId: ids.asset, timeSeconds: 0 },
      x: 0,
      y: 0,
      w: 240,
      z: 'a0',
      parent: null,
      createdAt: 1,
      createdBy: null,
    });
    addElement(doc, {
      id: 'frame-00001',
      type: 'frame',
      assetId: ids.asset,
      source: { kind: 'uploaded-video', assetId: ids.asset, timeSeconds: 0 },
      x: 300,
      y: 0,
      w: 240,
      z: 'a1',
      parent: null,
      createdAt: 1,
      createdBy: null,
    } as never);
    const path = join(await mkdtemp(join(tmpdir(), 'inkadra-hand-')), 'a.zip');
    const zip = writeZip(path);
    const json = (name: string, value: unknown) => zip.addJson(name, value);
    if (file.withFile !== false)
      await zip.addBuffer(`files/${ids.asset}`, file.data, file.compress ?? false);
    await json('manifest.json', {
      format: 'inkadra-project',
      formatVersion: 1,
      appVersion: 'test',
      exportedAt: at,
      docSchemaVersion: CURRENT_SCHEMA_VERSION,
      counts: { boards: 1, assets: 1, comments: 0, versions: 0 },
    });
    await json('project.json', {
      id: ids.root,
      name: 'Night Shift',
      icon: { shape: 'circle', color: 'blue' },
      type: null,
      shootingStart: null,
      shootingEnd: null,
      archived: false,
      createdAt: at,
    });
    await json('boards.json', [
      {
        id: ids.root,
        parentId: null,
        kind: 'board',
        title: 'Night Shift',
        position: 'a0',
        coverAssetId: null,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdBy: null,
        createdAt: at,
        updatedAt: at,
      },
    ]);
    await zip.addBuffer(`boards/${ids.root}/document.yjs`, Buffer.from(Y.encodeStateAsUpdate(doc)));
    await json('assets.json', [
      {
        id: ids.asset,
        kind: 'image',
        mime: 'image/png',
        filename: 'still.png',
        size: file.size ?? file.data.length,
        sha256:
          file.sha256 === undefined
            ? createHash('sha256').update(file.data).digest('hex')
            : file.sha256,
        sourceUrl: null,
        createdBy: null,
        createdAt: at,
      },
    ]);
    await zip.close();
    return path;
  }
  const importDeps = (overrides: Partial<Parameters<typeof importProject>[0]> = {}) => ({
    db: target.db,
    storage: target.deps.storage,
    jobs: target.deps.jobs,
    uploadMaxSize: 0,
    importMaxSize: 1024 ** 3,
    ...overrides,
  });
  const storedOriginals = async () =>
    (await readdir(join(target.deps.root, 'files', 'originals')).catch(() => [])).length;

  it('fails, and keeps no file, when a file entry is truncated', async () => {
    const owner = await signUp(target.app, 'damaged');
    const before = await storedOriginals();
    const data = Buffer.from('frame by frame '.repeat(4096));
    const declared = data.length + 100;
    const path = await handmade({ data, size: declared, sha256: null, compress: true });
    // The central directory promises more bytes than the deflated data holds: the reader
    // fails at the end of the entry, which must fail the import instead of hanging it.
    const bytes = await readFile(path);
    const header = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(declared, header + 24);
    await writeFile(path, bytes);
    await expect(importProject(importDeps(), path, owner.id)).rejects.toThrow();
    expect(await storedOriginals()).toBe(before);
    const projects = await call(target.app, owner, 'GET', '/projects');
    expect(projects.json().items).toHaveLength(0);
  });

  it('skips files that are missing or do not match their checksum, and says so', async () => {
    const owner = await signUp(target.app, 'skipper');
    for (const path of [
      await handmade({ data: png, sha256: 'f'.repeat(64) }),
      await handmade({ data: png, withFile: false }),
    ]) {
      const result = await importProject(importDeps(), path, owner.id);
      expect(result.summary).toMatchObject({ files: 0, skippedFiles: 1 });
      const files = await target.db
        .select()
        .from(asset)
        .where(eq(asset.projectId, result.projectId));
      expect(files).toHaveLength(0);
      const [board0] = await target.db
        .select()
        .from(board)
        .where(eq(board.projectId, result.projectId));
      const [stored] = await target.db
        .select()
        .from(boardDoc)
        .where(eq(boardDoc.boardId, board0?.id as string));
      const doc = new Y.Doc();
      Y.applyUpdate(doc, stored?.state as Uint8Array);
      // The image card stays, showing a missing file; the frame loses its optional picture.
      expect(roots(doc).elements.get('image-00001')?.get('assetId')).toMatch(/^[0-9a-f-]{36}$/);
      expect(roots(doc).elements.get('frame-00001')?.has('assetId')).toBe(false);
      expect(roots(doc).elements.get('frame-00001')?.has('source')).toBe(false);
      expect(roots(doc).elements.get('image-00001')?.has('source')).toBe(false);
    }
  });

  it('keeps the imported project and its files when thumbnails cannot be queued', async () => {
    const owner = await signUp(target.app, 'queueless');
    const failing = {
      processAsset: async () => {
        throw new Error('queue down');
      },
    };
    const result = await importProject(
      importDeps({ jobs: failing }),
      await handmade({ data: png }),
      owner.id,
    );
    const [file] = await target.db
      .select()
      .from(asset)
      .where(eq(asset.projectId, result.projectId));
    expect(file?.status).toBe('processing');
    expect(await target.deps.storage.size(file?.storageKey as string)).toBe(png.length);
  });

  it('stops an import that is cancelled while it runs, keeping nothing', async () => {
    const owner = await signUp(target.app, 'canceller');
    const before = await storedOriginals();
    const path = await handmade({ data: png });
    const [row] = await target.db
      .insert(projectTransfer)
      .values({ kind: 'import', userId: owner.id, projectName: '' })
      .returning();
    const id = row?.id as string;
    await mkdir(transfersDir(target.deps.root), { recursive: true });
    await copyFile(path, transferFile(target.deps.root, id));
    // The person cancels while the first file is being written.
    const storage = {
      ...target.deps.storage,
      async writeStream(...args: Parameters<typeof target.deps.storage.writeStream>) {
        await target.deps.storage.writeStream(...args);
        expect((await call(target.app, owner, 'DELETE', `/transfers/${id}`)).statusCode).toBe(204);
      },
    };
    await runTransfer(
      {
        db: target.db,
        storage,
        jobs: target.deps.jobs,
        dataDir: target.deps.root,
        uploadMaxSize: 0,
        importMaxSize: 1024 ** 3,
        log: pino({ level: 'silent' }),
      },
      id,
    );
    const [after] = await target.db
      .select()
      .from(projectTransfer)
      .where(eq(projectTransfer.id, id));
    expect(after).toMatchObject({ status: 'failed', failure: 'cancelled', projectId: null });
    expect(await storedOriginals()).toBe(before);
    const projects = await call(target.app, owner, 'GET', '/projects');
    expect(projects.json().items).toHaveLength(0);
  });

  it('refuses the download to an exporter who is no longer an editor', async () => {
    const started = await call(
      source.app,
      people.editor ?? null,
      'POST',
      `/projects/${projectId}/exports`,
    );
    await source.deps.jobs.idle();
    const id = started.json().id;
    await call(
      source.app,
      people.owner ?? null,
      'PUT',
      `/projects/${projectId}/members/${people.editor?.id}`,
      {
        role: 'viewer',
      },
    );
    expect(
      (await call(source.app, people.editor ?? null, 'GET', `/transfers/${id}/download`))
        .statusCode,
    ).toBe(403);
    await call(
      source.app,
      people.owner ?? null,
      'PUT',
      `/projects/${projectId}/members/${people.editor?.id}`,
      {
        role: 'editor',
      },
    );
  });
});
