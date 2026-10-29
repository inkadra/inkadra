import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { checkSameOrigin, registerCsrfCheck } from './csrf.ts';

const publicUrl = 'https://boards.example.test/';
const origin = 'https://boards.example.test';
const app = Fastify();
registerCsrfCheck(app, publicUrl);
app.route({
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'],
  url: '/api/v1/write',
  handler: () => ({ ok: true }),
});
app.post('/api/v1/guest/links/:id/session', () => ({ ok: true }));
app.post('/api/v1', () => ({ ok: true }));
app.post('/api/auth/write', () => ({ ok: true }));
app.get('/origin', (req) => ({ allowed: checkSameOrigin(req, publicUrl) }));
afterAll(() => app.close());

describe('same-origin writes', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'] as const)(
    'checks %s for both HTTP and HTTPS session cookies',
    async (method) => {
      for (const cookie of [
        'inkadra.session_token=test',
        '__Host-inkadra.session_token=test',
        'other=value; __Secure-inkadra.session_token=test',
      ]) {
        for (const source of [
          undefined,
          'null',
          'https://sibling.example.test',
          'https://boards.example.test.evil.test',
          `${origin}/`,
        ]) {
          expect(
            (
              await app.inject({
                method,
                url: '/api/v1/write',
                headers: { cookie, ...(source ? { origin: source } : {}) },
              })
            ).statusCode,
          ).toBe(403);
        }
        expect(
          (await app.inject({ method, url: '/api/v1/write', headers: { cookie, origin } }))
            .statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method,
              url: '/api/v1/write',
              headers: { cookie, 'sec-fetch-site': 'same-origin' },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method,
              url: '/api/v1/write',
              headers: { cookie, origin: 'null', 'sec-fetch-site': 'same-origin' },
            })
          ).statusCode,
        ).toBe(403);
      }
    },
  );
  it('covers unauthenticated guest session opening, including bearer requests', async () => {
    for (const headers of [{}, { authorization: 'Bearer test' }, { cookie: 'guest=test' }]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/guest/links/test/session', headers }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/guest/links/test/session',
            headers: { ...headers, origin },
          })
        ).statusCode,
      ).toBe(200);
    }
  });
  it('uses the matched route for encoded account and guest paths; unmatched paths never run handlers', async () => {
    for (const [canonical, headers] of [
      ['/api/v1/write', { cookie: 'inkadra.session_token=test' }],
      ['/api/v1/guest/links/test/session', {}],
    ] as const) {
      const paths = [
        canonical,
        canonical.replace('/api/', '/%61pi/'),
        canonical.replace('/v1/', '/v%31/'),
        canonical.replace('/write', '/%77rite').replace('/guest/', '/%67uest/'),
        canonical.replace('/api/', '/%2561pi/'),
        canonical.replace('/v1/', '/v%2531/'),
        canonical.replace('/guest/', '/%2567uest/').replace('/write', '/%2577rite'),
        `${canonical}/`,
        canonical.replace('/api/', '/API/'),
        canonical.replace('/v1/', '/V1/'),
        canonical.replace('/guest/', '/Guest/').replace('/write', '/WRITE'),
      ];
      for (const [index, url] of paths.entries()) {
        const same = await app.inject({ method: 'POST', url, headers: { ...headers, origin } });
        const cross = await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, origin: 'https://evil.example.test' },
        });
        expect(same.statusCode, url).toBe(index < 4 ? 200 : 404);
        expect(cross.statusCode, url).toBe(same.statusCode === 200 ? 403 : 404);
      }
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1',
          headers: { cookie: 'inkadra.session_token=test', origin: 'https://evil.example.test' },
        })
      ).statusCode,
    ).toBe(403);
    for (const cookie of ['inkadra.session_token=test', '__Secure-inkadra.session_token=test']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/%61pi/v1/write',
            headers: { cookie, authorization: 'Bearer test', origin: 'https://evil.example.test' },
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  it('protects case/trailing-slash aliases when the router enables them', async () => {
    const aliases = Fastify({ routerOptions: { caseSensitive: false, ignoreTrailingSlash: true } });
    registerCsrfCheck(aliases, publicUrl);
    aliases.post('/api/v1/write', () => ({ ok: true }));
    aliases.post('/api/v1/guest/links/:id/session', () => ({ ok: true }));
    try {
      for (const url of [
        '/API/V1/WRITE/',
        '/%61PI/V%31/WRITE/',
        '/API/V1/GUEST/links/x/SESSION/',
      ]) {
        expect(
          (
            await aliases.inject({
              method: 'POST',
              url,
              headers: { cookie: 'inkadra.session_token=test', origin },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await aliases.inject({
              method: 'POST',
              url,
              headers: {
                cookie: 'inkadra.session_token=test',
                origin: 'https://evil.example.test',
              },
            })
          ).statusCode,
        ).toBe(403);
      }
    } finally {
      await aliases.close();
    }
  });

  it('leaves safe methods, bearer writes and requests without ambient credentials to the routes', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS'] as const)
      expect(
        (
          await app.inject({
            method,
            url: '/api/v1/write',
            headers: { cookie: 'inkadra.session_token=test' },
          })
        ).statusCode,
      ).toBe(200);
    for (const headers of [{}, { cookie: 'other=test' }, { authorization: 'Bearer test' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/write', headers })).statusCode).toBe(
        200,
      );
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/write',
          headers: { cookie: 'inkadra.session_token=test' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/origin', headers: { origin } })).json()).toEqual({
      allowed: true,
    });
  });
});
