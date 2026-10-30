import type { IncomingMessage } from 'node:http';
import proxyAddr from '@fastify/proxy-addr';
import type { FastifyRequest } from 'fastify';

/** Private bridge metadata: always overwrite client input before passing to auth. */
export const ORIGIN_HEADER = 'x-inkadra-request-origin';
const origins = new WeakMap<IncomingMessage, string>();
const compilers = new Map<string, ReturnType<typeof proxyAddr.compile>>();

export function rawOrigin(req: IncomingMessage, trustProxy: boolean | string): string {
  const peer = req.socket.remoteAddress ?? '';
  let trusted = trustProxy === true;
  if (typeof trustProxy === 'string') {
    let compiled = compilers.get(trustProxy);
    if (!compiled) {
      compiled = proxyAddr.compile(trustProxy.split(',').map((s) => s.trim()));
      compilers.set(trustProxy, compiled);
    }
    trusted = compiled(peer, 0);
  }
  const last = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.split(',').at(-1)?.trim();
  const protocol = trusted ? last(req.headers['x-forwarded-proto']) : undefined;
  const scheme = protocol ?? ('encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = (trusted && last(req.headers['x-forwarded-host'])) || req.headers.host;
  if (!host || !['http', 'https'].includes(scheme) || /[\s/@\\?#]/.test(host))
    throw new Error('Invalid request origin');
  const url = new URL(`${scheme}://${host}`);
  if (url.pathname !== '/') throw new Error('Invalid request host');
  return url.origin;
}

export function rememberOrigin(req: IncomingMessage, trustProxy: boolean | string): string {
  const origin = rawOrigin(req, trustProxy);
  origins.set(req, origin);
  return origin;
}

export function requestOrigin(req: FastifyRequest): string {
  return origins.get(req.raw) ?? rawOrigin(req.raw, false);
}

export function allowedOrigin(origin: string, own: string, publicUrl: string): boolean {
  return origin === own || origin === new URL(publicUrl).origin;
}
