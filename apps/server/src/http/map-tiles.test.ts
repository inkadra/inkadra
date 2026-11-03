import type { FastifyReply, FastifyRequest } from 'fastify';
import { expect, it, vi } from 'vitest';
import type { Config } from '../config.ts';
import { fetchTile } from '../media/maps.ts';
import { createTileServer } from './map-tiles.ts';

vi.mock('../media/maps.ts', () => ({
  fetchTile: vi.fn(async () => Buffer.from('tile')),
  tileType: () => 'image/png',
  mapUserAgent: () => 'test',
  TilesBusy: class extends Error {},
}));
it('selects only a configured source, through the same tile fetcher', async () => {
  const config = {
    MAPS: true,
    PUBLIC_URL: 'http://localhost',
    MAP_TILE_URL: 'http://standard/{z}/{x}/{y}',
    MAP_SATELLITE_TILE_URL: 'http://satellite/{z}/{x}/{y}',
  } as Config;
  const serve = createTileServer(config);
  const req = (query: unknown) => ({ params: { z: '1', x: '0', y: '0' }, query }) as FastifyRequest;
  const reply = { header: vi.fn(), send: vi.fn() } as unknown as FastifyReply;
  await serve(req({}), reply, 'a');
  expect(fetchTile).toHaveBeenLastCalledWith(
    expect.objectContaining({ tileUrl: config.MAP_TILE_URL }),
    1,
    0,
    0,
    5000,
  );
  await serve(req({ layer: 'satellite' }), reply, 'a');
  expect(fetchTile).toHaveBeenLastCalledWith(
    expect.objectContaining({ tileUrl: config.MAP_SATELLITE_TILE_URL }),
    1,
    0,
    0,
    5000,
  );
  config.MAP_SATELLITE_TILE_URL = undefined;
  await expect(serve(req({ layer: 'satellite' }), reply, 'a')).rejects.toThrow(
    'Tile source not configured',
  );
  await expect(serve(req({ layer: 'https://untrusted.test' }), reply, 'a')).rejects.toThrow();
});
