import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGzip, gzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const compress = promisify(gzip);

/** Compress text responses only. Stored downloads and collaboration never enter this hook. */
export function registerCompression(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    const staticText =
      req.url.startsWith('/assets/') &&
      /^(text\/(css|javascript)|application\/(javascript|json))\b/.test(type);
    const apiText =
      req.url.startsWith('/api/v1/') &&
      /^application\/json\b/.test(type) &&
      (typeof payload === 'string' || Buffer.isBuffer(payload));
    if (
      (!staticText && !apiText) ||
      req.method === 'HEAD' ||
      req.headers.range ||
      reply.statusCode === 206 ||
      reply.statusCode === 204 ||
      reply.statusCode === 304 ||
      reply.hasHeader('content-encoding') ||
      reply.hasHeader('content-disposition') ||
      /\bno-transform\b/.test(String(reply.getHeader('cache-control') ?? ''))
    )
      return payload;
    const vary = String(reply.getHeader('vary') ?? '');
    if (!/\baccept-encoding\b/i.test(vary))
      reply.header('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
    const encodings = (req.headers['accept-encoding'] ?? '').split(',').map((entry) => {
      const [name, ...parameters] = entry.trim().split(';');
      const quality = parameters.find((p) => p.trim().startsWith('q='));
      // Content codings are case-insensitive.
      return { name: name?.trim().toLowerCase(), q: quality ? Number(quality.trim().slice(2)) : 1 };
    });
    const accepted =
      encodings.find((e) => e.name === 'gzip') ?? encodings.find((e) => e.name === '*');
    if (!accepted || !(accepted.q > 0 && accepted.q <= 1)) return payload;
    if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
      if (Buffer.byteLength(payload) < 1024) return payload;
      const result = await compress(payload);
      reply.removeHeader('content-length');
      reply.header('content-encoding', 'gzip');
      return result;
    }
    if (staticText && payload instanceof Readable) {
      const result = createGzip();
      void pipeline(payload, result).catch(() => result.destroy());
      reply.removeHeader('content-length');
      reply.header('content-encoding', 'gzip');
      return result;
    }
    return payload;
  });
}
