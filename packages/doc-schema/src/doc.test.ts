// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_V1 } from './board-v1.fixture.ts';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  createBoardDoc,
  Element,
  FrameElement,
  type FrameShape,
  getBoardAspect,
  getSchemaVersion,
  migrateBoardDoc,
  newElementId,
  parseBoardDocName,
  readElement,
  roots,
  SchemaTooNewError,
  STROKE_GRID,
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([4, 5, 6]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([3, 4, 5, 6]);
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

  it('upgrades a version 1 document without touching its elements', () => {
    const update = Uint8Array.from(atob(BOARD_V1), (c) => c.charCodeAt(0));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    expect(getSchemaVersion(doc)).toBe(1);
    const before = [...roots(doc).elements.values()].map((m) => readElement(m));
    expect(before.every(Boolean)).toBe(true);
    expect(migrateBoardDoc(doc, boardId)).toEqual([2, 3, 4, 5, 6]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([5, 6]);
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
    expect(migrateBoardDoc(doc, boardId)).toEqual([6]);
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect(readElement(roots(doc).elements.get(element.id)!)).not.toHaveProperty('path');
  });
});
