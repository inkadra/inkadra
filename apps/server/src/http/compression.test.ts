import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerCompression } from './compression.ts';

it('negotiates gzip for JSON and static text, preserving downloads and streams', async () => {
  const app = Fastify();
  registerCompression(app);
  const body = 'x'.repeat(2048);
  app.get('/api/v1/test', () => ({ body }));
  app.get('/assets/app.js', (_, reply) =>
    reply.type('application/javascript').send(Readable.from(body)),
  );
  app.get('/api/v1/download', (_, reply) =>
    reply.type('application/json').send(Readable.from(body)),
  );
  app.get('/assets/image.png', (_, reply) => reply.type('image/png').send(body));
  try {
    for (const path of ['/api/v1/test', '/assets/app.js']) {
      const res = await app.inject({ url: path, headers: { 'accept-encoding': 'gzip' } });
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(res.rawPayload).toString()).toContain(body);
      expect(res.headers.vary).toContain('Accept-Encoding');
      for (const headers of [
        { 'accept-encoding': 'gzip;q=0, *;q=1' },
        { 'accept-encoding': 'gzip', range: 'bytes=0-9' },
      ]) {
        expect(
          (await app.inject({ url: path, headers })).headers['content-encoding'],
        ).toBeUndefined();
      }
    }
    for (const url of ['/api/v1/download', '/assets/image.png']) {
      expect(
        (await app.inject({ url, headers: { 'accept-encoding': 'gzip' } })).headers[
          'content-encoding'
        ],
      ).toBeUndefined();
    }
  } finally {
    await app.close();
  }
});
