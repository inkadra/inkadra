import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER } from '../auth.ts';
import { toHeaders } from './auth-routes.ts';

describe('toHeaders', () => {
  it('replaces any client-sent address header with the address Fastify resolved', () => {
    const req = {
      ip: '203.0.113.7',
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
