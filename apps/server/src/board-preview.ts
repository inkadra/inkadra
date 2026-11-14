import { createHash } from 'node:crypto';
import { frameLabels, listElements, storyboardOf } from '@inkadra/canvas-core';
import {
  aspectValue,
  contentCounts,
  FrameShape,
  getBoardAspect,
  readElement,
  roots,
  Stroke,
  UNSORTED,
} from '@inkadra/doc-schema';
import type { BoardCount, BoardPreview } from '@inkadra/shared';
import * as Y from 'yjs';

/** Plain text only: React escapes the projection, including user-authored rich text. */
function plain(value: unknown): string {
  if (value instanceof Y.XmlText || value instanceof Y.Text)
    return value
      .toDelta()
      .map((part: { insert: unknown }) => (typeof part.insert === 'string' ? part.insert : ''))
      .join('');
  if (value instanceof Y.XmlFragment || value instanceof Y.XmlElement)
    return value.toArray().map(plain).join(' ');
  return typeof value === 'string' ? value : '';
}

type PreviewPath = BoardPreview['drawing'][number];

/**
 * The pen drawing and shapes of a frame as SVG paths, at most `max` of them with at most
 * `points` points a stroke: parse primitives before deriving SVG paths. Texts go to `texts`.
 */
function drawingOf(el: Y.Map<unknown>, max: number, points: number, texts?: string[]) {
  const out: PreviewPath[] = [];
  const strokes = el.get('strokes');
  const shapes = el.get('shapes');
  for (const value of (strokes instanceof Y.Array ? strokes.toArray() : []).slice(0, max)) {
    const parsed = Stroke.safeParse(value);
    if (!parsed.success) continue;
    const stroke = parsed.data;
    const pairs = stroke.points.length / 2;
    const step = Math.max(1, Math.ceil(pairs / points));
    const line: string[] = [];
    for (let i = 0; i < pairs; i += step)
      line.push(`${stroke.points[i * 2]} ${stroke.points[i * 2 + 1]}`);
    line.push(`${stroke.points.at(-2)} ${stroke.points.at(-1)}`);
    out.push({ path: `M${line.join(' L')}`, color: stroke.color, width: stroke.width * 4.096 });
  }
  for (const value of (shapes instanceof Y.Array ? shapes.toArray() : []).slice(0, 8)) {
    if (out.length >= max + 8) break;
    const parsed = FrameShape.safeParse(value);
    if (!parsed.success) continue;
    const s = parsed.data;
    if (s.kind === 'text') {
      if (s.text) texts?.push(s.text.slice(0, 160));
      continue;
    }
    let path = `M${s.x0} ${s.y0} L${s.x1} ${s.y1}`;
    if (s.kind === 'rect') path = `M${s.x0} ${s.y0} H${s.x1} V${s.y1} H${s.x0} Z`;
    if (s.kind === 'ellipse') {
      const rx = Math.abs(s.x1 - s.x0) / 2,
        ry = Math.abs(s.y1 - s.y0) / 2;
      const cy = (s.y0 + s.y1) / 2;
      path = `M${s.x0} ${cy} A${rx} ${ry} 0 1 0 ${s.x1} ${cy} A${rx} ${ry} 0 1 0 ${s.x0} ${cy}`;
    }
    out.push({ path, color: s.color, width: s.width * 4.096 });
  }
  return out;
}

/** Card types the Review view does not list one by one (ClientReviewView). */
const NOT_REVIEWED = new Set(['arrow', 'column', 'scene', 'section', 'frame', 'board']);

export interface BoardProjection {
  preview: BoardPreview;
  /** What the Review view lists: the frames, or the cards when there are none. */
  reviewable: string[];
}

const cache = new Map<string, BoardProjection>();
export function projectBoard(state?: Uint8Array): BoardProjection {
  const key = state ? createHash('sha256').update(state).digest('hex') : '';
  const cached = cache.get(key);
  if (cached) return structuredClone(cached);
  const result: BoardPreview = { assetIds: [], excerpts: [], elementCount: 0, drawing: [] };
  if (!state) return { preview: result, reviewable: [] };
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const { elements: maps } = roots(doc);
    const elements = [...maps.entries()]
      .filter((entry): entry is [string, Y.Map<unknown>] => entry[1] instanceof Y.Map)
      .sort(
        ([a, x], [b, y]) =>
          Number(x.get('y') ?? 0) - Number(y.get('y') ?? 0) ||
          Number(x.get('x') ?? 0) - Number(y.get('x') ?? 0) ||
          a.localeCompare(b),
      );
    result.elementCount = elements.length;
    for (const [, el] of elements) {
      const id = el.get('assetId') ?? el.get('imageAssetId');
      if (typeof id === 'string' && !result.assetIds.includes(id) && result.assetIds.length < 4)
        result.assetIds.push(id);
      const text = ['body', 'title', 'caption', 'synopsis', 'label', 'action', 'dialogue']
        .map((k) => plain(el.get(k)))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
      if (text && result.excerpts.length < 3) result.excerpts.push(text);
      // The palette a moodboard shows: its colour cards, in reading order.
      const hex = el.get('hex');
      if (el.get('type') === 'color' && typeof hex === 'string' && /^#[0-9A-F]{6}$/i.test(hex)) {
        result.colors ??= [];
        if (result.colors.length < 6 && !result.colors.includes(hex)) result.colors.push(hex);
      }
      // One actual frame drawing, bounded for dashboard use.
      if (result.drawing.length === 0 && el.get('type') === 'frame') {
        const texts: string[] = [];
        result.drawing = drawingOf(el, 24, 128, texts);
        result.excerpts.push(...texts.slice(0, 3 - result.excerpts.length));
      }
    }
    // The storyboard's first frames, in shooting order, as its Storyboard and Shot list show them.
    const valid = listElements(doc);
    const groups = storyboardOf(valid);
    const labels = frameLabels(groups);
    const frames = groups.flatMap((g) => g.frames);
    const boardAspect = getBoardAspect(doc) ?? '16:9';
    if (frames.length > 0)
      result.frames = frames.slice(0, 5).map((f, i) => {
        const map = maps.get(f.id);
        return {
          label: (labels.get(f.id) ?? '').slice(0, 12),
          ...(f.shot ? { shot: f.shot } : {}),
          ...(f.lens ? { lens: f.lens } : {}),
          ratio: aspectValue(f.aspect ?? boardAspect),
          ...(i < 3 && f.assetId ? { assetId: f.assetId } : {}),
          drawing: i < 3 && map instanceof Y.Map ? drawingOf(map, 8, 48).slice(0, 12) : [],
        };
      });
    const reviewable = frames.length
      ? frames.map((f) => f.id)
      : valid.filter((el) => !NOT_REVIEWED.has(el.type)).map((el) => el.id);
    const projection = { preview: result, reviewable };
    if (cache.size >= 64) cache.delete(cache.keys().next().value ?? '');
    cache.set(key, structuredClone(projection));
    return projection;
  } finally {
    doc.destroy();
  }
}

