// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_V1 } from './board-v1.fixture.ts';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  contentCounts,
  createBoardDoc,
  Element,
  FrameElement,
  type FrameShape,
  getAnimaticAudio,
  getBoardAspect,
  getRestoreCount,
  getSchemaVersion,
  hasStoredShape,
  MAX_PLAN_CIRCUITS,
  MAX_PLAN_ICONS,
  MAX_PLAN_WALLS,
  MAX_WALL_POINTS,
  MIN_WRITER_SCHEMA,
  migrateBoardDoc,
  newElementId,
  parseBoardDocName,
  readElement,
  roots,
  SchemaTooNewError,
  STROKE_GRID,
  setAnimaticAudio,
  setBoardAspect,
  UNSORTED,
  validateBoardDoc,
  WRITER_SCHEMAS,
} from './index.ts';
import { checkCard } from './strict.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const base = () => ({
  id: newElementId(),
  x: 0,
  y: 0,
  w: 240,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
});

describe('board document', () => {
  it('names documents after boards', () => {
    expect(parseBoardDocName(boardDocName(boardId))).toBe(boardId);
    expect(parseBoardDocName('project:x')).toBeNull();
  });

  it('reads the restore count, 0 when absent or not a count (decision 0109)', () => {
    const doc = createBoardDoc(boardId);
    expect(getRestoreCount(doc)).toBe(0);
    for (const [value, count] of [
      [2, 2],
      [-1, 0],
      [1.5, 0],
      ['3', 0],
    ] as const) {
      roots(doc).meta.set('restores', value);
      expect(getRestoreCount(doc)).toBe(count);
    }
  });

  it('starts at the current version', () => {
    expect(getSchemaVersion(createBoardDoc(boardId))).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('initialises an empty document through migration', () => {
    const doc = new Y.Doc();
    expect(migrateBoardDoc(doc, boardId)).toEqual([CURRENT_SCHEMA_VERSION]);
    expect(roots(doc).meta.get('boardId')).toBe(boardId);
  });

  it('refuses documents from a newer build', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
    expect(() => migrateBoardDoc(doc, boardId)).toThrow(SchemaTooNewError);
  });

  it('stores elements and reads them back', () => {
    const doc = createBoardDoc(boardId);
    const todo = {
      ...base(),
      type: 'todo' as const,
      parent: UNSORTED,
      items: [{ id: newElementId(), text: 'Sopralluogo', done: false }],
    };
    addElement(doc, todo);
    const note = addElement(doc, { ...base(), type: 'note' });
    expect(note.get('body')).toBeInstanceOf(Y.XmlFragment);
    expect(readElement(roots(doc).elements.get(todo.id)!)).toEqual(todo);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('validates optional file captions with the same limits as images', () => {
    for (const type of ['file', 'image'] as const) {
      const element = { ...base(), type, assetId: 'asset-id' };
      expect(Element.parse(element)).not.toHaveProperty('caption');
      for (const caption of ['', 'x'.repeat(2000)]) {
        expect(Element.parse({ ...element, caption })).toHaveProperty('caption', caption);
      }
      for (const caption of ['x'.repeat(2001), null, 42]) {
        expect(Element.safeParse({ ...element, caption }).success).toBe(false);
      }
    }
  });

  it('keeps a file caption through a document round trip', () => {
    const doc = createBoardDoc(boardId);
    const file = { ...base(), type: 'file' as const, assetId: 'asset-id', caption: 'Call sheet' };
    addElement(doc, file);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readElement(roots(copy).elements.get(file.id)!)).toEqual(file);
    expect(validateBoardDoc(copy)).toEqual([]);
  });

  it('upgrades a version 3 document without adding captions or changing elements', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 3);
    const file = { ...base(), type: 'file' as const, assetId: 'asset-id' };
    addElement(doc, file);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(file.id)!)).not.toHaveProperty('caption');
    expect(validateBoardDoc(doc)).toEqual([]);
    expect(migrateBoardDoc(doc, boardId)).toEqual([]);
  });

  it('syncs between two replicas', () => {
    const a = createBoardDoc(boardId);
    const b = new Y.Doc();
    const el = { ...base(), type: 'color' as const, hex: '#3B7CF6' };
    addElement(a, el);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readElement(roots(b).elements.get(el.id)!)).toEqual(el);
  });

  it('reports invalid elements and unknown roots', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).elements.set('broken-id', new Y.Map([['type', 'note']]));
    doc.getArray('stray');
    expect(validateBoardDoc(doc)).toHaveLength(2);
  });

  it('accepts only web addresses on link cards', () => {
    const link = (url: string) => Element.safeParse({ ...base(), type: 'link', url }).success;
    expect(link('https://example.com/ref')).toBe(true);
    expect(link('http://example.com')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('keeps tags on any element', () => {
    const doc = createBoardDoc(boardId);
    const color = { ...base(), type: 'color' as const, hex: '#C9A36A', tags: ['Notte', 'Sodio'] };
    addElement(doc, color);
    expect(readElement(roots(doc).elements.get(color.id)!)).toEqual(color);
    const tooMany = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(Element.safeParse({ ...color, tags: tooMany }).success).toBe(false);
  });

  it('keeps the guest visibility of any element', () => {
    const doc = createBoardDoc(boardId);
    const column = { ...base(), type: 'column' as const, title: 'Interno', guestHidden: true };
    const note = { ...base(), type: 'note' as const, parent: column.id };
    addElement(doc, column);
    addElement(doc, note);
    expect(readElement(roots(doc).elements.get(column.id)!)).toEqual(column);
    expect(validateBoardDoc(doc)).toEqual([]);
    expect(Element.safeParse({ ...note, guestHidden: 'yes' }).success).toBe(false);
  });

  it('upgrades a version 2 document to the current version without touching its elements', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 2);
    const note = { ...base(), type: 'note' as const, tags: ['Notte'] };
    const column = { ...base(), type: 'column' as const, title: 'Scelte' };
    addElement(doc, note);
    addElement(doc, column);
    const before = [...roots(doc).elements.values()].map((m) => readElement(m));
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect([...roots(doc).elements.values()].map((m) => readElement(m))).toEqual(before);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('stores scenes with frames and their pen strokes', () => {
    const doc = createBoardDoc(boardId);
    const scene = {
      ...base(),
      type: 'scene' as const,
      number: '4',
      title: 'Il binario',
      setting: 'ext' as const,
      time: 'night' as const,
    };
    const frame = {
      ...base(),
      type: 'frame' as const,
      parent: scene.id,
      shot: 'cu',
      lens: '85mm',
      movement: 'static',
      durationMs: 4000,
      status: 'retake' as const,
      cast: ['Antonio'],
      strokes: [
        {
          id: newElementId(),
          tool: 'pencil' as const,
          color: '#EDEDED',
          width: 4,
          points: [0, 0, 2048, 4096],
        },
      ],
    };
    addElement(doc, scene);
    const map = addElement(doc, frame);
    expect(map.get('strokes')).toBeInstanceOf(Y.Array);
    expect(readElement(roots(doc).elements.get(frame.id)!)).toEqual({ ...frame, shapes: [] });
    expect(validateBoardDoc(doc)).toEqual([]);

    // Two people drawing at once keep both strokes.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const stroke = (x: number) => ({
      id: newElementId(),
      tool: 'brush',
      color: '#3B7CF6',
      width: 8,
      points: [x, 0, x, 10],
    });
    (map.get('strokes') as Y.Array<object>).push([stroke(1)]);
    (roots(other).elements.get(frame.id)!.get('strokes') as Y.Array<object>).push([stroke(2)]);
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(
      (readElement(roots(doc).elements.get(frame.id)!) as { strokes: unknown[] }).strokes,
    ).toHaveLength(3);
  });

  it('gives every new frame its stroke and shape arrays, so concurrent first strokes merge', () => {
    const doc = createBoardDoc(boardId);
    const frame = { ...base(), type: 'frame' as const };
    const map = addElement(doc, frame);
    expect(map.get('strokes')).toBeInstanceOf(Y.Array);
    expect(map.get('shapes')).toBeInstanceOf(Y.Array);
    expect(readElement(map)).toEqual({ ...frame, strokes: [], shapes: [] });
  });

  const shape = (kind: string, extra: object = {}) => ({
    id: newElementId(),
    kind,
    color: '#E5484D',
    width: 4,
    x0: 0,
    y0: 0,
    x1: 2048,
    y1: STROKE_GRID,
    ...extra,
  });

  it('stores shapes and texts of a frame drawing, and the reference opacity', () => {
    const doc = createBoardDoc(boardId);
    const frame = {
      ...base(),
      type: 'frame' as const,
      referenceOpacity: 0.6,
      strokes: [],
      shapes: [shape('rect'), shape('arrow'), shape('text', { text: 'Treno' })] as FrameShape[],
    };
    const map = addElement(doc, frame);
    expect(map.get('shapes')).toBeInstanceOf(Y.Array);
    expect(readElement(map)).toEqual(frame);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('leaves out shapes it cannot read instead of dropping the frame', () => {
    const parsed = FrameElement.parse({
      ...base(),
      type: 'frame',
      shapes: [shape('rect'), shape('star'), shape('line', { x1: STROKE_GRID + 1 })],
    });
    expect(parsed.shapes?.map((s) => s.kind)).toEqual(['rect']);
  });

  it('keeps frames with shapes readable by clients that predate them', () => {
    // The frame schema before shapes: Zod drops the keys it does not know.
    const OldFrame = FrameElement.omit({ shapes: true, referenceOpacity: true });
    const frame = {
      ...base(),
      type: 'frame' as const,
      referenceOpacity: 0.4,
      shapes: [shape('ellipse')],
    };
    const old = OldFrame.safeParse(frame);
    expect(old.success).toBe(true);
    expect(old.data).not.toHaveProperty('shapes');
    // And frames written before shapes still read.
    expect(FrameElement.safeParse(old.data).success).toBe(true);
  });

  it('bounds pen strokes', () => {
    const stroke = (points: number[]) =>
      Element.safeParse({
        ...base(),
        type: 'frame',
        strokes: [{ id: newElementId(), tool: 'pencil', color: '#EDEDED', width: 4, points }],
      }).success;
    expect(stroke([0, 0, STROKE_GRID, STROKE_GRID])).toBe(true);
    expect(stroke([0, 0, 0.5, 1])).toBe(false);
    expect(stroke([0, 0, STROKE_GRID + 1, 0])).toBe(false);
    expect(stroke([0, 0, 1])).toBe(false);
    expect(stroke(Array.from({ length: 2050 }, () => 1))).toBe(false);
  });

  it('stores arrows attached to cards or free', () => {
    const doc = createBoardDoc(boardId);
    const arrow = {
      ...base(),
      type: 'arrow' as const,
      from: { elementId: newElementId(), x: 10, y: 20 },
      to: { x: 300, y: 40 },
      label: 'controcampo',
      line: 'dashed' as const,
    };
    addElement(doc, arrow);
    expect(readElement(roots(doc).elements.get(arrow.id)!)).toEqual(arrow);
  });

  it('accepts Tiptap position migration roots after a Yjs round-trip, but rejects other roots', () => {
    const doc = createBoardDoc(boardId);
    doc.getMap('__tiptap_position_migrations:item:1244454727:98').set('done', true);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(validateBoardDoc(copy)).toEqual([]);
    copy.getMap('unexpected').set('value', true);
    copy.getMap('__tiptap_position_migrations:unexpected').set('value', true);
    expect(validateBoardDoc(copy).map((issue) => issue.message)).toEqual([
      'Unknown root type "unexpected".',
      'Unknown root type "__tiptap_position_migrations:unexpected".',
    ]);
  });

  it('keeps the aspect ratio of the board in meta', () => {
    const doc = createBoardDoc(boardId);
    expect(getBoardAspect(doc)).toBeNull();
    setBoardAspect(doc, '2.39');
    expect(getBoardAspect(doc)).toBe('2.39');
    roots(doc).meta.set('aspect', '7:5');
    expect(getBoardAspect(doc)).toBeNull();
    expect(validateBoardDoc(doc)).toHaveLength(1);
  });

  it('keeps the sound track of the animatic in meta', () => {
    const doc = createBoardDoc(boardId);
    expect(getAnimaticAudio(doc)).toBeNull();
    const audio = { assetId: '6f1d0c1e-3b9a-4c55-8a51-0e0f3b8a9c11', volume: 0.8 };
    setAnimaticAudio(doc, audio);
    expect(getAnimaticAudio(doc)).toEqual(audio);
    expect(validateBoardDoc(doc)).toEqual([]);
    expect(() => setAnimaticAudio(doc, { ...audio, volume: 2 })).toThrow();
    roots(doc).meta.set('animaticAudio', { assetId: 'not-an-id', volume: 1 });
    expect(getAnimaticAudio(doc)).toBeNull();
    expect(validateBoardDoc(doc)).toHaveLength(1);
    setAnimaticAudio(doc, null);
    expect(roots(doc).meta.has('animaticAudio')).toBe(false);
  });

  it('migrates version 8 without adding a sound track', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 8);
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getAnimaticAudio(doc)).toBeNull();
  });

  it('upgrades a version 1 document without touching its elements', () => {
    const update = Uint8Array.from(atob(BOARD_V1), (c) => c.charCodeAt(0));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    expect(getSchemaVersion(doc)).toBe(1);
    const before = [...roots(doc).elements.values()].map((m) => readElement(m));
    expect(before.every(Boolean)).toBe(true);
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect([...roots(doc).elements.values()].map((m) => readElement(m))).toEqual(before);
    const note = roots(doc).elements.get('note_v1_00001')!;
    expect((note.get('body') as Y.XmlFragment).toString()).toContain('Luce al neon');
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('supports approved frame flag with bidirectional backward compatibility and Zod stripping', () => {
    // 1. A frame with the new optional approved field parses with the new schema
    const doc = createBoardDoc(boardId);
    const mapApproved = addElement(doc, {
      ...base(),
      type: 'frame' as const,
      status: 'todo',
      approved: true,
    });
    const parsed = readElement(mapApproved);
    expect(parsed).toMatchObject({ type: 'frame', status: 'todo', approved: true });

    // 2. Proving that an older schema (without approved in FrameElement) still parses the element
    // because Zod strips unknown keys, whereas an invalid enum value (like status: approved) would fail.
    const OldFrameElement = FrameElement.omit({ approved: true });
    const rawFrame = {
      ...base(),
      type: 'frame' as const,
      status: 'todo',
      approved: true,
    };
    const parsedOld = OldFrameElement.safeParse(rawFrame);
    expect(parsedOld.success).toBe(true);
    if (parsedOld.success) {
      expect(parsedOld.data).toMatchObject({ type: 'frame', status: 'todo' });
      expect(parsedOld.data).not.toHaveProperty('approved');
    }

    // Proving that if approved were in status enum, an older schema without approved in enum would fail
    const invalidStatusForOld = OldFrameElement.safeParse({
      ...rawFrame,
      status: 'approved',
    });
    expect(invalidStatusForOld.success).toBe(false);

    // 3. Old documents (without approved field) parse cleanly with the new schema
    const mapDraft = addElement(doc, {
      ...base(),
      type: 'frame' as const,
    });
    const parsedDraft = readElement(mapDraft);
    expect(parsedDraft).toMatchObject({ type: 'frame' });
    expect(parsedDraft).not.toHaveProperty('status');
    expect(parsedDraft).not.toHaveProperty('approved');

    // 4. Server-side board edit validation (ADR 0014) and guest parsing accept it
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('skips element types it does not know without removing them', () => {
    const doc = createBoardDoc(boardId);
    const future = new Y.Map<unknown>(Object.entries({ ...base(), type: 'hologram' }));
    roots(doc).elements.set('future_el_0001', future);
    expect(readElement(future)).toBeNull();
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(roots(copy).elements.get('future_el_0001')?.get('type')).toBe('hologram');
  });
});

describe('video still provenance', () => {
  const assetId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  it('preserves subsecond source times on images and frames through Yjs', () => {
    for (const type of ['image', 'frame'] as const) {
      for (const source of [
        { kind: 'uploaded-video' as const, assetId, timeSeconds: 12.345 },
        {
          kind: 'link-thumbnail' as const,
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          timeSeconds: 42,
        },
        { kind: 'link-thumbnail' as const, url: 'https://vimeo.com/123' },
      ]) {
        const doc = createBoardDoc(boardId);
        const element = { ...base(), type, assetId, source };
        addElement(doc, element);
        const copy = new Y.Doc();
        Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
        expect(readElement(roots(copy).elements.get(element.id)!)).toMatchObject(element);
        expect(validateBoardDoc(copy)).toEqual([]);
      }
    }
  });

  it('rejects invalid times and unsafe or incomplete sources', () => {
    for (const type of ['image', 'frame'] as const) {
      for (const source of [
        ...[-1, Number.NaN, Number.POSITIVE_INFINITY, '12'].map((timeSeconds) => ({
          kind: 'uploaded-video',
          assetId,
          timeSeconds,
        })),
        { kind: 'uploaded-video', assetId },
        { kind: 'uploaded-video', assetId: 'invalid', timeSeconds: 0 },
        { kind: 'link-thumbnail', url: 'javascript:alert(1)' },
        { kind: 'link-thumbnail', url: 'https://vimeo.com/123', timeSeconds: -1 },
        { kind: 'unknown', assetId, timeSeconds: 0 },
      ])
        expect(Element.safeParse({ ...base(), type, assetId, source }).success).toBe(false);
    }
  });

  it('migrates version 4 without fabricating provenance or altering notes', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 4);
    const frame = { ...base(), type: 'frame' as const, assetId, notes: 'Last Train' };
    addElement(doc, frame);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(frame.id)!)).not.toHaveProperty('source');
    expect(migrateBoardDoc(doc, boardId)).toEqual([]);
  });
});

