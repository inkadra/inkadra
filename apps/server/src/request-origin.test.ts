import type { IncomingMessage } from 'node:http';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { toHeaders } from './http/auth-routes.ts';
import { allowedOrigin, ORIGIN_HEADER, rawOrigin, rememberOrigin } from './request-origin.ts';

const request = (peer: string, headers: Record<string, string>) =>
  ({ socket: { remoteAddress: peer }, headers }) as unknown as IncomingMessage;

describe('request origin boundary', () => {
  it.each(['192.168.1.31:7340', 'soyo:7340', 'soyo.tail63f63d.ts.net:7340', '[::1]:7340'])(
    'accepts direct HTTP at %s with no address registration',
    (host) => {
      expect(rawOrigin(request('192.168.1.20', { host }), false)).toBe(`http://${host}`);
    },
  );
  it('trusts forwarded protocol and host only from the configured immediate peer', () => {
    const headers = {
      host: 'soyo:3000',
      'x-forwarded-host': 'boards.example.test',
      'x-forwarded-proto': 'https',
    };
    expect(rawOrigin(request('172.18.0.5', headers), '172.18.0.0/16')).toBe(
      'https://boards.example.test',
    );
    expect(rawOrigin(request('203.0.113.2', headers), '172.18.0.0/16')).toBe('http://soyo:3000');
  });
  it('accepts only canonical or request origins', () => {
    expect(
      allowedOrigin('http://soyo:7340', 'http://soyo:7340', 'https://boards.example.test'),
    ).toBe(true);
    for (const origin of ['https://evil.test', 'null', 'http://other:7340'])
      expect(allowedOrigin(origin, 'http://soyo:7340', 'https://boards.example.test')).toBe(false);
  });
  it('overwrites private metadata and removes forwarded headers at the auth boundary', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      rememberOrigin(req.raw, false);
    });
    app.get('/', (req) => Object.fromEntries(toHeaders(req)));
    try {
      const response = await app.inject({
        headers: {
          host: 'soyo:7340',
          [ORIGIN_HEADER]: 'https://evil.test',
          'x-forwarded-proto': 'https',
        },
      });
      expect(response.json()[ORIGIN_HEADER]).toBe('http://soyo:7340');
      expect(response.json()['x-forwarded-proto']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