/** The preview alone, for Home and the Projects page. */
export function projectPreview(state?: Uint8Array): BoardPreview {
  return projectBoard(state).preview;
}

const counts = new Map<string, Omit<BoardCount, 'boardId'>>();

/** Elements, storyboard frames and content of a stored document, for the navigation counts. */
export function boardCounts(state?: Uint8Array): Omit<BoardCount, 'boardId'> {
  const empty = contentCounts([]);
  if (!state) return empty;
  const key = createHash('sha256').update(state).digest('hex');
  const cached = counts.get(key);
  if (cached) return { ...cached };
  const doc = new Y.Doc();
  let result = empty;
  try {
    Y.applyUpdate(doc, state);
    result = docCounts(doc);
  } catch {
    return empty;
  } finally {
    doc.destroy();
  }
  if (counts.size >= 256) counts.delete(counts.keys().next().value ?? '');
  counts.set(key, result);
  return { ...result };
}

/** The navigation counts of a loaded document; stored with it so lists need not decode it. */
export function docCounts(doc: Y.Doc): ReturnType<typeof contentCounts> {
  return contentCounts(
    [...roots(doc).elements.values()]
      .filter((el) => el instanceof Y.Map)
      .map((el) => ({
        type: el.get('type'),
        status: el.get('status'),
        sceneIds: el.get('sceneIds'),
      })),
  );
}

/** An open item of a to-do list that someone is assigned to, as stored with the document. */
export interface OpenTask {
  elementId: string;
  itemId: string;
  text: string;
  assigneeId: string;
  dueDate?: string;
}

/** Every open assigned to-do item of a loaded document; stored with it (#803). */
export function openTasks(doc: Y.Doc): OpenTask[] {
  const result: OpenTask[] = [];
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (el?.type !== 'todo') continue;
    for (const item of el.items)
      if (!item.done && item.assigneeId)
        result.push({
          elementId: el.id,
          itemId: item.id,
          text: item.text,
          assigneeId: item.assigneeId,
          ...(item.dueDate ? { dueDate: item.dueDate } : {}),
        });
  }
  return result;
}

/** Cards directly in the unsorted tray of a loaded document; stored with it (#803). */
export function unsortedInDoc(doc: Y.Doc): { count: number; assetIds: string[] } {
  const result = { count: 0, assetIds: [] as string[] };
  const cards = [...roots(doc).elements.entries()]
    .filter(
      (entry): entry is [string, Y.Map<unknown>] =>
        entry[1] instanceof Y.Map && entry[1].get('parent') === UNSORTED,
    )
    .sort(([a], [b]) => a.localeCompare(b));
  result.count = cards.length;
  for (const [, el] of cards) {
    const id = el.get('assetId') ?? el.get('imageAssetId');
    if (typeof id === 'string' && !result.assetIds.includes(id) && result.assetIds.length < 4)
      result.assetIds.push(id);
  }
  return result;
}

const unsorted = new Map<string, { count: number; assetIds: string[] }>();

/**
 * Cards directly in the unsorted tray of a stored document, with their first images or videos
 * (unchecked ids: the route keeps only ready files of the board's project). For documents
 * stored since their last indexing; the others read `board_doc.unsorted`.
 */
export function unsortedOf(state?: Uint8Array): { count: number; assetIds: string[] } {
  if (!state) return { count: 0, assetIds: [] };
  const key = createHash('sha256').update(state).digest('hex');
  const cached = unsorted.get(key);
  if (cached) return structuredClone(cached);
  const doc = new Y.Doc();
  let result: { count: number; assetIds: string[] };
  try {
    Y.applyUpdate(doc, state);
    result = unsortedInDoc(doc);
  } catch {
    return { count: 0, assetIds: [] };
  } finally {
    doc.destroy();
  }
  if (unsorted.size >= 256) unsorted.delete(unsorted.keys().next().value ?? '');
  unsorted.set(key, structuredClone(result));
  return result;
}
