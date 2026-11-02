import {
  API_PREFIX,
  CreateMapPreview,
  isShortMapLink,
  type MapPreview,
  type MapSearchPlace,
  type MapSearchResults,
  parseMapLink,
  SearchMapPlaces,
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
export async function geocode(
  endpoint: string,
  query: string,
  userAgent: string,
  language?: string,
) {
  return (await searchMapPlaces(endpoint, query, userAgent, language, 1))[0] ?? null;
}

export async function searchMapPlaces(
  endpoint: string,
  query: string,
  userAgent: string,
  language?: string,
  limit = 5,
): Promise<MapSearchPlace[]> {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, {
    headers: {
      'user-agent': userAgent,
      accept: 'application/json',
      ...(language ? { 'accept-language': language } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('Geocoder did not answer.');
  const text = (await readCapped(res, 256 * 1024)).toString('utf8');
  const results: unknown = JSON.parse(text);
  if (!Array.isArray(results)) throw new Error('Invalid geocoder response.');
  const coordinate = (value: unknown) =>
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
      ? Number(value)
      : Number.NaN;
  const places: MapSearchPlace[] = [];
  for (const result of results.slice(0, limit)) {
    if (!result || typeof result !== 'object') continue;
    const lat = coordinate(result.lat);
    const lon = coordinate(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
      continue;
    const name =
      typeof result.display_name === 'string' ? result.display_name.trim().slice(0, 200) : '';
    places.push({
      lat,
      lon,
      zoom: ADDRESS_ZOOM,
      name: name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    });
  }
  return places;
}

export function registerMapPreviews(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, storage, jobs } = deps;
  // Each preview can fetch a short link, a geocoder answer and about twenty tiles.
  const limiter = new RateLimiter(20, 60_000);
  const allowAddresses = deps.allowAddresses ?? [];
  const userAgent = mapUserAgent(config.PUBLIC_URL);

  const searchLimiter = new RateLimiter(60, 60_000);
  app.post(`${API_PREFIX}/map-search`, async (req): Promise<MapSearchResults> => {
    const actor = await requireActor(auth, req, db);
    const input = SearchMapPlaces.parse(req.body);
    await requireWriteAccess(db, actor, input.projectId, input.boardId);
    if (!searchLimiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many address searches: wait a minute.');
    if (!config.MAP_GEOCODER_URL)
      throw new HttpError('bad_request', 'Address search is not configured.');
    if (new URL(config.MAP_GEOCODER_URL).hostname === 'nominatim.openstreetmap.org')
      throw new HttpError(
        'bad_request',
        'This geocoder does not allow autocomplete. Configure a compatible provider.',
      );
    try {
      return {
        items: await searchMapPlaces(
          config.MAP_GEOCODER_URL,
          input.query,
          userAgent,
          req.headers['accept-language'],
        ),
      };
    } catch (err) {
      req.log.warn({ err }, 'geocoder did not answer');
      throw new HttpError('bad_request', 'Address search is unavailable.');
    }
  });

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
