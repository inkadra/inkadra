import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  checkResponses,
  contractMismatch,
  setCurrentTest,
  takeMismatches,
} from './test-response-contract.ts';

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
      req.headers['x-case'] === 'text'
        ? reply.type('text/plain').send('ok')
        : req.headers['x-case'] === 'json'
          ? reply.type('application/json').send()
          : reply.send(),
    );
    await app.inject({
      method: 'GET',
      url: '/api/v1/instance/version',
      headers: { 'x-case': 'text' },
    });
    await app.inject({ method: 'GET', url: '/api/v1/instance/version' });
    await app.inject({
      method: 'GET',
      url: '/api/v1/instance/version',
      headers: { 'x-case': 'json' },
    });
    await app.close();
    expect(takeMismatches()).toEqual([
      'GET /api/v1/instance/version → 200: the contract declares a JSON body, the answer has text/plain',
      'GET /api/v1/instance/version → 200: the contract declares a JSON body, the answer has no body',
      'GET /api/v1/instance/version → 200: the contract declares a JSON body, the answer has none',
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

  it('matches the live HLS files and answers the names a wildcard route does not serve', () => {
    const member = '/api/v1/assets/:assetId/hls/*';
    const guest = '/api/v1/guest/links/:linkId/assets/:assetId/hls/*';
    const asset = `/api/v1/assets/${crypto.randomUUID()}/hls`;
    const shared = `/api/v1/guest/links/${crypto.randomUUID()}/assets/${crypto.randomUUID()}/hls`;
    const at = (route: string, path: string, status: number, type: string, body: string | null) =>
      contractMismatch('GET', route, status, type, body, path);
    expect(at(member, `${asset}/live/480/init.mp4`, 200, 'video/mp4', null)).toBeNull();
    expect(
      at(member, `${asset}/live/720.m3u8`, 200, 'application/vnd.apple.mpegurl', ''),
    ).toBeNull();
    expect(at(guest, `${shared}/live/480/seg-12.m4s`, 200, 'video/iso.segment', null)).toBeNull();
    const missing = JSON.stringify({ error: { code: 'not_found', message: 'No such copy.' } });
    expect(at(member, `${asset}/poster.jpg`, 404, 'application/json', missing)).toBeNull();
    expect(at(member, `${asset}/poster.jpg`, 404, 'text/plain', 'no')).toContain('JSON body');
    expect(at(member, `${asset}/poster.jpg`, 200, 'image/jpeg', null)).toContain(
      'no such operation',
    );
    // The live 503 keeps its own shape (EXCEPTIONS); elsewhere that shape is drift.
    const odd = JSON.stringify({ code: 'unavailable', message: 'Not ready yet.' });
    expect(at(member, `${asset}/live/480/init.mp4`, 503, 'application/json', odd)).toBeNull();
    expect(at(guest, `${shared}/live/480/seg-3.m4s`, 503, 'application/json', odd)).toBeNull();
    expect(at(member, `${asset}/master.m3u8`, 503, 'application/json', odd)).toContain(
      'does not match',
    );
  });

  it('only observes: a check that throws is reported and the answer leaves untouched', async () => {
    const app = Fastify();
    checkResponses(app, () => {
      throw new Error('a refinement threw');
    });
    app.get('/api/v1/instance/version', async () => ({ version: '1.0.0' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance/version' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '1.0.0' });
    expect(takeMismatches()).toEqual([
      'GET /api/v1/instance/version → 200: the check threw: Error: a refinement threw',
    ]);
  });

  it('names the test that sent an answer arriving after it ended', async ({ task }) => {
    const app = Fastify();
    let reached!: () => void;
    let release!: () => void;
    const atHandler = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.get('/api/v1/instance/version', async () => {
      reached();
      await held;
      return { version: 7 };
    });
    const answer = async (before: string | null, after: string | null) => {
      setCurrentTest(before);
      const pending = app.inject({ method: 'GET', url: '/api/v1/instance/version' });
      await atHandler;
      setCurrentTest(after);
      release();
      await pending;
    };
    try {
      await answer('an earlier test', task.name);
      await answer(null, null);
    } finally {
      setCurrentTest(task.name);
      await app.close();
    }
    const [late, outside] = takeMismatches();
    expect(late).toContain(`(sent by "an earlier test", answered during "${task.name}"`);
    expect(outside).toContain('(outside a running test');
  });
});