describe('arrow path', () => {
  const arrow = (path?: 'straight' | 'curved') => ({
    ...base(),
    type: 'arrow' as const,
    from: { x: 0, y: 0 },
    to: { x: 200, y: 80 },
    label: 'Marta → Leo',
    line: 'dashed' as const,
    heads: 'both' as const,
    ...(path ? { path } : {}),
  });

  it('keeps curved and straight arrows with their label through Yjs', () => {
    for (const path of ['straight', 'curved'] as const) {
      const doc = createBoardDoc(boardId);
      const element = arrow(path);
      addElement(doc, element);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      expect(readElement(roots(copy).elements.get(element.id)!)).toMatchObject(element);
      expect(validateBoardDoc(copy)).toEqual([]);
    }
  });

  it('rejects unknown paths', () => {
    for (const path of ['zigzag', 1, null])
      expect(Element.safeParse({ ...arrow(), path }).success).toBe(false);
  });

  it('migrates version 5 arrows unchanged, so they stay straight', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 5);
    const element = arrow();
    addElement(doc, element);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(element.id)!)).not.toHaveProperty('path');
  });
});

describe('story bible cards', () => {
  const assetId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const marta = () => ({
    ...base(),
    type: 'character' as const,
    name: 'Marta',
    role: 'Protagonista',
    assetId,
    age: '34',
    description: 'Capotreno, aspetta l’ultimo treno ogni notte.',
    actor: 'Giulia Neri',
    contact: 'agenzia@example.com',
    notes: 'Provino il 12.',
    scenes: ['1', '3A'],
  });
  const station = () => ({
    ...base(),
    type: 'location' as const,
    name: 'Stazione Centrale',
    setting: 'int-ext' as const,
    address: 'Piazza Duca d’Aosta 1, Milano',
    mapUrl: 'https://www.openstreetmap.org/#map=18/45.4864/9.2041',
    assetId,
    light: 'Blu del crepuscolo, 19:30',
    availability: 'Solo di notte, dopo le 23',
    contact: 'Ufficio permessi',
    notes: 'Serve il permesso RFI.',
    scenes: ['1'],
  });

  it('keeps characters and locations through Yjs', () => {
    for (const element of [marta(), station(), { ...base(), type: 'character', name: '' }]) {
      const doc = createBoardDoc(boardId);
      addElement(doc, element as Element);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      expect(readElement(roots(copy).elements.get(element.id)!)).toMatchObject(element);
      expect(validateBoardDoc(copy)).toEqual([]);
    }
  });

  it('rejects unsafe map links, unknown settings and long scene numbers', () => {
    for (const bad of [
      { ...station(), mapUrl: 'javascript:alert(1)' },
      { ...station(), setting: 'space' },
      { ...marta(), scenes: ['1234567890123'] },
      { ...marta(), name: undefined },
    ])
      expect(Element.safeParse(bad).success).toBe(false);
  });

  it('migrates version 6 unchanged', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 6);
    addElement(doc, { ...base(), type: 'note' });
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
  });
});

