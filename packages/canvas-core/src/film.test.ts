// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, Element, MAX_STROKE_POINTS, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listElements, updateElement } from './board.ts';
import {
  addFrame,
  addScene,
  addStroke,
  clearStrokes,
  decodeStroke,
  encodeStroke,
  formatDuration,
  frameLabels,
  frameLetter,
  moveFrames,
  removeStrokes,
  storyboardOf,
  strokeHit,
  totalDurationMs,
} from './film.ts';

const opts = { userId: null };
const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

describe('storyboards', () => {
  it('letters frames like a script: A to Z, then AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(frameLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ]);
  });

  it('groups frames by scene in order and labels them', () => {
    const doc = createBoardDoc(boardId);
    const s4 = addScene(doc, { number: '4', title: 'Il binario' }, opts);
    const s5 = addScene(doc, { title: "Sala d'attesa" }, opts);
    expect(s5.number).toBe('5');
    expect(s5.x).toBeGreaterThan(s4.x);
    const a = addFrame(doc, s4.id, null, { durationMs: 12_000 }, opts);
    const c = addFrame(doc, s4.id, null, { durationMs: 4000 }, opts);
    const b = addFrame(doc, s4.id, 1, { durationMs: 6000, label: '4B-bis' }, opts);
    const loose = addFrame(doc, null, null, {}, opts);
    const groups = storyboardOf(listElements(doc));
    expect(groups.map((g) => g.scene?.number ?? null)).toEqual(['4', '5', null]);
    expect(groups[0]?.frames.map((f) => f.id)).toEqual([a.id, b.id, c.id]);
    const labels = frameLabels(groups);
    expect([a, b, c, loose].map((f) => labels.get(f.id))).toEqual(['4A', '4B-bis', '4C', '1']);
    expect(formatDuration(totalDurationMs(groups[0]?.frames ?? []))).toBe('0:22');

    moveFrames(doc, [c.id], s5.id, 0);
    const after = storyboardOf(listElements(doc));
    expect(after[1]?.frames.map((f) => f.id)).toEqual([c.id]);
    expect(frameLabels(after).get(c.id)).toBe('5A');
  });

  it('undoes a new frame in one step', () => {
    const doc = createBoardDoc(boardId);
    const undo = new Y.UndoManager(doc.getMap('elements'), { trackedOrigins: new Set(['me']) });
    const scene = addScene(doc, { number: '1' }, { userId: null, origin: 'me' });
    undo.stopCapturing();
    addFrame(doc, scene.id, 0, {}, { userId: null, origin: 'me' });
    expect(listElements(doc)).toHaveLength(2);
    undo.undo();
    expect(listElements(doc)).toHaveLength(1);
  });
});

describe('pen strokes', () => {
  it('quantizes, simplifies and caps a line', () => {
    const straight = Array.from({ length: 500 }, (_, i) => ({ x: i / 499, y: 0.5 }));
    expect(encodeStroke(straight)).toEqual([0, 2048, STROKE_GRID, 2048]);
    const zigzag = Array.from({ length: 5000 }, (_, i) => ({ x: i / 4999, y: i % 2 ? 0.1 : 0.9 }));
    expect(encodeStroke(zigzag).length).toBeLessThanOrEqual(MAX_STROKE_POINTS * 2);
    expect(encodeStroke([{ x: 2, y: -1 }])).toEqual([STROKE_GRID, 0, STROKE_GRID, 0]);
    expect(decodeStroke([0, 2048, 4096, 4096])).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });

  it('adds, hits and removes strokes on a frame, two people at once', () => {
    const doc = createBoardDoc(boardId);
    const frame = addFrame(doc, null, null, {}, opts);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const line = (y: number) => ({
      tool: 'pencil' as const,
      color: '#EDEDED',
      width: 4,
      points: encodeStroke([
        { x: 0.1, y },
        { x: 0.9, y },
      ]),
    });
    const mine = addStroke(doc, frame.id, line(0.2));
    addStroke(other, frame.id, line(0.8));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    const read = () =>
      Element.parse(listElements(doc).find((e) => e.id === frame.id)) as { strokes?: unknown[] };
    expect(read().strokes).toHaveLength(2);
    const strokes = (read().strokes ?? []) as Parameters<typeof strokeHit>[0][];
    expect(strokes.filter((s) => strokeHit(s, { x: 0.5, y: 0.21 }, 0.02))).toHaveLength(1);
    removeStrokes(doc, frame.id, [mine ?? '']);
    expect(read().strokes).toHaveLength(1);
    clearStrokes(doc, frame.id);
    expect(read().strokes).toHaveLength(0);
    // Plain field writes leave the drawing alone.
    updateElement(doc, frame.id, { lens: '85mm' });
    expect(read().strokes).toHaveLength(0);
  });
});
