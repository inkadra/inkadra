import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { type Auth, CLIENT_IP_HEADER } from '../auth.ts';
import { registerAuthRoutes, toHeaders } from './auth-routes.ts';

describe('toHeaders', () => {
  it('replaces any client-sent address header with the address Fastify resolved', () => {
    const req = {
      ip: '203.0.113.7',
      raw: { socket: { remoteAddress: '203.0.113.7' }, headers: { host: 'soyo:7340' } },
      headers: { [CLIENT_IP_HEADER]: '1.2.3.4', 'x-forwarded-for': '9.9.9.9', cookie: 'a=b' },
    } as unknown as FastifyRequest;
    const headers = toHeaders(req);
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7');
    expect(headers.get('cookie')).toBe('a=b');
  });
});

describe('client address', () => {
  it('ignores X-Forwarded-For from untrusted peers and reads it from the proxy', async () => {
    const { default: Fastify } = await import('fastify');
    const app = Fastify({ trustProxy: 'loopback,linklocal,uniquelocal' });
    app.get('/', (req) => req.ip);
    const spoof = { 'x-forwarded-for': '6.6.6.6' };
    const direct = await app.inject({ url: '/', headers: spoof, remoteAddress: '203.0.113.9' });
    const viaProxy = await app.inject({ url: '/', headers: spoof, remoteAddress: '172.18.0.5' });
    expect(direct.body).toBe('203.0.113.9');
    expect(viaProxy.body).toBe('6.6.6.6');
  });
});

it('checks auth write origins even without cookies, preserving native clients and canonical origin', async () => {
  const app = Fastify();
  const handler = vi.fn(async () => new Response('{}'));
  registerAuthRoutes(app, { handler } as unknown as Auth, 'https://boards.example.test');
  try {
    for (const [headers, status] of [
      [{ origin: 'https://evil.test' }, 403],
      [{ origin: 'null' }, 403],
      [{ 'sec-fetch-site': 'cross-site' }, 403],
      [{ origin: 'http://soyo:7340' }, 200],
      [{ origin: 'https://boards.example.test' }, 200],
      [{}, 200],
      [{ 'sec-fetch-site': 'same-origin' }, 200],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { host: 'soyo:7340', ...headers },
        payload: {},
      });
      expect(res.statusCode).toBe(status);
    }
    expect(handler).toHaveBeenCalledTimes(4);
    expect(
      (await app.inject({ url: '/api/auth/get-session', headers: { origin: 'https://evil.test' } }))
        .statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
