import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { contractMismatch, takeMismatches } from './test-response-contract.ts';

describe('the response contract gate', () => {
  it('reports an answer whose body breaks the schema of its route and status', async () => {
    const app = Fastify();
    // The contract describes GET /instance/version 200 as InstanceVersion.
    app.get('/api/v1/instance/version', async () => ({ version: 7 }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance/version' });
    await app.close();
    expect(res.statusCode).toBe(200);
    const found = takeMismatches();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('GET /api/v1/instance/version → 200');
    expect(found[0]).toContain('at version:');
  });

  it('reports a route or a status the contract does not describe', async () => {
    const app = Fastify();
    app.get('/api/v1/not-in-the-contract', async () => ({}));
    app.get('/api/v1/instance/version', async (_req, reply) => reply.code(418).send({}));
    await app.inject({ method: 'GET', url: '/api/v1/not-in-the-contract' });
    await app.inject({ method: 'GET', url: '/api/v1/instance/version' });
    await app.close();
    expect(takeMismatches()).toEqual([
      'GET /api/v1/not-in-the-contract → 200: the contract has no such operation',
      'GET /api/v1/instance/version → 418: the contract does not describe this status',
    ]);
  });

  it('matches parameters whatever their name and accepts an answer that fits', () => {
    const error = JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } });
    expect(
      contractMismatch('GET', '/api/v1/boards/:id', 404, 'application/json', error),
    ).toBeNull();
    const hls = `/api/v1/assets/${crypto.randomUUID()}/hls/master.m3u8`;
    expect(
      contractMismatch('GET', '/api/v1/assets/:assetId/hls/*', 200, 'text/plain', '', hls),
    ).toBeNull();
  });

  it('takes an unexpected failure anywhere, only with the error shape', () => {
    const internal = JSON.stringify({ error: { code: 'internal', message: 'Failed.' } });
    expect(contractMismatch('GET', '/api/v1/me', 500, 'application/json', internal)).toBeNull();
    expect(contractMismatch('GET', '/api/v1/me', 500, 'application/json', '{}')).toContain(
      'at error:',
    );
  });

  it('needs the JSON body a status declares: no other media type, no empty answer', async () => {
    const app = Fastify();
    app.get('/api/v1/instance/version', async (req, reply) =>
      req.headers['x-case'] === 'text' ? reply.type('text/plain').send('ok') : reply.send(),
    );
    await app.inject({
      method: 'GET',
      url: '/api/v1/instance/version',
      headers: { 'x-case': 'text' },
    });
    await app.inject({ method: 'GET', url: '/api/v1/instance/version' });
    await app.close();
    expect(takeMismatches()).toEqual([
      'GET /api/v1/instance/version → 200: the contract declares a JSON body, the answer has text/plain',
      'GET /api/v1/instance/version → 200: the contract declares a JSON body, the answer has no body',
    ]);
    expect(contractMismatch('GET', '/api/v1/me', 500, 'text/html', '<h1>Error</h1>')).toBe(
      'GET /api/v1/me → 500: the contract declares a JSON body, the answer has text/html',
    );
    expect(contractMismatch('GET', '/api/v1/me', 500, '', null)).toContain('has no body');
  });

  it('leaves files to their route and still reads the JSON errors of a file route', () => {
    const file = '/api/v1/assets/:assetId/file';
    expect(contractMismatch('GET', file, 200, 'image/png', null)).toBeNull();
    expect(contractMismatch('GET', file, 206, 'image/png', null)).toBeNull();
    const missing = JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } });
    expect(contractMismatch('GET', file, 404, 'application/json', missing)).toBeNull();
    expect(contractMismatch('GET', file, 404, 'text/html', 'Not found')).toContain(
      'declares a JSON body',
    );
  });
});
