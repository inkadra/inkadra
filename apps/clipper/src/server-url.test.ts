// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { parseServerUrl } from './server-url.ts';

describe('parseServerUrl', () => {
  it('assumes https and drops the trailing slash, query and fragment', () => {
    expect(parseServerUrl(' inkadra.example.com/ ')).toEqual({
      base: 'https://inkadra.example.com',
      originPattern: 'https://inkadra.example.com/*',
    });
    expect(parseServerUrl('https://example.com/?a=1#x')?.base).toBe('https://example.com');
  });

  it('keeps ports and sub-paths, but asks for the origin only', () => {
    expect(parseServerUrl('http://192.168.1.10:3000/inkadra/')).toEqual({
      base: 'http://192.168.1.10:3000/inkadra',
      originPattern: 'http://192.168.1.10:3000/*',
    });
  });

  it('refuses what is not a web address', () => {
    expect(parseServerUrl('')).toBeNull();
    expect(parseServerUrl('ftp://example.com')).toBeNull();
    expect(parseServerUrl('https://user:pass@example.com')).toBeNull();
    expect(parseServerUrl('https://exa mple.com')).toBeNull();
  });
});
