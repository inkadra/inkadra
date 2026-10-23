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

  it('accepts plain http only on this computer and the local network', () => {
    expect(parseServerUrl('http://localhost:5173')?.base).toBe('http://localhost:5173');
    expect(parseServerUrl('http://nas.lan')?.base).toBe('http://nas.lan');
    expect(parseServerUrl('http://10.0.0.2')?.base).toBe('http://10.0.0.2');
    expect(parseServerUrl('http://inkadra.example.com')).toBeNull();
    expect(parseServerUrl('http://172.32.0.1')).toBeNull();
  });
});