describe('image crop and rotation', () => {
  const assetId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

  it('preserves normalized crop and rotation on images through Yjs', () => {
    for (const aspect of ['free', '1:1', '4:3', '16:9', '2.39:1'] as const) {
      const doc = createBoardDoc(boardId);
      const element = {
        ...base(),
        type: 'image' as const,
        assetId,
        crop: { x: 0.1, y: 0.15, w: 0.75, h: 0.6, aspect },
        rotation: 90,
      };
      addElement(doc, element);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      expect(readElement(roots(copy).elements.get(element.id)!)).toEqual(element);
      expect(validateBoardDoc(copy)).toEqual([]);
    }
  });

  it('rejects out-of-bounds crop rectangles, unknown presets, and invalid rotations', () => {
    const image = (extra: Record<string, unknown>) =>
      Element.safeParse({ ...base(), type: 'image', assetId, ...extra }).success;
    expect(image({ crop: { x: 0, y: 0, w: 1, h: 1 } })).toBe(true);
    expect(image({ rotation: -22.5 })).toBe(true);
    expect(image({ rotation: 270 })).toBe(true);
    expect(image({ crop: { x: -0.1, y: 0, w: 0.5, h: 0.5 } })).toBe(false);
    expect(image({ crop: { x: 0.6, y: 0, w: 0.5, h: 0.5 } })).toBe(false);
    expect(image({ crop: { x: 0, y: 0.7, w: 0.5, h: 0.5 } })).toBe(false);
    expect(image({ crop: { x: 0, y: 0, w: 0, h: 0.5 } })).toBe(false);
    expect(image({ crop: { x: 0, y: 0, w: 0.5, h: 0.5, aspect: '21:9' } })).toBe(false);
    expect(image({ rotation: 720 })).toBe(false);
    expect(image({ rotation: -400 })).toBe(false);
    expect(image({ rotation: Number.NaN })).toBe(false);
  });

  it('migrates version 7 images unchanged, leaving crop and rotation omitted', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 7);
    const image = { ...base(), type: 'image' as const, assetId, caption: 'Locandina' };
    addElement(doc, image);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    const parsed = readElement(roots(doc).elements.get(image.id)!);
    expect(parsed).not.toHaveProperty('crop');
    expect(parsed).not.toHaveProperty('rotation');
  });
});

