// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  MAX_STROKE_POINTS,
  newElementId,
  roots,
  STROKE_GRID,
  type Stroke,
  UNSORTED,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { childrenOf, createElement, keysAt, listElements, moveIntoParent } from './board.ts';
import type { Point } from './geometry.ts';

/**
 * Storyboards and shot lists: both are views of the scene and frame elements of a board
 * (docs/decisions/0012). A scene holds its frames through `parent`; their order is `z`.
 */

export type SceneElement = Extract<Element, { type: 'scene' }>;
export type FrameElement = Extract<Element, { type: 'frame' }>;

export interface SceneGroup {
  /** Null for frames that are not in a scene. */
  scene: SceneElement | null;
  frames: FrameElement[];
}

const byZ = (a: Element, b: Element) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1);

/** Scenes in order, each with its frames in shooting order; loose frames come last. */
export function storyboardOf(elements: readonly Element[]): SceneGroup[] {
  const all = [...elements];
  const scenes = all.filter((e): e is SceneElement => e.type === 'scene').sort(byZ);
  const groups: SceneGroup[] = scenes.map((scene) => ({
    scene,
    frames: childrenOf(all, scene.id).filter((e): e is FrameElement => e.type === 'frame'),
  }));
  const sceneIds = new Set(scenes.map((s) => s.id));
  const loose = all
    .filter(
      (e): e is FrameElement =>
        e.type === 'frame' &&
        (e.parent === null || e.parent === UNSORTED || !sceneIds.has(e.parent)),
    )
    .sort(byZ);
  if (loose.length > 0) groups.push({ scene: null, frames: loose });
  return groups;
}

