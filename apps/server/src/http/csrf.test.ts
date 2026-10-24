import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { checkSameOrigin, registerCsrfCheck } from './csrf.ts';

const publicUrl = 'https://boards.example.test/';
const origin = 'https://boards.example.test';
const app = Fastify();
registerCsrfCheck(app, publicUrl);
app.route({
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/api/v1/write',
  handler: () => ({ ok: true }),
});
app.post('/api/v1/guest/links/:id/session', () => ({ ok: true }));
app.post('/api/auth/write', () => ({ ok: true }));
app.get('/origin', (req) => ({ allowed: checkSameOrigin(req, publicUrl) }));
afterAll(() => app.close());

describe('same-origin writes', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'checks %s for both HTTP and HTTPS session cookies',
    async (method) => {
      for (const cookie of [
        'inkadra.session_token=test',
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
  it('leaves safe methods, bearer writes and requests without ambient credentials to the routes', async () => {
    for (const method of ['GET', 'HEAD'] as const)
      expect(
        (
          await app.inject({
            method,
            url: '/api/v1/write',
            headers: { cookie: 'inkadra.session_token=test' },
          })
        ).statusCode,
      ).toBe(200);
    for (const headers of [
      {},
      { cookie: 'other=test' },
      { cookie: 'inkadra.session_token=test', authorization: 'Bearer test' },
    ]) {
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
