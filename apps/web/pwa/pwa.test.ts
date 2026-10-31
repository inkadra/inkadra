import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import itMessages from '../src/i18n/it.json';
import { drawIcon, iconPng } from './icons.ts';
import { offlinePage, webManifest } from './pages.ts';
import { pwa } from './plugin.ts';

describe('web app manifest', () => {
  it('describes an installable app at the site root', () => {
    const manifest = webManifest(itMessages);
    expect(manifest).toMatchObject({
      name: 'Inkadra',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#0E0E10',
      background_color: '#0E0E10',
    });
    const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    );
  });
});

describe('index.html', () => {
  it('links the manifest and the Apple icon, and opens standalone from the iOS home screen', () => {
    const hook = pwa().transformIndexHtml as unknown as () => Array<{
      tag: string;
      attrs: Record<string, string>;
    }>;
    const tags = hook();
    const attrs = (tag: string, key: string, value: string) =>
      tags.find((t) => t.tag === tag && t.attrs[key] === value)?.attrs;
    expect(attrs('link', 'rel', 'manifest')?.href).toBe('/manifest.webmanifest');
    expect(attrs('link', 'rel', 'apple-touch-icon')?.href).toBe('/icons/apple-touch-icon.png');
    expect(attrs('meta', 'name', 'apple-mobile-web-app-capable')?.content).toBe('yes');
    expect(attrs('meta', 'name', 'apple-mobile-web-app-title')?.content).toBe('Inkadra');
    expect(attrs('meta', 'name', 'apple-mobile-web-app-status-bar-style')?.content).toBe('default');
  });
});

describe('offline page', () => {
  const html = offlinePage({ it: itMessages, en });

  it('has both languages, Italian first', () => {
    expect(html).toContain('<h1 id="title">Sei offline</h1>');
    expect(html).toContain('You are offline');
    expect(html).toContain('<html lang="it">');
  });

  it('uses only the precached external script under enforced CSP', () => {
    expect(html).toContain('<script src="/offline.js"></script>');
    expect(html).not.toContain('<script>');
  });
});

describe('icons', () => {
  it('writes a valid PNG of the requested size', () => {
    const png = iconPng({ size: 48, tile: '#EDEDED', ink: '#0E0E10' });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(48);
    expect(png.readUInt32BE(20)).toBe(48);
    const idat = png.indexOf('IDAT');
    const rows = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect(rows.length).toBe(48 * (48 * 4 + 1));
  });

  it('leaves the corners of the rounded tile transparent, unless full bleed', () => {
    const at = (pixels: Uint8Array, size: number, x: number, y: number) => [
      ...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
    ];
    const tile = drawIcon({ size: 64, tile: '#EDEDED', ink: '#0E0E10' });
    expect(at(tile, 64, 0, 0)[3]).toBe(0);
    expect(at(tile, 64, 32, 4)).toEqual([0xed, 0xed, 0xed, 255]);
    const full = drawIcon({ size: 64, tile: '#EDEDED', ink: '#0E0E10', fullBleed: true });
    expect(at(full, 64, 0, 0)).toEqual([0xed, 0xed, 0xed, 255]);
    // The first frame, solid ink.
    expect(at(full, 64, 20, 32)).toEqual([0x0e, 0x0e, 0x10, 255]);
  });
});