describe('column colours and section headings', () => {
  it('keeps a column colour and a section heading through Yjs', () => {
    const doc = createBoardDoc(boardId);
    const column = {
      ...base(),
      type: 'column' as const,
      title: 'Da fare',
      color: 'green' as const,
    };
    const section = {
      ...base(),
      type: 'section' as const,
      w: 640,
      title: 'Sequenza 1 · La preparazione',
      moveCards: true,
    };
    addElement(doc, column);
    addElement(doc, section);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readElement(roots(copy).elements.get(column.id)!)).toEqual(column);
    expect(readElement(roots(copy).elements.get(section.id)!)).toEqual(section);
    expect(validateBoardDoc(copy)).toEqual([]);
  });

  it('accepts only colours of the card palette on columns', () => {
    const column = (color: string) =>
      Element.safeParse({ ...base(), type: 'column', title: '', color }).success;
    expect(column('orange')).toBe(true);
    expect(column('red')).toBe(false);
    expect(column('#FF0000')).toBe(false);
  });

  it('migrates version 9 columns unchanged, without a colour', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 9);
    const column = { ...base(), type: 'column' as const, title: 'Brief' };
    addElement(doc, column);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(column.id)!)).not.toHaveProperty('color');
  });

  it('counts cards, files and boards, not the structure that arranges them', () => {
    const types = ['note', 'image', 'file', 'board', 'column', 'arrow', 'section', 'scene'];
    expect(
      contentCounts([...types.map((type) => ({ type })), { type: 'frame', status: 'shot' }]),
    ).toEqual({
      elementCount: 9,
      frameCount: 1,
      framesToShoot: 0,
      boardCount: 1,
      fileCount: 1,
      cardCount: 3,
    });
  });
});