/** A, B, … Z, AA, AB, …: the letter of the n-th frame (from 0) of a scene. */
export function frameLetter(n: number): string {
  let s = '';
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/** Label shown for each frame: its own, or scene number + letter, or a number when loose. */
export function frameLabels(groups: readonly SceneGroup[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { scene, frames } of groups) {
    frames.forEach((f, i) => {
      const auto = scene ? `${scene.number}${frameLetter(i)}` : String(i + 1);
      labels.set(f.id, f.label || auto);
    });
  }
  return labels;
}

export function totalDurationMs(frames: readonly FrameElement[]): number {
  return frames.reduce((sum, f) => sum + (f.durationMs ?? 0), 0);
}

/** 1:05, 0:04: minutes and seconds, rounded up to the second. */
export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type Opts = { userId: string | null; origin?: unknown };

/**
 * A new scene numbered after the last one, at `at` or else to the right of the other scenes
 * on the canvas.
 */
export function addScene(
  doc: Y.Doc,
  fields: Partial<Omit<SceneElement, 'id' | 'type' | 'x' | 'y'>>,
  opts: Opts,
  at?: Point,
): SceneElement {
  const all = listElements(doc);
  const scenes = all.filter((e): e is SceneElement => e.type === 'scene');
  const right = scenes.reduce((m, s) => Math.max(m, s.x + s.w), -Infinity);
  const last = scenes.sort(byZ).at(-1);
  const lastNumber = Number.parseInt(last?.number ?? '0', 10);
  return createElement(
    doc,
    'scene',
    at ?? { x: Number.isFinite(right) ? right + 40 : 0, y: 0 },
    {
      number:
        fields.number ?? String(Number.isFinite(lastNumber) ? lastNumber + 1 : scenes.length + 1),
      title: fields.title ?? '',
      ...fields,
    },
    opts,
  ) as SceneElement;
}

/** A new frame in a scene (or loose when `sceneId` is null) before the frame at `index`. */
export function addFrame(
  doc: Y.Doc,
  sceneId: string | null,
  index: number | null,
  fields: Partial<Omit<FrameElement, 'id' | 'type' | 'parent'>>,
  opts: Opts,
): FrameElement {
  let frame: FrameElement | undefined;
  doc.transact(() => {
    frame = createElement(
      doc,
      'frame',
      { x: fields.x ?? 0, y: fields.y ?? 0 },
      { ...fields, parent: sceneId },
      opts,
    ) as FrameElement;
    if (sceneId && index !== null) {
      const id = frame.id;
      const siblings = childrenOf(listElements(doc), sceneId).filter((e) => e.id !== id);
      const [key] = keysAt(siblings, index, 1);
      roots(doc).elements.get(id)?.set('z', key);
      frame = { ...frame, z: key ?? frame.z };
    }
  }, opts.origin);
  return frame as FrameElement;
}

/** Moves frames into a scene before the frame at `index` (counted among its frames). */
export function moveFrames(
  doc: Y.Doc,
  ids: string[],
  sceneId: string,
  index: number,
  origin?: unknown,
): void {
  moveIntoParent(doc, ids, sceneId, index, origin);
}

// Pen strokes ------------------------------------------------------------------

function strokesOf(doc: Y.Doc, frameId: string, create: boolean): Y.Array<Stroke> | null {
  const map = roots(doc).elements.get(frameId);
  if (map?.get('type') !== 'frame') return null;
  const current = map.get('strokes');
  if (current instanceof Y.Array) return current as Y.Array<Stroke>;
  if (!create) return null;
  const fresh = new Y.Array<Stroke>();
  map.set('strokes', fresh);
  return fresh;
}

export function addStroke(
  doc: Y.Doc,
  frameId: string,
  stroke: Omit<Stroke, 'id'>,
  origin?: unknown,
): string | null {
  if (stroke.points.length < 2) return null;
  const id = newElementId();
  doc.transact(() => strokesOf(doc, frameId, true)?.push([{ ...stroke, id }]), origin);
  return id;
}

export function removeStrokes(
  doc: Y.Doc,
  frameId: string,
  ids: Iterable<string>,
  origin?: unknown,
): void {
  const strokes = strokesOf(doc, frameId, false);
  if (!strokes) return;
  const doomed = new Set(ids);
  doc.transact(() => {
    const list = strokes.toArray();
    for (let i = list.length - 1; i >= 0; i--)
      if (doomed.has(list[i]?.id ?? '')) strokes.delete(i, 1);
  }, origin);
}

export function clearStrokes(doc: Y.Doc, frameId: string, origin?: unknown): void {
  const strokes = strokesOf(doc, frameId, false);
  if (strokes && strokes.length > 0) doc.transact(() => strokes.delete(0, strokes.length), origin);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the simplified line. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let worst = -1;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(points[i] as Point, points[from] as Point, points[to] as Point);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Turns the points of a drawn line, relative to the picture (0 to 1 on both axes), into the
 * stored form: simplified, quantized to the STROKE_GRID and at most MAX_STROKE_POINTS points.
 */
export function encodeStroke(points: Point[]): number[] {
  const grid = points.map((p) => ({
    x: Math.round(Math.max(0, Math.min(1, p.x)) * STROKE_GRID),
    y: Math.round(Math.max(0, Math.min(1, p.y)) * STROKE_GRID),
  }));
  const deduped = grid.filter(
    (p, i) => i === 0 || p.x !== grid[i - 1]?.x || p.y !== grid[i - 1]?.y,
  );
  if (deduped.length === 1) deduped.push({ ...(deduped[0] as Point) });
  let out = simplify(deduped, 2);
  // Still too long (a scribble): keep evenly spaced points, first and last included.
  if (out.length > MAX_STROKE_POINTS) {
    const step = (out.length - 1) / (MAX_STROKE_POINTS - 1);
    const all = out;
    out = Array.from({ length: MAX_STROKE_POINTS }, (_, i) => all[Math.round(i * step)] as Point);
  }
  return out.flatMap((p) => [p.x, p.y]);
}

/** Points of a stored stroke, relative to the picture (0 to 1). */
export function decodeStroke(points: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({
      x: (points[i] as number) / STROKE_GRID,
      y: (points[i + 1] as number) / STROKE_GRID,
    });
  }
  return out;
}

/** True when `p` (relative to the picture) is within `radius` of the stroke's line. */
export function strokeHit(stroke: Stroke, p: Point, radius: number): boolean {
  const pts = decodeStroke(stroke.points);
  const reach = radius + stroke.width / 2000;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceToSegment(p, pts[i] as Point, pts[i + 1] as Point) <= reach) return true;
  }
  return pts.length === 1 && Math.hypot(p.x - (pts[0]?.x ?? 0), p.y - (pts[0]?.y ?? 0)) <= reach;
}
