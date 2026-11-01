import { API_PREFIX, MapTileParams } from '@inkadra/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { fetchTile, mapUserAgent, TilesBusy, tileType } from '../media/maps.ts';
import { RateLimiter } from '../rate-limits.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

/** Tiles a person or guest may ask for in a minute: a few minutes of panning and zooming. */
const TILES_PER_MINUTE = 600;
/**
 * Longest an interactive map waits in the process-wide tile queue: past it the tile is refused
 * (429) and the map shows it blank, rather than piling up requests nobody looks at anymore.
 */
const MAX_QUEUE_MS = 5_000;

/**
 * The tiles of interactive maps (decision 0053): the server fetches them from the tile server of
 * the instance, through the same queue and cache as map pictures, so browsers and guests only
 * ever talk to Inkadra. `key` is whose budget the request spends (a person or a guest).
 */
export function createTileServer(config: Config) {
  const limiter = new RateLimiter(TILES_PER_MINUTE, 60_000);
  const userAgent = mapUserAgent(config.PUBLIC_URL);
  return async function serveTile(req: FastifyRequest, reply: FastifyReply, key: string) {
    if (!config.MAPS) throw new HttpError('not_found', 'Maps are off on this server.');
    const { z, x, y } = MapTileParams.parse(req.params);
    if (!limiter.take(key)) {
      reply.header('retry-after', limiter.retryAfterSeconds(key));
      throw new HttpError('rate_limited', 'Too many map tiles: wait a minute.');
    }
    let body: Buffer;
    try {
      body = await fetchTile({ tileUrl: config.MAP_TILE_URL, userAgent }, z, x, y, MAX_QUEUE_MS);
    } catch (err) {
      if (err instanceof TilesBusy) {
        reply.header('retry-after', '1');
        throw new HttpError('rate_limited', 'The map server is busy: try again.');
      }
      req.log.warn({ err }, 'map tile not fetched');
      throw new HttpError('not_found', 'Tile not available.');
    }
    // The tile server's bytes reach browsers: only real pictures, typed by their own bytes.
    const type = tileType(body);
    if (!type) throw new HttpError('not_found', 'Tile not available.');
    reply.header('content-type', type);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(body);
  };
}

export function registerMapTiles(
  app: FastifyInstance,
  deps: { config: Config; db: Database; auth: Auth },
) {
  const serveTile = createTileServer(deps.config);
  app.get(`${API_PREFIX}/map-tiles/:z/:x/:y`, async (req, reply) => {
    const actor = await requireActor(deps.auth, req, deps.db);
    return serveTile(req, reply, actor.id);
  });
}
