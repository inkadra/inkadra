import sharp from 'sharp';
import { VERSION } from '../config.ts';
import type { TrackPoint } from './gpx.ts';

/**
 * Static map pictures (decision 0053): the server fetches the tiles around a place or a route
 * from the tile server of the instance, once, and composites them into one image that is
 * stored as an asset. Viewers, guests and exports only ever load that image.
 */

export const TILE = 256;
/**
 * Size of a view, in pixels of its zoom: the 1.83 : 1 of the cards in the mockup. Routes, `MapView`
 * and the web app all count in these pixels, so a picture of any resolution lines up with them.
 */
export const MAP_WIDTH = 1024;
export const MAP_HEIGHT = 560;
/** Size of the stored picture: the ground of a view, one tile zoom closer. */
export const PICTURE_WIDTH = MAP_WIDTH * 2;
export const PICTURE_HEIGHT = MAP_HEIGHT * 2;
const MAX_ZOOM = 17;
/** The closest tiles asked for, as in `MapTileParams`, and the highest of the default server. */
const MAX_TILE_ZOOM = 19;
/** Room left around a route, in pixels of the picture. */
const PAD = 72;
/** Points of the line drawn over a route's picture. */
const MAX_LINE_POINTS = 512;

export interface MapSettings {
  /** `{z}`, `{x}` and `{y}` are replaced; set by the administrator, so it may be on the LAN. */
  tileUrl: string;
  /** Sent to the tile server, as the OpenStreetMap tile policy asks. */
  userAgent: string;
}

export function mapUserAgent(publicUrl: string): string {
  return `Inkadra/${VERSION} (+${publicUrl})`;
}

/** Web Mercator: world pixels at `zoom` of a point. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** The view of a picture: its top-left corner in world pixels at `zoom`. */
export interface MapView {
  zoom: number;
  left: number;
  top: number;
}

export function viewAround(lat: number, lon: number, zoom: number): MapView {
  const c = project(lat, lon, zoom);
  return { zoom, left: c.x - MAP_WIDTH / 2, top: c.y - MAP_HEIGHT / 2 };
}

/** The closest view that shows every point with some room around it. */
export function viewOf(points: readonly TrackPoint[]): MapView {
  // Mercator keeps the order of latitudes and longitudes: the corners of the box are enough.
  // A loop, not Math.min(...points): a spread of 200,000 points overflows the stack.
  let [south, north, west, east] = [90, -90, 180, -180];
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  let zoom = MAX_ZOOM;
  for (; zoom > 1; zoom--) {
    const a = project(north, west, zoom);
    const b = project(south, east, zoom);
    if (b.x - a.x <= MAP_WIDTH - 2 * PAD && b.y - a.y <= MAP_HEIGHT - 2 * PAD) break;
  }
  const a = project(north, west, zoom);
  const b = project(south, east, zoom);
  return {
    zoom,
    left: (a.x + b.x) / 2 - MAP_WIDTH / 2,
    top: (a.y + b.y) / 2 - MAP_HEIGHT / 2,
  };
}

/**
 * The route as x, y pairs in fractions of the picture, without points closer than a pixel
 * to the last kept one and thinned evenly to at most 512 points. Segments are joined.
 */
export function routeLine(segments: readonly TrackPoint[][], view: MapView): number[] {
  const kept: Array<[number, number]> = [];
  for (const p of segments.flat()) {
    const w = project(p.lat, p.lon, view.zoom);
    const x = w.x - view.left;
    const y = w.y - view.top;
    const last = kept[kept.length - 1];
    if (last && Math.abs(last[0] - x) < 1 && Math.abs(last[1] - y) < 1) continue;
    kept.push([x, y]);
  }
  const step = Math.max(1, (kept.length - 1) / (MAX_LINE_POINTS - 1));
  const out: number[] = [];
  for (let i = 0; i < Math.min(kept.length, MAX_LINE_POINTS); i++) {
    const [x, y] = kept[Math.min(kept.length - 1, Math.round(i * step))] as [number, number];
    const fx = Math.min(1, Math.max(0, x / MAP_WIDTH));
    const fy = Math.min(1, Math.max(0, y / MAP_HEIGHT));
    out.push(Math.round(fx * 10_000) / 10_000, Math.round(fy * 10_000) / 10_000);
  }
  return out;
}

/**
 * Tiles of `width` × `height` pixels from the corner of a view, as [x, y] at its zoom; x wraps
 * around the world, y stays inside it.
 */
export function tilesOf(
  view: MapView,
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): Array<{ x: number; y: number; dx: number; dy: number }> {
  const n = 2 ** view.zoom;
  const x0 = Math.floor(view.left / TILE);
  const y0 = Math.floor(view.top / TILE);
  const x1 = Math.floor((view.left + width - 1) / TILE);
  const y1 = Math.floor((view.top + height - 1) / TILE);
  const out: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = x0; tx <= x1; tx++)
      out.push({ x: ((tx % n) + n) % n, y: ty, dx: (tx - x0) * TILE, dy: (ty - y0) * TILE });
  }
  return out;
}

const TILE_MAX_BYTES = 1024 * 1024;
const TILE_TIMEOUT_MS = 10_000;

/**
 * The body of a response, refused past `max` bytes: by its declared length before reading,
 * else as it streams in. Shared by the tile server and the geocoder.
 */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel();
    throw new Error('Response too large.');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body)
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > max) throw new Error('Response too large.');
      chunks.push(chunk);
    }
  return Buffer.concat(chunks);
}