describe('table cards', () => {
  const table = (): Extract<Element, { type: 'table' }> => ({
    ...base(),
    type: 'table',
    w: 420,
    header: true,
    color: 'orange',
    columns: [{ id: 'colAAAAAAAA', width: 120 }, { id: 'colBBBBBBBB' }],
    rows: [
      { id: 'rowAAAAAAAA', cells: { colAAAAAAAA: 'Operatore', colBBBBBBBB: 'Zona' } },
      { id: 'rowBBBBBBBB', cells: { colAAAAAAAA: 'Matteo' } },
    ],
  });

  it('keeps columns, rows and cells through Yjs, as nested types', () => {
    const doc = createBoardDoc(boardId);
    const el = table();
    const map = addElement(doc, el);
    expect(map.get('rows')).toBeInstanceOf(Y.Array);
    expect((map.get('rows') as Y.Array<Y.Map<unknown>>).get(0).get('cells')).toBeInstanceOf(Y.Map);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readElement(roots(copy).elements.get(el.id)!)).toEqual(el);
    expect(validateBoardDoc(copy)).toEqual([]);
  });

  it('merges two people editing different cells of the same row', () => {
    const a = createBoardDoc(boardId);
    const el = table();
    addElement(a, el);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const cells = (doc: Y.Doc) =>
      (roots(doc).elements.get(el.id)!.get('rows') as Y.Array<Y.Map<unknown>>)
        .get(1)
        .get('cells') as Y.Map<string>;
    cells(a).set('colAAAAAAAA', 'Niccolò');
    cells(b).set('colBBBBBBBB', 'Lagunc');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(cells(a).toJSON()).toEqual({ colAAAAAAAA: 'Niccolò', colBBBBBBBB: 'Lagunc' });
  });

  it('refuses a table without columns or with too many', () => {
    const parse = (columns: unknown[]) => Element.safeParse({ ...table(), columns }).success;
    expect(parse([])).toBe(false);
    expect(parse(Array.from({ length: 21 }, (_, i) => ({ id: `col${i}AAAAAAA` })))).toBe(false);
  });

  it('migrates version 10 documents unchanged', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 10);
    addElement(doc, { ...base(), type: 'section' as const, title: 'Sequenza 1' });
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
  });
});

