import { fileURLToPath } from 'node:url';
import { addElement, createBoardDoc, newElementId, roots } from '@inkadra/doc-schema';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, boardDoc, boardElementIndex, boardGrant, user } from '../db/schema.ts';
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
    expect(entries).toHaveLength(6);
    const frame = entries.find((e) => e.type === 'frame')!;
    expect(frame.title).toBe('4C');
    expect(frame.text).toContain('85mm');
    expect(frame.tags).toEqual(['notte', 'neon']);
    expect(frame.data).toMatchObject({ label: '4C', status: 'retake' });
    expect(entries.find((e) => e.type === 'note')!.text).toBe(
      'Sopralluogo alla stazione binario 21',
    );
  });

  it('indexes the title, icon labels, makes, notes, positions, wall labels and texts of a set plan', () => {
    const doc = createBoardDoc('board');
    const plan = {
      ...base(),
      type: 'plan' as const,
      title: 'Cucina',
      icons: [
        {
          id: newElementId(),
          kind: 'camera' as const,
          color: '#9DB8F2',
          x: 9,
          y: 9,
          label: 'A cam',
          make: 'Arri Alexa',
        },
        {
          id: newElementId(),
          kind: 'actor' as const,
          color: '#7AD689',
          x: 20,
          y: 20,
          steps: [{ x: 9, y: 9, note: 'entra dalla porta' }],
          stepNote: 'siede al bancone',
          note: 'cappotto addosso',
        },
      ],
      walls: [{ id: newElementId(), points: [0, 0, 99, 0], thickness: 9, label: 'muro nord' }],
      openings: [],
      shapes: [
        {
          id: newElementId(),
          kind: 'text' as const,
          color: '#1C1C1E',
          width: 24,
          x0: 9,
          y0: 9,
          x1: 9,
          y1: 9,
          text: 'finestra',
        },
      ],
    };
    addElement(doc, plan);
    expect(entriesFor(doc)).toEqual([
      expect.objectContaining({
        type: 'plan',
        title: 'Cucina',
        // The notes of the positions too, the last one's in stepNote (decision 0119).
        text: 'Cucina A cam Arri Alexa cappotto addosso siede al bancone entra dalla porta finestra muro nord',
      }),
    ]);
  });

  it('indexes the live names of the characters and the location a set plan links to', () => {
    const doc = createBoardDoc('board');
    const anna = { ...base(), type: 'character' as const, name: 'Anna' };
    const diner = { ...base(), type: 'location' as const, name: 'Rosa diner' };
    const plan = {
      ...base(),
      type: 'plan' as const,
      title: 'Bancone',
      locationId: diner.id,
      icons: [
        {
          id: newElementId(),
          kind: 'actor' as const,
          color: '#9DB8F2',
          x: 9,
          y: 9,
          label: 'old name',
          characterId: anna.id,
        },
      ],
    };
    for (const el of [anna, diner, plan]) addElement(doc, el);
    expect(entriesFor(doc).find((e) => e.type === 'plan')).toEqual(
      expect.objectContaining({ title: 'Bancone', text: 'Bancone Rosa diner Anna' }),
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

  it('writes only the index rows that changed (#797)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { parentBoardId: boardId, kind: 'storyboard', title: 'Diff' },
    });
    const id = created.json().id as string;
    const doc = storyboard(id);
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: id, state, schemaVersion: 2, size: state.byteLength });
    await db.transaction((tx) => writeBoardIndex(tx, id, doc));
    const old = new Date('2020-01-01T00:00:00Z');
    await db
      .update(boardElementIndex)
      .set({ updatedAt: old })
      .where(eq(boardElementIndex.boardId, id));
    const rows = () =>
      db
        .select({
          elementId: boardElementIndex.elementId,
          text: boardElementIndex.text,
          updatedAt: boardElementIndex.updatedAt,
        })
        .from(boardElementIndex)
        .where(eq(boardElementIndex.boardId, id));
    const before = await rows();
    // Nothing changed: no row is written, frames with jsonb data included.
    await db.transaction((tx) => writeBoardIndex(tx, id, doc));
    expect((await rows()).every((r) => r.updatedAt.getTime() === old.getTime())).toBe(true);
    // One card renamed, one removed, one added: only those rows move.
    const elements = roots(doc).elements;
    const marta = [...elements.values()].find((m) => m.get('name') === 'Marta')!;
    marta.set('name', 'Martina');
    const color = [...elements.values()].find((m) => m.get('type') === 'color')!;
    elements.delete(String(color.get('id')));
    const added = addElement(doc, { ...base(), type: 'character', name: 'Leo' });
    await db.transaction((tx) => writeBoardIndex(tx, id, doc));
    const after = await rows();
    const moved = after.filter((r) => r.updatedAt.getTime() !== old.getTime());
    expect(moved.map((r) => r.elementId).sort()).toEqual(
      [String(marta.get('id')), String(added.get('id'))].sort(),
    );
    expect(after.map((r) => r.elementId)).not.toContain(String(color.get('id')));
    expect(after).toHaveLength(before.length);
    expect(after.find((r) => r.elementId === marta.get('id'))?.text).toContain('Martina');
    // Out of the way of the searches below.
    await db.delete(board).where(eq(board.id, id));
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

  it('counts where the cast appears, on the boards the caller can read', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { parentBoardId: boardId, kind: 'storyboard', title: 'Cast' },
    });
    const other = created.json().id as string;
    const doc = createBoardDoc(other);
    const scene = { ...base(), type: 'scene' as const, number: '7B', title: 'Il deposito' };
    addElement(doc, scene);
    addElement(doc, { ...base(scene.id), type: 'frame', cast: [' MARTA ', 'marta', 'Leo'] });
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: other, state, schemaVersion: 2, size: state.byteLength });
    await db.transaction((tx) => writeBoardIndex(tx, other, doc));
    const path = `/api/v1/projects/${projectId}/cast-appearances`;
    const res = await get('owner', `${path}?excludeBoardId=${boardId}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        { name: 'marta', frames: 1, scenes: ['7B'] },
        { name: 'leo', frames: 1, scenes: ['7B'] },
      ]),
    );
    expect((await get('stranger', path)).body.items).toEqual([]);
    expect((await get('owner', `${path}?excludeBoardId=nope`)).status).toBe(400);

    // A viewer of one board: its sub-boards yes, the boards the grant does not open no.
    const root = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
    });
    const addBoard = async (title: string, cast: string[]) => {
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/boards`,
        headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
        payload: { parentBoardId: root.json().rootBoardId, kind: 'storyboard', title },
      });
      const id = added.json().id as string;
      const closed = createBoardDoc(id);
      addElement(closed, { ...base(), type: 'frame', cast });
      const update = Y.encodeStateAsUpdate(closed);
      await db
        .insert(boardDoc)
        .values({ boardId: id, state: update, schemaVersion: 2, size: update.byteLength });
      await db.transaction((tx) => writeBoardIndex(tx, id, closed));
      return id;
    };
    const closedBoard = await addBoard('Chiusa', ['Segreta']);
    const names = async (who: keyof typeof cookies) =>
      (await get(who, path)).body.items.map((i: { name: string }) => i.name);
    expect(await names('owner')).toContain('segreta');
    expect(await names('guest')).toContain('marta');
    expect(await names('guest')).not.toContain('segreta');
    // A board in the trash no longer counts.
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, closedBoard));
    expect(await names('owner')).not.toContain('segreta');

    // A document nobody can read costs only itself.
    const broken = await addBoard('Rotta', ['Rotta']);
    await db
      .update(boardDoc)
      .set({ state: new Uint8Array([255, 1, 2, 3]) })
      .where(eq(boardDoc.boardId, broken));
    const survived = await get('owner', path);
    expect(survived.status).toBe(200);
    expect(survived.body.items.map((i: { name: string }) => i.name)).toContain('marta');
    await db.delete(board).where(eq(board.id, broken));
  });

  it('derives the project kit from the plans of the boards the caller can read', async () => {
    const root = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
    });
    const light = (id: string, make: string) => ({
      id,
      kind: 'cob' as const,
      color: '#EDD963',
      x: 100,
      y: 100,
      make,
      watts: 600,
    });
    const addPlanBoard = async (parentBoardId: string, title: string, make: string) => {
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/boards`,
        headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
        payload: { parentBoardId, title },
      });
      const id = added.json().id as string;
      const doc = createBoardDoc(id);
      const key = light(newElementId(), make);
      addElement(doc, {
        ...base(),
        type: 'plan',
        icons: [
          key,
          { id: newElementId(), kind: 'grid', color: '#EDD963', x: 100, y: 100, on: key.id },
          {
            id: newElementId(),
            kind: 'camera',
            color: '#7DA7F0',
            x: 300,
            y: 300,
            label: 'A cam',
            lens: 35,
          },
          // Not configured: no make, power or modifiers, so not in the kit.
          { id: newElementId(), kind: 'fresnel', color: '#EDD963', x: 500, y: 100 },
        ],
      });
      const update = Y.encodeStateAsUpdate(doc);
      await db
        .insert(boardDoc)
        .values({ boardId: id, state: update, schemaVersion: 24, size: update.byteLength });
      await db.transaction((tx) => writeBoardIndex(tx, id, doc));
      return id;
    };
    // One under the board the guest was given, one the grant does not open.
    const shared = await addPlanBoard(boardId, 'Set aperto', 'Aputure 600d');
    const closed = await addPlanBoard(root.json().rootBoardId, 'Set chiuso', 'Segreta 1200');
    const path = `/api/v1/projects/${projectId}/plan-kit`;
    const makes = async (who: keyof typeof cookies, query = '') => {
      const res = await get(who, `${path}${query}`);
      expect(res.status).toBe(200);
      return res.body.items.map(
        (i: { icon: { make?: string; label?: string } }) => i.icon.make ?? i.icon.label,
      );
    };
    const owner = await get('owner', path);
    expect(owner.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          icon: expect.objectContaining({ kind: 'cob', make: 'Aputure 600d', watts: 600 }),
          modifiers: ['grid'],
          lenses: [],
        }),
        expect.objectContaining({
          icon: expect.objectContaining({ kind: 'camera', label: 'A cam' }),
          lenses: [35],
        }),
      ]),
    );
    // The same camera on two boards is listed once.
    expect((await makes('owner')).sort()).toEqual(['A cam', 'Aputure 600d', 'Segreta 1200']);
    expect(await makes('owner', `?excludeBoardId=${closed}`)).not.toContain('Segreta 1200');
    expect(await makes('guest')).toContain('Aputure 600d');
    expect(await makes('guest')).not.toContain('Segreta 1200');
    expect(await makes('stranger')).toEqual([]);
    expect((await get('owner', `${path}?excludeBoardId=nope`)).status).toBe(400);
    for (const id of [shared, closed]) await db.delete(board).where(eq(board.id, id));
  });

  it('limits how often one person reads the project kit', async () => {
    // Each answer decodes board documents: a script must not keep the server busy for everyone.
    const path = `/api/v1/projects/${projectId}/plan-kit`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++)
      statuses.push(
        (await get('stranger', i % 2 ? path : path.replace('plan-kit', 'cast-appearances'))).status,
      );
    // 20 shared reads a minute; the stranger read cast appearances and the kit above.
    const first = statuses.indexOf(429);
    expect(first).toBe(18);
    expect(statuses.slice(0, first).every((s) => s === 200)).toBe(true);
    // Another person is not held back by it.
    expect((await get('guest', path)).status).toBe(200);
  });

  it('lists the named cards of one type only to people who can read them', async () => {
    const path = `/api/v1/search?type=character&projectId=${projectId}`;
    const names = async (who: keyof typeof cookies) => {
      const res = await get(who, path);
      expect(res.status).toBe(200);
      return res.body.items.map((h: { title: string; boardId: string }) => [h.title, h.boardId]);
    };
    // Named characters only: the blank one is left out.
    const owner = await names('owner');
    expect(owner).toContainEqual(['Marta', boardId]);
    expect(owner.every(([title]: string[]) => title === 'Marta')).toBe(true);
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
    await db.update(boardGrant).set({ expiresAt: null }).where(eq(boardGrant.userId, guest!.id));
    expect((await get('owner', '/api/v1/search?type=character')).status).toBe(400);
    // Words and a story card type: still only named cards, never the board's title.
    const typed = await get('owner', `/api/v1/search?q=binar&type=character`);
    expect(typed.body.items).toEqual([]);
    const byRole = await get(
      'owner',
      `/api/v1/search?q=capotreno&type=character&projectId=${projectId}`,
    );
    expect(byRole.body.items.length).toBeGreaterThan(0);
    for (const hit of byRole.body.items) expect(hit.title).toBe('Marta');
  });

  it('indexes boards stored before the index existed', async () => {
    await db.delete(boardElementIndex).where(eq(boardElementIndex.boardId, boardId));
    await db.update(boardDoc).set({ indexedAt: null }).where(eq(boardDoc.boardId, boardId));
    expect(await backfillIndex(db)).toMatchObject({ indexed: 1, failed: [] });
    expect(await backfillIndex(db)).toMatchObject({ indexed: 0, failed: [] });
    expect((await get('owner', '/api/v1/search?q=85mm')).body.items).toHaveLength(1);
    // The navigation counts are stored with the index, so the route need not decode the document.
    const [stored] = await db
      .select({ counts: boardDoc.counts })
      .from(boardDoc)
      .where(eq(boardDoc.boardId, boardId));
    expect(stored?.counts?.elementCount).toBeGreaterThan(0);
    const counted = await get('owner', `/api/v1/projects/${projectId}/board-counts`);
    expect(
      counted.body.items.find((i: { boardId: string }) => i.boardId === boardId),
    ).toMatchObject(stored!.counts!);
  });

  it('lets a store and the backfill of the same board take turns, the newer state last', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { parentBoardId: boardId, kind: 'storyboard', title: 'Turni' },
    });
    const id = created.json().id as string;
    const doc = storyboard(id);
    const v1 = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: id, state: v1, schemaVersion: 2, size: v1.byteLength });
    const marta = [...roots(doc).elements.values()].find((m) => m.get('name') === 'Marta')!;
    marta.set('name', 'Martina');
    const v2 = Y.encodeStateAsUpdate(doc);
    // A store writes the newer state and its index, and has not committed yet...
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let indexing = () => {};
    const indexed = new Promise<void>((resolve) => {
      indexing = resolve;
    });
    const store = db.transaction(async (tx) => {
      await tx
        .update(boardDoc)
        .set({ state: v2, size: v2.byteLength, updatedAt: new Date() })
        .where(eq(boardDoc.boardId, id));
      await writeBoardIndex(tx, id, doc);
      indexing();
      await gate;
    });
    await indexed;
    // ...while the backfill read the older state, still listed as never indexed.
    const backfill = backfillIndex(db);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await store;
    await backfill;
    const titles = await db
      .select({ title: boardElementIndex.title })
      .from(boardElementIndex)
      .where(
        and(
          eq(boardElementIndex.boardId, id),
          eq(boardElementIndex.elementId, String(marta.get('id'))),
        ),
      );
    expect(titles).toEqual([{ title: 'Martina' }]);
    await db.delete(board).where(eq(board.id, id));
  });

  it('goes past a board it cannot index instead of stopping at it (#815)', async () => {
    const root = await get('owner', `/api/v1/projects/${projectId}`);
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
      payload: { parentBoardId: root.body.rootBoardId, kind: 'storyboard', title: 'Rotta' },
    });
    const broken = added.json().id as string;
    // An empty update cannot be decoded.
    await db
      .insert(boardDoc)
      .values({ boardId: broken, state: new Uint8Array(), schemaVersion: 2, size: 0 });
    await db.delete(boardElementIndex).where(eq(boardElementIndex.boardId, boardId));
    await db.update(boardDoc).set({ indexedAt: null }).where(eq(boardDoc.boardId, boardId));
    // One board per call, as the hourly run goes through them in order, whichever comes first.
    const failed: string[] = [];
    let indexed = 0;
    let after: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const batch = await backfillIndex(db, 1, after);
      indexed += batch.indexed;
      failed.push(...batch.failed.map((f) => f.boardId));
      if (!batch.last) break;
      after = batch.last;
    }
    expect({ indexed, failed }).toEqual({ indexed: 1, failed: [broken] });
    expect((await get('owner', '/api/v1/search?q=85mm')).body.items).toHaveLength(1);
    await db.delete(boardDoc).where(eq(boardDoc.boardId, broken));
  });

  it('finds the crew for project members and the location of shooting days', async () => {
    const post = (path: string, payload: object) =>
      app.inject({
        method: 'POST',
        url: `/api/v1${path}`,
        headers: { cookie: cookies.owner, origin: config.PUBLIC_URL },
        payload,
      });
    const person = await post(`/projects/${projectId}/crew`, {
      name: 'Paolo Riva',
      role: 'Fonico',
      department: 'Suono',
      phone: '',
      email: '',
      pickup: '',
      notes: '',
      userId: null,
      character: null,
      onSetContact: false,
      position: 0,
    });
    expect(person.statusCode).toBe(201);
    const day = await post(`/boards/${boardId}/schedule`, {
      date: '2026-11-21',
      callTime: '08:00',
      wrap: null,
      location: 'https://maps.example.com/x\nFaro di Punta Palascìa',
      notes: '',
      blocks: [],
    });
    expect(day.statusCode).toBe(201);
    // Both open a view of the Production board (decision 0123): nothing while there is none.
    expect((await get('owner', '/api/v1/search?q=fonico')).body.items).toEqual([]);
    expect((await get('owner', '/api/v1/search?q=palasc')).body.items).toEqual([]);
    const { rootBoardId } = (await get('owner', `/api/v1/projects/${projectId}`)).body;
    const production = await post(`/projects/${projectId}/boards`, {
      parentBoardId: rootBoardId,
      kind: 'production',
      title: 'Produzione',
    });
    expect(production.statusCode).toBe(201);
    const productionId = production.json().id;
    expect((await get('owner', '/api/v1/search?q=fonico')).body.items).toContainEqual(
      expect.objectContaining({
        elementType: 'crew',
        boardId: productionId,
        title: 'Paolo Riva',
        snippet: 'Fonico · Suono',
      }),
    );
    expect((await get('owner', '/api/v1/search?q=palasc')).body.items).toContainEqual(
      expect.objectContaining({
        elementType: 'shootingDay',
        boardId: productionId,
        title: 'Faro di Punta Palascìa',
        snippet: '2026-11-21',
      }),
    );
    // A grant on the storyboard finds neither the days nor the project's roster (answer 1).
    expect((await get('guest', '/api/v1/search?q=fonico')).body.items).toEqual([]);
    expect((await get('guest', '/api/v1/search?q=palasc')).body.items).toEqual([]);
    expect((await get('stranger', '/api/v1/search?q=palasc')).body.items).toEqual([]);
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
