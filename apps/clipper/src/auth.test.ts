// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { buildAuthorizeRequest, readAuthorizationCode } from './auth.ts';
import { ClipperError } from './errors.ts';
import { challengeS256 } from './pkce.ts';

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth';

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