describe('map cards', () => {
  it('keeps a place through Yjs and checks its coordinates', () => {
    const doc = createBoardDoc(boardId);
    const map = {
      ...base(),
      type: 'map' as const,
      name: 'Rifugio Lagunc',
      url: 'https://www.openstreetmap.org/?mlat=46.33&mlon=9.55',
      lat: 46.33,
      lon: 9.55,
      zoom: 15,
      imageAssetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
    };
    addElement(doc, map);
    expect(readElement(roots(doc).elements.get(map.id)!)).toEqual(map);
    expect(validateBoardDoc(doc)).toEqual([]);
    expect(Element.safeParse({ ...map, lat: 91 }).success).toBe(false);
    expect(Element.safeParse({ ...map, url: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('set plans', () => {
  const plan = () => ({
    ...base(),
    type: 'plan' as const,
    title: 'Cucina, giorno 2',
    strokes: [
      {
        id: 'strokeAAAAAAA',
        tool: 'pencil' as const,
        color: '#1C1C1E',
        width: 3,
        points: [0, 0, 400, 400],
      },
    ],
    shapes: [
      {
        id: 'shapeAAAAAAAA',
        kind: 'text' as const,
        color: '#1C1C1E',
        width: 24,
        x0: 100,
        y0: 100,
        x1: 100,
        y1: 100,
        text: 'tavolo',
      },
    ],
    icons: [
      {
        id: 'iconAAAAAAAAA',
        kind: 'camera' as const,
        color: '#9DB8F2',
        x: 1000,
        y: 3000,
        rotation: 310,
        label: 'A cam',
      },
      { id: 'iconBBBBBBBBB', kind: 'actor' as const, color: '#B897F0', x: 2000, y: 1200 },
    ],
  });

  it('keeps strokes, shapes and icons through Yjs, icons as Y.Maps', () => {
    const doc = createBoardDoc(boardId);
    const el = plan();
    addElement(doc, el);
    const map = roots(doc).elements.get(el.id)!;
    expect(readElement(map)).toEqual({ ...el, walls: [], openings: [], circuits: [] });
    expect((map.get('icons') as Y.Array<unknown>).get(0)).toBeInstanceOf(Y.Map);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('creates empty arrays so two people drawing on a new plan merge', () => {
    const doc = createBoardDoc(boardId);
    const el = { ...base(), type: 'plan' as const };
    addElement(doc, el);
    const map = roots(doc).elements.get(el.id)!;
    for (const key of ['strokes', 'shapes', 'icons', 'walls', 'openings'])
      expect(map.get(key)).toBeInstanceOf(Y.Array);
  });

  it('leaves out icons it cannot read, such as a kind added later or a full turn', () => {
    const el = plan();
    const camera = el.icons[0];
    const parsed = Element.parse({
      ...el,
      icons: [
        ...el.icons,
        { id: 'iconCCCCCCCCC', kind: 'crane', color: '#9DB8F2', x: 1, y: 1 },
        { ...camera, id: 'iconDDDDDDDDD', rotation: 360 },
      ],
    });
    expect(parsed.type === 'plan' && parsed.icons?.map((i) => i.id)).toEqual([
      'iconAAAAAAAAA',
      'iconBBBBBBBBB',
    ]);
  });

  it('migrates version 13 documents unchanged', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 13);
    addElement(doc, { ...base(), type: 'todo' as const, items: [], list: 'props' as const });
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('cuts items past the limits instead of refusing the whole plan', () => {
    const el = plan();
    const icons = Array.from({ length: MAX_PLAN_ICONS + 3 }, (_, i) => ({
      ...el.icons[0]!,
      id: `icon${String(i).padStart(9, '0')}`,
    }));
    const parsed = Element.safeParse({ ...el, icons });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type === 'plan' && parsed.data.icons?.length).toBe(
      MAX_PLAN_ICONS,
    );
  });

  it('migrates version 21 scenes unchanged and keeps the omitted mark of version 22', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 21);
    const old = Element.parse({
      id: newElementId(),
      type: 'scene',
      x: 0,
      y: 0,
      w: 960,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: 1,
      number: '15',
      title: 'Parking lot',
    });
    addElement(doc, old);
    expect(migrateBoardDoc(doc, boardId)).toEqual([22, 23, 24]);
    expect(readElement(roots(doc).elements.get(old.id)!)).toEqual(old);
    expect(old).not.toHaveProperty('omitted');

    expect(Element.parse({ ...old, omitted: true })).toMatchObject({ omitted: true });
    expect(Element.safeParse({ ...old, omitted: 'yes' }).success).toBe(false);
  });

  it('migrates version 20 references unchanged and keeps the group of version 21', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 20);
    const old = Element.parse({
      id: newElementId(),
      type: 'image',
      x: 0,
      y: 0,
      w: 240,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: 1,
      assetId: 'asset',
      caption: 'Backlight',
    });
    addElement(doc, old);
    expect(migrateBoardDoc(doc, boardId)).toEqual([21, 22, 23, 24]);
    expect(readElement(roots(doc).elements.get(old.id)!)).toEqual(old);

    expect(Element.parse({ ...old, group: '  Luce ' })).toMatchObject({ group: 'Luce' });
    expect(Element.safeParse({ ...old, group: ' ' }).success).toBe(false);
    expect(Element.safeParse({ ...old, group: 'x'.repeat(61) }).success).toBe(false);
  });

  it('migrates version 17 plans unchanged and keeps the size in percent of version 18', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 17);
    const old = plan();
    addElement(doc, old);
    expect(migrateBoardDoc(doc, boardId)).toEqual([18, 19, 20, 21, 22, 23, 24]);
    expect(readElement(roots(doc).elements.get(old.id)!)).toEqual({
      ...old,
      walls: [],
      openings: [],
      circuits: [],
    });

    const icon = { ...old.icons[0]!, percent: 120 };
    const parsed = Element.parse({ ...old, icons: [icon] });
    expect(parsed.type === 'plan' && parsed.icons?.[0]?.percent).toBe(120);
    // Out of bounds, only that icon is left out: the plan still reads.
    const wrong = Element.parse({
      ...old,
      icons: [icon, { ...icon, id: 'iconBBBBBBBBB', percent: 5 }],
    });
    expect(wrong.type === 'plan' && wrong.icons?.length).toBe(1);
  });

  it('migrates version 14 plans unchanged and keeps the version 15 fields', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 14);
    const old = plan();
    addElement(doc, old);
    expect(migrateBoardDoc(doc, boardId)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(readElement(roots(doc).elements.get(old.id)!)).toEqual({
      ...old,
      walls: [],
      openings: [],
      circuits: [],
    });

    const rich = {
      ...base(),
      type: 'plan' as const,
      sceneIds: ['sceneAAAAAAAA'],
      variantOf: 'planBaseAAAAA',
      variant: 'Sera',
      hiddenLayers: ['camera' as const],
      lockedLayers: ['set' as const],
      scale: 192.3,
      grid: '0.5' as const,
      rulers: true,
      sensor: 'ff' as const,
      presentation: false,
      strokes: [{ ...old.strokes[0]!, layer: 'notes' as const, group: 'groupAAAAAAAA' }],
      shapes: [
        { ...old.shapes[0]!, rotation: 340 },
        {
          ...old.shapes[0]!,
          id: 'measureAAAAAA',
          kind: 'measure' as const,
          from: 'iconAAAAAAAAA',
          to: 'iconBBBBBBBBB',
        },
      ],
      icons: [
        {
          ...old.icons[0]!,
          kind: 'fresnel' as const,
          power: '1,2K',
          beam: 30,
          intensity: 0.8,
          size: 'L' as const,
        },
        {
          ...old.icons[1]!,
          steps: [{ x: 10, y: 20, note: 'Porta, entra', bend: 40 }],
          note: 'Al tavolo',
          dashed: true,
        },
        { id: 'sofaAAAAAAAAA', kind: 'sofa' as const, color: '#1C1C1E', x: 9, y: 9, w: 110, h: 45 },
      ],
    };
    addElement(doc, rich);
    expect(readElement(roots(doc).elements.get(rich.id)!)).toEqual({
      ...rich,
      walls: [],
      openings: [],
      circuits: [],
    });
    expect(validateBoardDoc(doc)).toEqual([]);
  });
});

describe('set plan v2 (version 23, decision 0104)', () => {
  const plan = (extra: Record<string, unknown> = {}) => ({
    ...base(),
    type: 'plan' as const,
    strokes: [],
    shapes: [],
    icons: [
      { id: 'iconAAAAAAAAA', kind: 'led' as const, color: '#EDD963', x: 1000, y: 1000 },
      { id: 'iconBBBBBBBBB', kind: 'softbox' as const, color: '#EDD963', x: 1100, y: 1000 },
    ],
    ...extra,
  });

  it('migrates version 22 plans unchanged, every kind of version 22 still valid', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 22);
    const old = Element.parse(plan());
    addElement(doc, old);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([23, 24]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(old.id)!)).toEqual({
      ...old,
      walls: [],
      openings: [],
      circuits: [],
    });
    const v22 = [
      'fresnel',
      'led',
      'tube',
      'softbox',
      'lantern',
      'para',
      'practical',
      'sun',
      'cstand',
      'flag',
      'frame',
      'bounce',
      'gel',
      'camera',
      'tripod',
      'gimbal',
      'dolly',
      'track',
      'slider',
      'jib',
      'drone',
      'carrig',
      'actor',
      'group',
      'crew',
      'boom',
      'monitor',
      'recorder',
      'table',
      'chair',
      'sofa',
      'bed',
      'wardrobe',
      'desk',
      'stairs',
      'door',
      'window',
      'wall',
      'column',
      'tree',
      'car',
      'road',
      'light',
    ];
    const icons = v22.map((kind, i) => ({
      id: `icon${String(i).padStart(9, '0')}`,
      kind,
      color: '#1C1C1E',
      x: 1,
      y: 1,
    }));
    const parsed = Element.parse(plan({ icons }));
    expect(parsed.type === 'plan' && parsed.icons?.map((i) => i.kind)).toEqual(v22);
  });

  it('keeps the new fields of icons and plans, walls and openings as Y.Maps', () => {
    const doc = createBoardDoc(boardId);
    const el = Element.parse(
      plan({
        icons: [
          {
            id: 'iconAAAAAAAAA',
            kind: 'cob',
            color: '#EDD963',
            x: 1000,
            y: 1000,
            role: 'key',
            watts: 300,
            make: 'Aputure 300d',
            gel: 'CTO ½',
            stand: 'combo',
            kelvin: 5600,
            height: 2.4,
            tilt: -20,
            circuit: 'circuitAAAAAA',
            tier: 4,
            note: 'Chiave',
          },
          { id: 'iconBBBBBBBBB', kind: 'grid', color: '#1C1C1E', x: 1, y: 1, on: 'iconAAAAAAAAA' },
          {
            id: 'iconCCCCCCCCC',
            kind: 'camera',
            color: '#9DB8F2',
            x: 1,
            y: 1,
            support: 'dolly',
            frameId: 'frameAAAAAAAA',
            height: 1.2,
          },
          {
            id: 'iconDDDDDDDDD',
            kind: 'actor',
            color: '#B897F0',
            x: 1,
            y: 1,
            characterId: 'charAAAAAAAAA',
            pose: 'seated',
          },
        ],
        walls: [
          { id: 'wallAAAAAAAAA', points: [0, 0, 100, 0, 100, 100], thickness: 9, closed: true },
        ],
        openings: [
          {
            id: 'doorAAAAAAAAA',
            wall: 'wallAAAAAAAAA',
            kind: 'door',
            at: 50,
            width: 40,
            side: 'right',
            hinge: 'end',
          },
        ],
        locationId: 'placeAAAAAAAA',
        circuits: [{ id: 'circuitAAAAAA', name: 'A', amps: 16 }],
        voltage: 120,
        background: { assetId: 'asset-1', opacity: 0.4, grey: true },
        north: 30,
      }),
    );
    addElement(doc, el);
    const map = roots(doc).elements.get(el.id)!;
    expect(readElement(map)).toEqual(el);
    // Walls and openings are Y.Maps, as icons, so edits of different fields merge.
    expect((map.get('walls') as Y.Array<unknown>).get(0)).toBeInstanceOf(Y.Map);
    expect((map.get('openings') as Y.Array<unknown>).get(0)).toBeInstanceOf(Y.Map);
    expect(hasStoredShape(map)).toBe(true);
    expect(validateBoardDoc(doc)).toEqual([]);
    // Walls first written as plain objects are still read and pass the stored-shape check.
    const plain = el.type === 'plan' ? (el.walls ?? []) : [];
    doc.transact(() => map.set('walls', Y.Array.from(plain)));
    expect(readElement(map)).toEqual(el);
    expect(hasStoredShape(map)).toBe(true);
  });

  it('bounds walls and openings, leaving out the ones it cannot read', () => {
    const wall = { id: 'wallAAAAAAAAA', points: [0, 0, 100, 0], thickness: 9 };
    const parsed = Element.parse(
      plan({
        walls: [
          wall,
          { ...wall, id: 'wallBBBBBBBBB', points: [0, 0] },
          { ...wall, id: 'wallCCCCCCCCC', points: [0, 0, 1, 1, 2] },
          { ...wall, id: 'wallDDDDDDDDD', thickness: 500 },
          { ...wall, id: 'wallEEEEEEEEE', points: Array(MAX_WALL_POINTS * 2 + 2).fill(1) },
        ],
        openings: [
          { id: 'openAAAAAAAAA', wall: 'wallAAAAAAAAA', kind: 'window', at: 0, width: 10 },
          { id: 'openBBBBBBBBB', wall: 'wallAAAAAAAAA', kind: 'hatch', at: 0, width: 10 },
          { id: 'openCCCCCCCCC', wall: 'wallAAAAAAAAA', kind: 'door', at: 0, width: 0 },
        ],
      }),
    );
    expect(parsed.type === 'plan' && parsed.walls?.map((w) => w.id)).toEqual(['wallAAAAAAAAA']);
    expect(parsed.type === 'plan' && parsed.openings?.map((o) => o.id)).toEqual(['openAAAAAAAAA']);
    const many = Array.from({ length: MAX_PLAN_WALLS + 2 }, (_, i) => ({
      ...wall,
      id: `wall${String(i).padStart(9, '0')}`,
    }));
    const cut = Element.parse(plan({ walls: many }));
    expect(cut.type === 'plan' && cut.walls?.length).toBe(MAX_PLAN_WALLS);
    for (const wrong of [{ voltage: 110 }, { north: 360 }, { background: { assetId: '' } }])
      expect(Element.safeParse(plan(wrong)).success, JSON.stringify(wrong)).toBe(false);
    // Circuits are read one by one, as walls are: a bad one is left out, the list cut at 30.
    const circuit = { id: 'circuitAAAAAA', name: 'A', amps: 16 };
    const circuits = Element.parse(
      plan({
        circuits: [
          circuit,
          { ...circuit, id: 'circuitBBBBBB', amps: 0 },
          ...Array.from({ length: MAX_PLAN_CIRCUITS + 1 }, (_, i) => ({
            ...circuit,
            id: `circuit${String(i).padStart(6, '0')}`,
          })),
        ],
      }),
    );
    expect(circuits.type === 'plan' && circuits.circuits?.length).toBe(MAX_PLAN_CIRCUITS);
    expect(circuits.type === 'plan' && circuits.circuits?.[1]?.id).toBe('circuit000000');
    const icon = { id: 'iconAAAAAAAAA', kind: 'cob', color: '#EDD963', x: 1, y: 1 };
    for (const wrong of [
      { tier: 6 },
      { kelvin: 500 },
      { tilt: 91 },
      { pose: 'kneeling' },
      { role: 'rim' },
      { on: 'not an id!' },
    ]) {
      const parsed = Element.parse(plan({ icons: [{ ...icon, ...wrong }] }));
      expect(parsed.type === 'plan' && parsed.icons, JSON.stringify(wrong)).toEqual([]);
    }
  });

  it('keeps clients of schema 22 read-only on a version 23 document', () => {
    expect(WRITER_SCHEMAS[23]).toEqual({ min: 23 });
  });
});

