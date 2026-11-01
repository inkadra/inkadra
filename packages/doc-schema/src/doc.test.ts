// SPDX-License-Identifier: MPL-2.0
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
  getSchemaVersion,
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
} from './index.ts';

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
    expect(migrateBoardDoc(doc, boardId)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([9, 10, 11, 12, 13]);
    expect(getAnimaticAudio(doc)).toBeNull();
  });

  it('upgrades a version 1 document without touching its elements', () => {
    const update = Uint8Array.from(atob(BOARD_V1), (c) => c.charCodeAt(0));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    expect(getSchemaVersion(doc)).toBe(1);
    const before = [...roots(doc).elements.values()].map((m) => readElement(m));
    expect(before.every(Boolean)).toBe(true);
    expect(migrateBoardDoc(doc, boardId)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([7, 8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([8, 9, 10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([10, 11, 12, 13]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([11, 12, 13]);
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
