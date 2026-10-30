import { fileURLToPath } from 'node:url';
import { addElement, createBoardDoc, newElementId, roots } from '@inkadra/doc-schema';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc, boardElementIndex, boardGrant, user } from '../db/schema.ts';
import { createApp } from '../http/app.ts';
import {
  containsPattern,
  prefixPattern,
  searchTagPatterns,
  snippet,
} from '../http/search-routes.ts';
import { testDeps } from '../test-deps.ts';
import {
  autoFrameLabels,
  backfillIndex,
  entriesFor,
  fragmentText,
  writeBoardIndex,
} from './index-doc.ts';

const base = (parent: string | null = null) => ({
  id: newElementId(),
  x: 0,
  y: 0,
  w: 240,
  z: 'a0',
  parent,
  createdBy: null,
  createdAt: 0,
});

function storyboard(boardId: string) {
  const doc = createBoardDoc(boardId);
  const scene = { ...base(), type: 'scene' as const, number: '4', title: 'Il binario' };
  addElement(doc, scene);
  addElement(doc, {
    ...base(scene.id),
    type: 'frame',
    label: '4C',
    action: 'Il neon gli taglia il viso.',
    shot: 'cu',
    lens: '85mm',
    status: 'retake',
    tags: ['Notte', 'notte', 'Neon'],
  });
  addElement(doc, {
    ...base(),
    type: 'color',
    hex: '#C9A36A',
    label: 'Sodio 100%_',
    tags: ['Notte'],
  });
  addElement(doc, { ...base(), type: 'character', name: 'Marta', role: 'Capotreno' });
  // A blank card of the Casting template: listed by nobody until it has a name.
  addElement(doc, { ...base(), type: 'character', name: '' });
  const note = addElement(doc, { ...base(), type: 'note' });
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('Sopralluogo alla stazione')]);
  const q = new Y.XmlElement('paragraph');
  q.insert(0, [new Y.XmlText('binario 21')]);
  (note.get('body') as Y.XmlFragment).insert(0, [p, q]);
  return doc;
}

