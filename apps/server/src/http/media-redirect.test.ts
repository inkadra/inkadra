import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import type { Storage } from '../storage.ts';
import { SIGNED_URL_TTL_S, sendRanged } from './assets-routes.ts';

// #839: with S3_PUBLIC_REDIRECT a browser gets the bucket's signed URL, a token client the bytes.
it('redirects browsers to the bucket and streams to token clients', async () => {
  const asked: unknown[] = [];
  const storage = {
    read: async () => Readable.from([Buffer.from('bytes')]),
    signedUrl: async (...args: unknown[]) => {
      asked.push(args);
      return 'https://files.example.com/inkadra/originals/a?X-Amz-Signature=s';
    },
  } as unknown as Storage;
  const app = Fastify();
  app.get('/f', (req, reply) => {
    reply.header('content-type', 'video/mp4');
    reply.header('content-disposition', 'inline; filename="a.mp4"');
    return sendRanged(req, reply, storage, 'originals/a', 5);
  });
  app.get('/kept', (req, reply) => sendRanged(req, reply, storage, 'renditions/a', 5, false));
  const browser = await app.inject({ url: '/f', headers: { range: 'bytes=0-1' } });
  expect(browser.statusCode).toBe(302);
  expect(browser.headers.location).toContain('https://files.example.com/');
  expect(browser.headers['cache-control']).toBe('private, no-store');
  expect(asked).toEqual([
    ['originals/a', SIGNED_URL_TTL_S, 'inline; filename="a.mp4"', 'video/mp4'],
  ]);
  // A guest who may not download a rung: the bytes, never a bucket link.
  const kept = await app.inject({ url: '/kept' });
  expect(kept.statusCode).toBe(200);
  expect(kept.body).toBe('bytes');
  const app2 = await app.inject({ url: '/f', headers: { authorization: 'Bearer ink_x' } });
  expect(app2.statusCode).toBe(200);
  expect(app2.body).toBe('bytes');
  await app.close();
});