describe('items locked on their own (version 24, decision 0114)', () => {
  const icon = { id: 'iconAAAAAAAAA', kind: 'cob' as const, color: '#EDD963', x: 1, y: 1 };
  const plan = (extra: Record<string, unknown> = {}) => ({
    ...base(),
    type: 'plan' as const,
    strokes: [],
    shapes: [],
    icons: [icon],
    ...extra,
  });

  it('migrates version 23 plans unchanged, nothing locked', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 23);
    const old = Element.parse(plan());
    addElement(doc, old);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([24]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
  });

  it('reads `locked` on icons, strokes, shapes, walls and openings, and nothing else', () => {
    const doc = createBoardDoc(boardId);
    const el = Element.parse(
      plan({
        icons: [{ ...icon, locked: true }],
        strokes: [
          {
            id: 'strokeAAAAAAA',
            tool: 'pencil',
            color: '#EDEDED',
            width: 2,
            points: [0, 0, 10, 10],
            locked: true,
          },
        ],
        shapes: [
          {
            id: 'shapeAAAAAAAA',
            kind: 'rect',
            color: '#EDEDED',
            width: 2,
            x0: 0,
            y0: 0,
            x1: 10,
            y1: 10,
            locked: true,
          },
        ],
        walls: [{ id: 'wallAAAAAAAAA', points: [0, 0, 100, 0], thickness: 9, locked: true }],
        openings: [
          {
            id: 'openAAAAAAAAA',
            wall: 'wallAAAAAAAAA',
            kind: 'window',
            at: 50,
            width: 20,
            locked: true,
          },
        ],
      }),
    );
    expect(el.type === 'plan' && el.icons?.[0]?.locked).toBe(true);
    expect(el.type === 'plan' && el.strokes?.[0]?.locked).toBe(true);
    expect(el.type === 'plan' && el.shapes?.[0]?.locked).toBe(true);
    expect(el.type === 'plan' && el.walls?.[0]?.locked).toBe(true);
    expect(el.type === 'plan' && el.openings?.[0]?.locked).toBe(true);
    addElement(doc, el);
    const map = roots(doc).elements.get(el.id)!;
    expect(readElement(map)).toEqual(el);
    expect(hasStoredShape(map)).toBe(true);
    expect(checkCard(map)).toEqual({ status: 'known' });
    // A lock that is not a boolean leaves the item out, as any other bad field does.
    const bad = Element.parse(plan({ icons: [{ ...icon, locked: 'yes' }] }));
    expect(bad.type === 'plan' && bad.icons).toEqual([]);
  });

  it('keeps clients of schema 23 read-only on a version 24 document', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(24);
    expect(WRITER_SCHEMAS[24]).toEqual({ min: 24 });
    expect(MIN_WRITER_SCHEMA).toBe(24);
  });
});

