import {
  API_PREFIX,
  CreateMapPreview,
  isShortMapLink,
  type MapPlace,
  type MapPreview,
  parseMapLink,
} from '@inkadra/shared';
import type { FastifyInstance } from 'fastify';
import { requireWriteAccess } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import type { Jobs } from '../jobs.ts';
import { mapUserAgent, readCapped, renderMap, viewAround } from '../media/maps.ts';
import { ENQUEUE_TIMEOUT_MS, within } from '../queues.ts';
import { RateLimiter } from '../rate-limits.ts';
import { FetchRefused, safeFetch } from '../safe-fetch.ts';
import type { Storage } from '../storage.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { saveFetchedImage } from './link-previews.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
  /** Tests only: addresses short links may resolve to besides public ones. */
  allowAddresses?: string[];
}

/** Zoom of a place found by address: a street and its block. */
const ADDRESS_ZOOM = 16;

/**
 * The first match of a Nominatim-compatible geocoder, or null. The address leaves the server
 * only here, when someone asked for a map of it, and only to the geocoder the administrator set.
 */
async function geocode(endpoint: string, query: string, userAgent: string, language?: string) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, {
    headers: {
      'user-agent': userAgent,
      accept: 'application/json',
      ...(language ? { 'accept-language': language } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const text = (await readCapped(res, 256 * 1024)).toString('utf8');
  const [first] = JSON.parse(text) as Array<{
    lat?: unknown;
    lon?: unknown;
    display_name?: unknown;
  }>;
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    return null;
  const place: MapPlace = { lat, lon, zoom: ADDRESS_ZOOM };
  if (typeof first?.display_name === 'string') place.name = first.display_name.slice(0, 200);
  return place;
}

export function registerMapPreviews(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, storage, jobs } = deps;
  // Each preview can fetch a short link, a geocoder answer and about twenty tiles.
  const limiter = new RateLimiter(20, 60_000);
  const allowAddresses = deps.allowAddresses ?? [];
  const userAgent = mapUserAgent(config.PUBLIC_URL);

  app.post(`${API_PREFIX}/map-previews`, async (req): Promise<MapPreview> => {
    const actor = await requireActor(auth, req, db);
    const input = CreateMapPreview.parse(req.body);
    await requireWriteAccess(db, actor, input.projectId, input.boardId);
    if (!limiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many map previews: wait a minute.');

    let url = input.url ?? null;
    let place = url ? parseMapLink(url) : null;
    if (url && !place && isShortMapLink(url)) {
      // A short link holds nothing until it is followed, like any pasted link's preview.
      try {
        const page = await safeFetch(url, {
          accept: ['text/html', 'application/xhtml+xml'],
          maxBytes: 64 * 1024,
          truncate: true,
          maxRedirects: 5,
          allowAddresses,
        });
        url = page.url;
        place = parseMapLink(page.url);
      } catch (err) {
        if (!(err instanceof FetchRefused)) throw err;
      }
    }
    if (!place && input.query && config.MAP_GEOCODER_URL)
      place = await geocode(
        config.MAP_GEOCODER_URL,
        input.query,
        userAgent,
        req.headers['accept-language'],
      ).catch((err) => {
        req.log.warn({ err }, 'geocoder did not answer');
        return null;
      });

    let imageAssetId: string | null = null;
    if (place && config.MAPS) {
      try {
        const png = await renderMap(
          { tileUrl: config.MAP_TILE_URL, userAgent },
          viewAround(place.lat, place.lon, place.zoom ?? ADDRESS_ZOOM),
        );
        const sourceUrl =
          url ??
          `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=${place.zoom ?? ADDRESS_ZOOM}/${place.lat}/${place.lon}`;
        imageAssetId = await saveFetchedImage(
          { db, storage },
          { url: sourceUrl, contentType: 'image/png', body: png },
          { projectId: input.projectId, actorId: actor.id, sourceUrl, filename: 'map.png' },
        );
      } catch (err) {
        // The card still has its place and link.
        req.log.warn({ err }, 'map picture not made');
      }
    }
    if (imageAssetId)
      await within(
        jobs.processAsset(imageAssetId),
        ENQUEUE_TIMEOUT_MS,
        'The job queue did not answer.',
      ).catch((err) => req.log.error({ err, id: imageAssetId }, 'map picture not queued'));
    return {
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      zoom: place ? (place.zoom ?? ADDRESS_ZOOM) : null,
      name: place?.name ?? null,
      url,
      imageAssetId,
    };
  });
}