/** Tiles requested per second by this process, whatever the number of maps being made. */
const TILES_PER_SECOND = 6;
let nextSlot = 0;

/** Thrown when the queue of tile requests is longer than a caller is willing to wait. */
export class TilesBusy extends Error {}

/** Thrown when the tile server has no such tile: usually a zoom past its closest one. */
class TileMissing extends Error {}

/**
 * Waits for this request's turn: requests are spaced evenly, in the order they asked. A caller
 * that cannot wait long (an interactive map) gives up without taking a turn.
 */
async function tileSlot(maxWaitMs = Infinity): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  if (at - now > maxWaitMs) throw new TilesBusy('Too many tile requests.');
  nextSlot = at + 1000 / TILES_PER_SECOND;
  if (at > now) await new Promise((done) => setTimeout(done, at - now));
}

/**
 * Tiles fetched lately, by address, least recently used first: a map made again (a retried
 * job, a second card of the same place) asks the tile server for nothing.
 */
const tileCache = new Map<string, Buffer>();
const CACHE_ENTRIES = 400;
const CACHE_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

function remember(url: string, body: Buffer) {
  tileCache.set(url, body);
  cacheBytes += body.length;
  for (const [key, old] of tileCache) {
    if (tileCache.size <= CACHE_ENTRIES && cacheBytes <= CACHE_BYTES) break;
    tileCache.delete(key);
    cacheBytes -= old.length;
  }
}

/** The image type of a tile from its first bytes: PNG, JPEG or WebP, else null. */
export function tileType(body: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/**
 * One tile, from the cache or the tile server, through the process-wide queue. `maxWaitMs`
 * refuses (TilesBusy) rather than queue longer than that.
 */
export async function fetchTile(
  settings: MapSettings,
  z: number,
  x: number,
  y: number,
  maxWaitMs?: number,
) {
  const url = settings.tileUrl
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  const cached = tileCache.get(url);
  if (cached) {
    // Most recently used goes last.
    tileCache.delete(url);
    tileCache.set(url, cached);
    return cached;
  }
  await tileSlot(maxWaitMs);
  const res = await fetch(url, {
    headers: { 'user-agent': settings.userAgent, accept: 'image/png,image/*' },
    // The administrator's address is the one fetched: a redirect could lead anywhere.
    redirect: 'error',
    signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
  });
  if (res.status === 404) throw new TileMissing(`Tile ${z}/${x}/${y}: HTTP 404`);
  if (!res.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/'))
    throw new Error(`Tile ${z}/${x}/${y} is not an image.`);
  const body = await readCapped(res, TILE_MAX_BYTES);
  remember(url, body);
  return body;
}

/**
 * The picture of a view, as PNG. Tiles are fetched four at a time, at most six a second for
 * the whole process, and kept in a small cache; a view whose tiles do not all arrive fails,
 * rather than store a map with holes.
 * shortcut: the cache is in memory and per process; share one (Valkey) if several workers
 * make many maps of the same area.
 *
 * The picture is twice the pixels of its view, from tiles one zoom closer: the same ground, so
 * routes and pins stay where they were. Where that zoom does not exist (the closest view, or a
 * tile server that stops earlier) the view's own tiles are enlarged to the same size.
 */
export async function renderMap(settings: MapSettings, view: MapView): Promise<Buffer> {
  if (view.zoom < MAX_TILE_ZOOM) {
    const closer = { zoom: view.zoom + 1, left: view.left * 2, top: view.top * 2 };
    try {
      return await composite(settings, closer, PICTURE_WIDTH, PICTURE_HEIGHT);
    } catch (err) {
      if (!(err instanceof TileMissing)) throw err;
    }
  }
  return sharp(await composite(settings, view, MAP_WIDTH, MAP_HEIGHT))
    .resize(PICTURE_WIDTH, PICTURE_HEIGHT)
    .png()
    .toBuffer();
}

/** `width` × `height` pixels from the corner of a view, composited from its tiles. */
async function composite(
  settings: MapSettings,
  view: MapView,
  width: number,
  height: number,
): Promise<Buffer> {
  const tiles = tilesOf(view, width, height);
  const images: Buffer[] = [];
  for (let i = 0; i < tiles.length; i += 4) {
    const batch = tiles.slice(i, i + 4);
    images.push(...(await Promise.all(batch.map((t) => fetchTile(settings, view.zoom, t.x, t.y)))));
  }
  const x0 = Math.floor(view.left / TILE);
  const y0 = Math.floor(view.top / TILE);
  const cols = Math.floor((view.left + width - 1) / TILE) - x0 + 1;
  const rows = Math.floor((view.top + height - 1) / TILE) - y0 + 1;
  // Each tile is decoded and re-encoded raw first: a tile is untrusted bytes too, and sharp
  // rejects anything that is not a real picture of the tile's size.
  const layers = await Promise.all(
    tiles.map(async (t, i) => ({
      input: await sharp(images[i], { failOn: 'error', limitInputPixels: 1024 * 1024 })
        .resize(TILE, TILE, { fit: 'fill' })
        .png()
        .toBuffer(),
      left: t.dx,
      top: t.dy,
    })),
  );
  const mosaic = await sharp({
    create: {
      width: cols * TILE,
      height: rows * TILE,
      channels: 3,
      background: { r: 236, g: 234, b: 229 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
  return sharp(mosaic)
    .extract({
      left: Math.round(view.left - x0 * TILE),
      top: Math.round(view.top - y0 * TILE),
      width,
      height,
    })
    .png()
    .toBuffer();
}