describe('writer schemas (decision 0102)', () => {
  const proofs = readFileSync(
    fileURLToPath(new URL('../../canvas-core/src/older-client.test.ts', import.meta.url)),
    'utf8',
  );
  /**
   * Versions whose minimum is lower than themselves without a proof for that very pair: a test
   * of older-client.test.ts whose title starts with "schema <version> from <min>:".
   */
  const unproven = (schemas: typeof WRITER_SCHEMAS, file: string) =>
    Object.entries(schemas).flatMap(([version, { min, proof }]) => {
      if (min > Number(version)) return [Number(version)];
      if (min === Number(version)) return [];
      const title = `schema ${version} from ${min}: `;
      const proven =
        proof?.startsWith(title) &&
        new RegExp(`\\bit\\(\\s*'${proof.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(file);
      return proven ? [] : [Number(version)];
    });

  it('has an entry for the current schema, from which the minimum comes', () => {
    expect(WRITER_SCHEMAS[CURRENT_SCHEMA_VERSION]).toBeDefined();
    expect(MIN_WRITER_SCHEMA).toBe(WRITER_SCHEMAS[CURRENT_SCHEMA_VERSION]?.min);
  });

  it('lowers no minimum without a test that proves it for that version', () => {
    expect(unproven(WRITER_SCHEMAS, proofs)).toEqual([]);
    // A test that exists but proves nothing about the version does not count.
    const file =
      "it('duplicates a card', () => {});\nit('schema 24 from 23: keeps the new field', () => {});";
    expect(unproven({ 24: { min: 23, proof: 'duplicates a card' } }, file)).toEqual([24]);
    expect(
      unproven({ 24: { min: 23, proof: 'schema 24 from 22: keeps the new field' } }, file),
    ).toEqual([24]);
    expect(
      unproven({ 24: { min: 23, proof: 'schema 24 from 23: keeps the new field' } }, file),
    ).toEqual([]);
    expect(unproven({ 24: { min: 25 } }, file)).toEqual([24]);
  });
});
