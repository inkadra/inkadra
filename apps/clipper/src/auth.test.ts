// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizeRequest, connect, isStoreInstall, readAuthorizationCode } from './auth.ts';
import { ClipperError } from './errors.ts';
import { challengeS256 } from './pkce.ts';

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth';

it.each([
  [{ update_url: 'https://clients2.google.com/service/update2/crx' }, true],
  [{}, false],
])('tells store installs from unpacked copies: %j', (manifest, expected) => {
  vi.stubGlobal('chrome', { runtime: { getManifest: () => manifest } });
  expect(isStoreInstall()).toBe(expected);
  vi.unstubAllGlobals();
});

describe('authorize request', () => {
  it('opens /authorize with the parameters the web page reads', async () => {
    const req = await buildAuthorizeRequest(
      'https://ink.example/sub',
      REDIRECT,
      'Clipper · Chrome',
    );
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe('https://ink.example/sub/authorize');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('clipper');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(await challengeS256(req.verifier));
    expect(p.get('state')).toBe(req.state);
    expect(p.get('device_name')).toBe('Clipper · Chrome');
  });

  it('reads the code when the state matches', () => {
    expect(readAuthorizationCode(`${REDIRECT}?code=abc&state=s1`, 's1')).toBe('abc');
  });

  it('refuses a redirect for another request, or without a code', () => {
    expect(() => readAuthorizationCode(`${REDIRECT}?code=abc&state=other`, 's1')).toThrow(
      ClipperError,
    );
    expect(() => readAuthorizationCode(`${REDIRECT}?state=s1`, 's1')).toThrow(/No code/);
    let error: unknown;
    try {
      readAuthorizationCode(`${REDIRECT}?state=s1&error=access_denied`, 's1');
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ kind: 'auth_cancelled' });
  });
});

it('loads the server history on connecting, and still connects if that fails', async () => {
  const board = { id: 'b', projectId: 'p', title: 'Board', projectName: null };
  const issued = { token: 't', tokenId: 'i', user: { name: 'A', email: 'a@example.com' } };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const stored: Record<string, unknown> = {};
  const set = async (items: object) => void Object.assign(stored, items);
  vi.stubGlobal('chrome', {
    identity: {
      getRedirectURL: () => REDIRECT,
      launchWebAuthFlow: async ({ url }: { url: string }) =>
        `${REDIRECT}?code=c&state=${new URL(url).searchParams.get('state')}`,
    },
    storage: {
      local: {
        set,
        remove: vi.fn(async () => {}),
        get: async (key: string) => ({ [key]: stored[key] }),
      },
    },
  });
  let boardsFail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/instance')) return json({ limits: { uploadMaxBytes: 0 } });
      if (!url.endsWith('/me/clip-boards')) return json(issued);
      if (boardsFail) throw new TypeError('offline');
      return json({ items: [{ ...board, myRole: 'editor' }] });
    }),
  );
  await connect('https://ink.example');
  expect(stored.recentBoards).toEqual([board]);

  boardsFail = true;
  await expect(connect('https://ink.example')).resolves.toMatchObject({ token: 't' });
  vi.unstubAllGlobals();
});