describe('index entries', () => {
  it('reads the text of every element type it knows', () => {
    const doc = storyboard('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
    roots(doc).elements.set('future_el_0001', new Y.Map(Object.entries({ type: 'hologram' })));
    const entries = entriesFor(doc);
    expect(entries).toHaveLength(4);
    const frame = entries.find((e) => e.type === 'frame')!;
    expect(frame.title).toBe('4C');
    expect(frame.text).toContain('85mm');
    expect(frame.tags).toEqual(['notte', 'neon']);
    expect(frame.data).toMatchObject({ label: '4C', status: 'retake' });
    expect(entries.find((e) => e.type === 'note')!.text).toBe(
      'Sopralluogo alla stazione binario 21',
    );
  });

  it('indexes file captions and accepts files without a caption', () => {
    const doc = createBoardDoc('board');
    const file = {
      ...base(),
      type: 'file' as const,
      assetId: 'asset-id',
      caption: 'Observatory schedule',
    };
    addElement(doc, file);
    const old = { ...base(), type: 'file' as const, assetId: 'old-asset' };
    addElement(doc, old);
    expect(entriesFor(doc)).toEqual([
      expect.objectContaining({ elementId: file.id, text: file.caption }),
      expect.objectContaining({ elementId: old.id, title: '', text: '' }),
    ]);
  });

  it('indexes everything the team sees on character and location cards', () => {
    const doc = createBoardDoc('board');
    const marta = {
      ...base(),
      type: 'character' as const,
      name: 'Marta',
      role: 'Capotreno',
      actor: 'Giulia Neri',
      contact: 'agenzia@example.com',
      scenes: ['3A'],
    };
    const station = {
      ...base(),
      type: 'location' as const,
      name: 'Stazione Centrale',
      setting: 'ext' as const,
      address: 'Piazza Duca d’Aosta',
      light: 'Crepuscolo',
    };
    addElement(doc, marta);
    addElement(doc, station);
    const [m, s] = entriesFor(doc);
    expect(m).toMatchObject({ type: 'character', title: 'Marta', data: { role: 'Capotreno' } });
    for (const word of ['Capotreno', 'Giulia Neri', 'agenzia@example.com', '3A'])
      expect(m?.text).toContain(word);
    expect(s).toMatchObject({
      type: 'location',
      title: 'Stazione Centrale',
      data: { setting: 'ext' },
    });
    expect(s?.text).toContain('Piazza Duca');
  });

  it('gives frames without a label the shot number the storyboard shows', () => {
    const scene = { ...base(), type: 'scene' as const, number: '12', title: '' };
    const frame = (z: string, label?: string) => ({
      ...base(scene.id),
      z,
      type: 'frame' as const,
      ...(label ? { label } : {}),
    });
    const a = frame('a0');
    const b = frame('a1', 'X');
    const c = frame('a2');
    const loose = { ...frame('a3'), parent: null };
    const labels = autoFrameLabels([c, scene, b, a, loose]);
    expect(labels.get(a.id)).toBe('12A');
    expect(labels.get(c.id)).toBe('12C');
    expect(labels.has(loose.id)).toBe(false);
  });

  it('extracts plain text from rich text', () => {
    const f = new Y.Doc().getXmlFragment('x');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'bold', { bold: true });
    t.insert(4, ' and plain');
    p.insert(0, [t]);
    f.insert(0, [p]);
    expect(fragmentText(f)).toBe('bold and plain');
  });

  it('takes % and _ literally and cuts snippets around the match', () => {
    expect(containsPattern('100%_')).toBe('%100\\%\\_%');
    expect(prefixPattern('100%_')).toBe('100\\%\\_%');
    const long = `${'a '.repeat(100)}binario${' b'.repeat(100)}`;
    expect(snippet(long, 'BINARIO')).toContain('binario');
    expect(snippet('', 'x')).toBeNull();
  });

  it('builds tag matching words and prefix patterns from a query', () => {
    expect(searchTagPatterns('#esterno')).toEqual({
      words: ['esterno'],
      prefixes: ['esterno%'],
    });
    expect(searchTagPatterns('notte 100%_')).toEqual({
      words: ['notte 100%_', 'notte', '100%_'],
      prefixes: ['notte 100\\%\\_%', 'notte%', '100\\%\\_%'],
    });
  });
});

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('search (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const cookies: Record<'owner' | 'stranger' | 'guest', string> = {
    owner: '',
    stranger: '',
    guest: '',
  };
  let projectId = '';
  let boardId = '';

  const get = async (who: keyof typeof cookies, path: string) => {
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { cookie: cookies[who], origin: config.PUBLIC_URL },
    });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const who of Object.keys(cookies) as Array<keyof typeof cookies>) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${who}@example.com`, password: 'correct-horse-battery', name: who },
      });
      cookies[who] = String(res.headers['set-cookie']).split(';')[0] ?? '';
    }
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { name: 'Ultima corsa' },
    });
    projectId = project.json().id;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { parentBoardId: project.json().rootBoardId, kind: 'storyboard', title: 'Binario' },
    });
    boardId = created.json().id;
    const doc = storyboard(boardId);
    const state = Y.encodeStateAsUpdate(doc);
    await db.insert(boardDoc).values({ boardId, state, schemaVersion: 2, size: state.byteLength });
    await db.transaction((tx) => writeBoardIndex(tx, boardId, doc));
    await db.transaction((tx) => writeBoardIndex(tx, boardId, doc)); // idempotent
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('finds cards, boards and projects by part of a word', async () => {
    const res = await get('owner', '/api/v1/search?q=binar');
    expect(res.status).toBe(200);
    const kinds = res.body.items.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain('board');
    expect(kinds).toContain('element');
    const note = res.body.items.find((h: { elementType: string }) => h.elementType === 'note');
    expect(note).toMatchObject({ boardId, boardKind: 'storyboard', projectName: 'Ultima corsa' });
    expect((await get('owner', '/api/v1/search?q=ULTIMA')).body.items[0].kind).toBe('project');
    expect((await get('owner', '/api/v1/search?q=85mm')).body.items).toHaveLength(1);
  });

  it('finds cards by tag name or tag prefix in free-text search (without tag filter)', async () => {
    // Both frame and color cards have tag 'notte', but color card has 'notte' only in tags, not in text.
    const exact = await get('owner', '/api/v1/search?q=notte');
    expect(exact.status).toBe(200);
    const elementTypes = exact.body.items
      .filter((h: { kind: string }) => h.kind === 'element')
      .map((h: { elementType: string }) => h.elementType)
      .sort();
    expect(elementTypes).toEqual(['color', 'frame']);

    // Prefix search: 'not' is a prefix of tag 'notte'
    const prefix = await get('owner', '/api/v1/search?q=not');
    expect(prefix.status).toBe(200);
    const prefixTypes = prefix.body.items
      .filter((h: { kind: string }) => h.kind === 'element')
      .map((h: { elementType: string }) => h.elementType)
      .sort();
    expect(prefixTypes).toEqual(['color', 'frame']);
  });

  it('filters by tag and type, and treats % literally', async () => {
    const byTag = await get('owner', '/api/v1/search?tag=NOTTE');
    expect(byTag.body.items.map((h: { elementType: string }) => h.elementType).sort()).toEqual([
      'color',
      'frame',
    ]);
    const frames = await get('owner', '/api/v1/search?tag=notte&type=frame');
    expect(frames.body.items).toHaveLength(1);
    expect((await get('owner', '/api/v1/search?q=%25')).body.items).toHaveLength(1);
    expect((await get('owner', '/api/v1/search')).status).toBe(400);
  });

  it('counts the tags of a project', async () => {
    const res = await get('owner', `/api/v1/projects/${projectId}/tags`);
    expect(res.body.items).toEqual([
      { tag: 'notte', count: 2 },
      { tag: 'neon', count: 1 },
    ]);
    expect((await get('stranger', `/api/v1/projects/${projectId}/tags`)).status).toBe(404);
  });

  it('shows nothing of projects the caller is not in', async () => {
    expect((await get('stranger', '/api/v1/search?q=binar')).body.items).toEqual([]);
    expect((await get('stranger', '/api/v1/search?tag=notte')).body.items).toEqual([]);
    expect((await get('stranger', '/api/v1/search?q=not')).body.items).toEqual([]);
  });

  it('shows a guest only the boards they were given', async () => {
    // A second board of the project the guest has no grant on.
    const other = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: {
        parentBoardId: (await get('owner', `/api/v1/boards/${boardId}`)).body.parentBoardId,
        title: 'Altro binario',
      },
    });
    const otherId = other.json().id as string;
    const doc = storyboard(otherId);
    await db.transaction((tx) => writeBoardIndex(tx, otherId, doc));
    const [guest] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'guest@example.com'));
    await db.insert(boardGrant).values({ boardId, userId: guest!.id, role: 'viewer' });

    const res = await get('guest', '/api/v1/search?q=binar');
    const boards = new Set(res.body.items.map((h: { boardId: string | null }) => h.boardId));
    expect(boards).toEqual(new Set([boardId]));
    expect(res.body.items.some((h: { kind: string }) => h.kind === 'project')).toBe(false);
    expect((await get('owner', '/api/v1/search?q=85mm')).body.items).toHaveLength(2);
    expect((await get('guest', '/api/v1/search?q=85mm')).body.items).toHaveLength(1);
    for (const q of ['notte', 'not']) {
      const tagged = await get('guest', `/api/v1/search?q=${q}`);
      expect(tagged.body.items).toHaveLength(2);
      expect(tagged.body.items.every((h: { boardId: string }) => h.boardId === boardId)).toBe(true);
    }
    expect((await get('guest', `/api/v1/projects/${projectId}/tags`)).body.items).toEqual([
      { tag: 'notte', count: 2 },
      { tag: 'neon', count: 1 },
    ]);
    await db.delete(boardElementIndex).where(eq(boardElementIndex.boardId, otherId));
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/boards/${otherId}`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
    });
  });

  it('lists the named cards of one type only to people who can read them', async () => {
    const path = `/api/v1/search?type=character&projectId=${projectId}`;
    const names = async (who: keyof typeof cookies) => {
      const res = await get(who, path);
      expect(res.status).toBe(200);
      return res.body.items.map((h: { title: string; boardId: string }) => [h.title, h.boardId]);
    };
    // Both boards of the project (the second one comes from the guest test).
    expect((await names('owner')).map(([title]: string[]) => title)).toEqual(['Marta', 'Marta']);
    expect(await names('stranger')).toEqual([]);
    // A viewer grant on one board: only that board's characters.
    expect(await names('guest')).toEqual([['Marta', boardId]]);
    const [guest] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'guest@example.com'));
    await db
      .update(boardGrant)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(boardGrant.userId, guest!.id));
    expect(await names('guest')).toEqual([]);
    await db
      .update(boardGrant)
      .set({ expiresAt: null })
      .where(eq(boardGrant.userId, guest!.id));
    expect((await get('owner', '/api/v1/search?type=character')).status).toBe(400);
    // Words and a story card type: still only named cards, never the board's title.
    const typed = await get('owner', `/api/v1/search?q=binar&type=character`);
    expect(typed.body.items).toEqual([]);
    const byRole = await get('owner', `/api/v1/search?q=capotreno&type=character&projectId=${projectId}`);
    expect(byRole.body.items.map((h: { title: string }) => h.title)).toEqual(['Marta', 'Marta']);
  });

  it('indexes boards stored before the index existed', async () => {
    await db.delete(boardElementIndex).where(eq(boardElementIndex.boardId, boardId));
    await db.update(boardDoc).set({ indexedAt: null }).where(eq(boardDoc.boardId, boardId));
    expect(await backfillIndex(db)).toEqual({ indexed: 1 });
    expect(await backfillIndex(db)).toEqual({ indexed: 0 });
    expect((await get('owner', '/api/v1/search?q=85mm')).body.items).toHaveLength(1);
  });

  it('hides boards in the trash', async () => {
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/boards/${boardId}`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
    });
    expect((await get('owner', '/api/v1/search?q=binar')).body.items).toEqual([]);
    expect((await get('owner', `/api/v1/projects/${projectId}/tags`)).body.items).toEqual([]);
  });
});
