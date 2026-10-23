// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { InkadraApi } from './api.ts';
import type { ClipperError } from './errors.ts';

const BOARD = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

function mockFetch(status: number, body?: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      }),
  );
}

function client(fetchImpl: typeof fetch, token: string | null = 'ink_secret') {
  return new InkadraApi({
    baseUrl: 'https://ink.example/',
    token: token ?? undefined,
    fetch: fetchImpl,
  });
}

async function failure(promise: Promise<unknown>): Promise<ClipperError> {
  try {
    await promise;
  } catch (err) {
    return err as ClipperError;
  }
  throw new Error('Expected a failure');
}

describe('InkadraApi', () => {
  it('sends JSON clips with the bearer token to /api/v1/clip', async () => {
    const fetchImpl = mockFetch(201, { boardId: BOARD, elementId: 'e1', assetId: null });
    const result = await client(fetchImpl).clip({ boardId: BOARD, url: 'https://a.example/' });
    expect(result.elementId).toBe('e1');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://ink.example/api/v1/clip');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ink_secret');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ boardId: BOARD, url: 'https://a.example/' });
  });

  it('sends files as multipart, with the fields first and no tags', async () => {
    const fetchImpl = mockFetch(201, { boardId: BOARD, elementId: 'e2', assetId: BOARD });
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await client(fetchImpl).clipFile(
      { boardId: BOARD, sourceUrl: 'https://a.example/p', note: undefined },
      file,
      'shot.png',
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(['boardId', 'sourceUrl', 'file']);
    expect(form.get('boardId')).toBe(BOARD);
    const sent = form.get('file') as File;
    expect(sent.name).toBe('shot.png');
    expect(sent.size).toBe(3);
    // The browser sets the multipart boundary itself.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('exchanges the code without a token', async () => {
    const fetchImpl = mockFetch(200, { token: 'ink_new', tokenId: BOARD, user: {} });
    const body = {
      clientId: 'clipper' as const,
      code: 'c',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'https://x.chromiumapp.org/auth',
    };
    await client(fetchImpl, null).exchangeCode(body);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://ink.example/api/v1/app-authorizations/token');
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it('revokes its own token', async () => {
    const fetchImpl = mockFetch(204);
    await client(fetchImpl).revokeToken(BOARD);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://ink.example/api/v1/me/tokens/${BOARD}`);
    expect(init?.method).toBe('DELETE');
  });

  it('searches with q and limit', async () => {
    const fetchImpl = mockFetch(200, { items: [] });
    await client(fetchImpl).search('mood board', 20);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://ink.example/api/v1/search?q=mood+board&limit=20',
    );
  });

  it('refuses to call authenticated endpoints without a token', async () => {
    const fetchImpl = mockFetch(200, { items: [] });
    expect((await failure(client(fetchImpl, null).projects())).kind).toBe('not_connected');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized', 'unauthorized'],
    [403, 'forbidden', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [413, 'payload_too_large', 'too_large'],
    [400, 'payload_too_large', 'too_large'],
    [429, 'rate_limited', 'rate_limited'],
    [400, 'bad_request', 'bad_request'],
    [500, 'internal', 'server'],
  ])('maps HTTP %i (%s) to %s', async (status, code, kind) => {
    const fetchImpl = mockFetch(status, { error: { code, message: 'Nope.' } });
    const err = await failure(client(fetchImpl).clip({ boardId: BOARD, text: 'x' }));
    expect(err.kind).toBe(kind);
    expect(err.message).toBe('Nope.');
  });

  it('maps a proxy page without JSON by status', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>Too large</html>', { status: 413 }),
    );
    expect((await failure(client(fetchImpl).clip({ boardId: BOARD, text: 'x' }))).kind).toBe(
      'too_large',
    );
  });

  it('reports a network failure as offline', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await failure(client(fetchImpl).instance())).kind).toBe('offline');
  });

  it('reports a server that does not answer JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>', { status: 200 }));
    expect((await failure(client(fetchImpl).instance())).kind).toBe('invalid_server');
  });
});
