// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { imageLabel, parseSrcset, pickImages, type RawImage } from './page-images.ts';

const base = 'https://site.example/project/1';
const img = (fields: Partial<RawImage>): RawImage => ({
  currentSrc: '',
  src: '',
  srcset: '',
  sources: [],
  naturalWidth: 800,
  naturalHeight: 600,
  alt: '',
  ...fields,
});

describe('parseSrcset', () => {
  it('reads width and density descriptors, keeping commas inside URLs', () => {
    expect(
      parseSrcset('a.jpg 400w, https://cdn.example/w_1,h_2/b.jpg 1600w,c.jpg 2x, d.jpg'),
    ).toEqual([
      { url: 'a.jpg', rank: 400, width: 400 },
      { url: 'https://cdn.example/w_1,h_2/b.jpg', rank: 1600, width: 1600 },
      { url: 'c.jpg', rank: 2000 },
      { url: 'd.jpg', rank: 1000 },
    ]);
    // As in the HTML rules, only whitespace ends a URL: a comma right after one is cut.
    expect(parseSrcset('a.jpg, b.jpg 1.5x')).toEqual([
      { url: 'a.jpg', rank: 1000 },
      { url: 'b.jpg', rank: 1500 },
    ]);
    expect(parseSrcset('a.jpg,b.jpg 1.5x')).toEqual([{ url: 'a.jpg,b.jpg', rank: 1500 }]);
    expect(parseSrcset('  ')).toEqual([]);
  });
});

describe('pickImages', () => {
  it('prefers what the browser shows, else the largest candidate, and resolves addresses', () => {
    const picked = pickImages(
      [
        img({ currentSrc: 'https://cdn.example/shown.jpg', srcset: 'big.jpg 2000w' }),
        img({
          naturalWidth: 0,
          naturalHeight: 0,
          src: 'placeholder.gif',
          srcset: 'small.jpg 300w, large.jpg 1400w',
        }),
        img({
          naturalWidth: 0,
          naturalHeight: 0,
          sources: ['/pic.webp 1200w', '/pic-2x.webp 2400w'],
        }),
        img({ src: '/plain.png', alt: ' Cover ' }),
      ],
      base,
    );
    expect(picked).toEqual([
      { url: 'https://cdn.example/shown.jpg', alt: '', width: 800, height: 600 },
      { url: 'https://site.example/project/large.jpg', alt: '', width: 0, height: 0 },
      { url: 'https://site.example/pic-2x.webp', alt: '', width: 0, height: 0 },
      { url: 'https://site.example/plain.png', alt: 'Cover', width: 800, height: 600 },
    ]);
  });

  it('drops duplicates, icons, small pictures, unloaded ones without sizes and unreadable URLs', () => {
    const bigData = `data:image/png;base64,${'A'.repeat(300 * 1024)}`;
    const picked = pickImages(
      [
        img({ currentSrc: 'https://a.example/1.jpg' }),
        img({ currentSrc: 'https://a.example/1.jpg' }),
        img({ currentSrc: 'https://a.example/logo.svg' }),
        img({ currentSrc: 'data:image/svg+xml,<svg/>' }),
        img({ currentSrc: 'https://a.example/avatar.jpg', naturalWidth: 64, naturalHeight: 64 }),
        img({ currentSrc: 'https://a.example/strip.jpg', naturalWidth: 900, naturalHeight: 40 }),
        img({ src: 'https://a.example/lazy.jpg', naturalWidth: 0, naturalHeight: 0 }),
        img({ currentSrc: 'blob:https://a.example/123' }),
        img({ currentSrc: bigData }),
        img({ currentSrc: 'data:image/png;base64,iVBOR' }),
        img({}),
      ],
      base,
    );
    expect(picked.map((p) => p.url)).toEqual([
      'https://a.example/1.jpg',
      'data:image/png;base64,iVBOR',
    ]);
  });
});

describe('imageLabel', () => {
  it('names a tile by alt text, then file name, then the fallback', () => {
    const image = { url: 'https://a.example/x/photo%201.jpg?w=2', alt: '', width: 1920, height: 1080 };
    expect(imageLabel(image, 'Image')).toBe('photo 1.jpg, 1920×1080');
    expect(imageLabel({ ...image, alt: 'Hero' }, 'Image')).toBe('Hero, 1920×1080');
    expect(imageLabel({ ...image, url: 'data:image/png;base64,AA', width: 0 }, 'Image')).toBe(
      'Image',
    );
  });
});
