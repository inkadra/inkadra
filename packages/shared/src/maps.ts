// SPDX-License-Identifier: MPL-2.0
import { Id, z } from './common.ts';

/** A place read from a map link: coordinates, and the zoom and name when the link has them. */
export interface MapPlace {
  lat: number;
  lon: number;
  zoom?: number;
  name?: string;
}

const MAP_HOSTS =
  /^(?:(?:www\.|maps\.)?google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl|maps\.apple\.com|maps\.apple|(?:www\.)?openstreetmap\.org|osm\.org)$/;

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

/** True for a Google Maps, Apple Maps or OpenStreetMap link, short links included. */
export function isMapLink(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = hostOf(url);
    if (!MAP_HOSTS.test(host)) return false;
    if (host === 'goo.gl') return url.pathname.startsWith('/maps');
    if (/google\./.test(host) && !host.startsWith('maps.')) return url.pathname.startsWith('/maps');
    return true;
  } catch {
    return false;
  }
}

/** Short links that only a redirect turns into coordinates. */
export function isShortMapLink(raw: string): boolean {
  try {
    const host = hostOf(new URL(raw.trim()));
    return host === 'maps.app.goo.gl' || host === 'goo.gl';
  } catch {
    return false;
  }
}

function place(lat: number, lon: number, zoom?: number, name?: string): MapPlace | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const out: MapPlace = { lat, lon };
  if (zoom !== undefined && Number.isFinite(zoom))
    out.zoom = Math.min(19, Math.max(1, Math.round(zoom)));
  const clean = name?.replace(/\+/g, ' ').trim();
  if (clean) out.name = clean.slice(0, 200);
  return out;
}

const pair = (text: string | null) => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text ?? '');
  return m ? ([Number(m[1]), Number(m[2])] as const) : null;
};

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The place a map link points at, read from the link alone (no request): Google Maps
 * (`/@lat,lon,15z`, `!3d…!4d…`, `?q=lat,lon`), Apple Maps (`ll=`, `q=`) and OpenStreetMap
 * (`mlat`/`mlon`, `#map=zoom/lat/lon`). Null for short links and links without coordinates.
 */
export function parseMapLink(raw: string): MapPlace | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!isMapLink(raw)) return null;
  const host = hostOf(url);
  const q = url.searchParams;
  if (host.includes('openstreetmap') || host === 'osm.org') {
    const hash = /map=(\d+)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
    const mlat = q.get('mlat');
    const mlon = q.get('mlon');
    if (mlat && mlon) return place(Number(mlat), Number(mlon), hash ? Number(hash[1]) : 16);
    if (hash) return place(Number(hash[2]), Number(hash[3]), Number(hash[1]));
    return null;
  }
  if (host.startsWith('maps.apple')) {
    const ll = pair(q.get('ll')) ?? pair(q.get('coordinate')) ?? pair(q.get('q'));
    const z = q.get('z');
    const name = q.get('q') && !pair(q.get('q')) ? (q.get('q') ?? undefined) : undefined;
    return ll ? place(ll[0], ll[1], z ? Number(z) : 16, name ?? q.get('name') ?? undefined) : null;
  }
  // Google Maps.
  const path = decode(url.pathname);
  const named = /\/maps\/place\/([^/]+)/.exec(path)?.[1];
  const name = named && !pair(named) ? named : undefined;
  // The pin of a place (!3d lat !4d lon) is more precise than the centre of the view (@).
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(path);
  const zoom = at?.[3] ? Number(at[3]) : 16;
  if (pin) return place(Number(pin[1]), Number(pin[2]), zoom, name);
  const query =
    pair(q.get('q')) ?? pair(q.get('query')) ?? pair(q.get('ll')) ?? pair(q.get('center'));
  if (query) return place(query[0], query[1], q.get('z') ? Number(q.get('z')) : 16, name);
  if (at) return place(Number(at[1]), Number(at[2]), zoom, name);
  return null;
}

/** Body of POST /api/v1/map-previews: a map link or an address, one of the two. */
export const CreateMapPreview = z
  .object({
    projectId: Id.openapi({ description: 'Project that will own the map picture.' }),
    boardId: Id.optional().openapi({ description: 'As in UploadMetadata.' }),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .optional()
      .openapi({
        description: 'A Google Maps, Apple Maps or OpenStreetMap link.',
      }),
    query: z.string().trim().min(1).max(500).optional().openapi({
      description: 'An address, looked up with the geocoder of the instance when it has one.',
    }),
  })
  .refine((b) => (b.url === undefined) !== (b.query === undefined), {
    message: 'Send either url or query.',
  })
  .openapi('CreateMapPreview');
export type CreateMapPreview = z.infer<typeof CreateMapPreview>;

export const MapPreview = z
  .object({
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    zoom: z.int().min(1).max(19).nullable(),
    name: z.string().max(200).nullable().openapi({
      description: 'The place name in the link, or the address the geocoder found.',
    }),
    url: z.url().nullable().openapi({ description: 'The link after redirects (short links).' }),
    imageAssetId: Id.nullable().openapi({
      description:
        'The map around the place, composited by the server from the tile server of the ' +
        'instance and stored as an image asset of the project. Null when maps are off, or the ' +
        'place has no coordinates.',
    }),
  })
  .openapi('MapPreview');
export type MapPreview = z.infer<typeof MapPreview>;

const tileNumber = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,5})$/)
  .transform(Number);

/**
 * Path of the map tile routes (decision 0053): whole numbers, `z` from 1 to 19, `x` and `y`
 * inside the world at that zoom (0 to 2^z − 1).
 */
export const MapTileParams = z
  .object({ z: tileNumber, x: tileNumber, y: tileNumber })
  .refine((t) => t.z >= 1 && t.z <= 19 && t.x < 2 ** t.z && t.y < 2 ** t.z, {
    message: 'No such tile.',
  });
export type MapTileParams = z.infer<typeof MapTileParams>;
