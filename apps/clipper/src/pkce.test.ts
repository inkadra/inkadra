// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { base64Url, challengeS256, createState, createVerifier } from './pkce.ts';

describe('PKCE', () => {
  it('computes the S256 challenge of the RFC 7636 example', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes verifiers the server accepts, different every time', () => {
    const a = createVerifier();
    const b = createVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a).not.toBe(b);
  });

  it('makes base64url without padding', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('makes a random state', () => {
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(createState()).not.toBe(createState());
  });
});
