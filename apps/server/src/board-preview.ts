import { createHash } from 'node:crypto';
import { FrameShape, roots, Stroke } from '@inkadra/doc-schema';
import type { BoardPreview } from '@inkadra/shared';
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

const cache = new Map<string, BoardPreview>();
export function projectPreview(state?: Uint8Array): BoardPreview {
  const key = state ? createHash('sha256').update(state).digest('hex') : '';
  const cached = cache.get(key);
  if (cached) return structuredClone(cached);
  const result: BoardPreview = { assetIds: [], excerpts: [], elementCount: 0, drawing: [] };
  if (!state) return result;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const elements = [...roots(doc).elements.entries()]
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
      // One actual frame drawing, bounded for dashboard use. Parse primitives before deriving SVG paths.
      if (result.drawing.length === 0 && el.get('type') === 'frame') {
        const strokes = el.get('strokes');
        const shapes = el.get('shapes');
        for (const value of (strokes instanceof Y.Array ? strokes.toArray() : []).slice(0, 24)) {
          const parsed = Stroke.safeParse(value);
          if (!parsed.success) continue;
          const stroke = parsed.data;
          const pairs = stroke.points.length / 2;
          const step = Math.max(1, Math.ceil(pairs / 128));
          const points: string[] = [];
          for (let i = 0; i < pairs; i += step)
            points.push(`${stroke.points[i * 2]} ${stroke.points[i * 2 + 1]}`);
          points.push(`${stroke.points.at(-2)} ${stroke.points.at(-1)}`);
          result.drawing.push({
            path: `M${points.join(' L')}`,
            color: stroke.color,
            width: stroke.width * 4.096,
          });
        }
        for (const value of (shapes instanceof Y.Array ? shapes.toArray() : []).slice(0, 8)) {
          const parsed = FrameShape.safeParse(value);
          if (!parsed.success) continue;
          const s = parsed.data;
          if (s.kind === 'text') {
            if (s.text && result.excerpts.length < 3) result.excerpts.push(s.text.slice(0, 160));
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
          result.drawing.push({ path, color: s.color, width: s.width * 4.096 });
        }
      }
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value ?? '');
    cache.set(key, structuredClone(result));
    return result;
  } finally {
    doc.destroy();
  }
}
