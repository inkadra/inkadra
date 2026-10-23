import { describe, expect, it } from 'vitest';
import { safeNext } from './Login.tsx';

describe('safeNext', () => {
  it('keeps paths inside the app', () => {
    expect(safeNext('/p/1/b/2?x=1')).toBe('/p/1/b/2?x=1');
  });

  it('falls back to the home page for anything else', () => {
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\tevil',
      '/a\nb',
    ])
      expect(safeNext(bad)).toBe('/');
  });
});
