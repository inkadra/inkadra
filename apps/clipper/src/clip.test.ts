// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import type { InkadraApi } from './api.ts';
import { boardUrl, type ClipDeps, imageFilename, parseTags, saveClip, webUrl } from './clip.ts';
import { ClipperError } from './errors.ts';

const BOARD = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const RESULT = { boardId: BOARD, elementId: 'e1', assetId: null };

function deps(overrides: Partial<ClipDeps> = {}) {
  const api = {
    clip: vi.fn(async () => RESULT),
    clipFile: vi.fn(async () => ({ ...RESULT, assetId: BOARD })),
  };
  return {
    api,
    deps: { api: api as unknown as InkadraApi, imageFetchers: [], uploadMaxBytes: 0, ...overrides },
  };
}

const png = () => new Blob([new Uint8Array(10)], { type: 'image/png' });

describe('saveClip', () => {
  it('saves a page as a link card, without repeating it as sourceUrl', async () => {
    const { api, deps: d } = deps();
    await saveClip(
      d,
      { boardId: BOARD, note: '  look at the light  ', tags: ['ref'] },
      { kind: 'link', url: 'https://a.example/p', sourceUrl: 'https://a.example/p' },
    );
    expect(api.clip).toHaveBeenCalledWith({
      boardId: BOARD,
      note: 'look at the light',
      tags: ['ref'],
      url: 'https://a.example/p',
    });
  });

  it('keeps the page as sourceUrl for a link found on it', async () => {
    const { api, deps: d } = deps();
    await saveClip(
      d,
      { boardId: BOARD },
      { kind: 'link', url: 'https://b.example/', sourceUrl: 'https://a.example/p' },
    );
    expect(api.clip).toHaveBeenCalledWith({
      boardId: BOARD,
      url: 'https://b.example/',
      sourceUrl: 'https://a.example/p',
    });
  });

  it('saves a selection as a note with its source', async () => {
    const { api, deps: d } = deps();
    await saveClip(
      d,
      { boardId: BOARD, note: '' },
      { kind: 'text', text: ' “A quote.” ', sourceUrl: 'https://a.example/p' },
    );
    expect(api.clip).toHaveBeenCalledWith({
      boardId: BOARD,
      text: '“A quote.”',
      sourceUrl: 'https://a.example/p',
    });
  });

  it('refuses pages that are not on the web', async () => {
    const { deps: d } = deps();
    await expect(
      saveClip(d, { boardId: BOARD }, { kind: 'link', url: 'chrome://settings' }),
    ).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('uploads image bytes from the first fetcher that has them', async () => {
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => {
      throw new TypeError('CORS');
    });
    const third = vi.fn(async () => png());
    const { api, deps: d } = deps({ imageFetchers: [first, second, third] });
    await saveClip(
      d,
      { boardId: BOARD, tags: ['ignored'] },
      {
        kind: 'image',
        srcUrl: 'https://cdn.example/a/still.png?x=1',
        sourceUrl: 'https://a.example/',
      },
    );
    expect(third).toHaveBeenCalledWith('https://cdn.example/a/still.png?x=1');
    expect(api.clipFile).toHaveBeenCalledWith(
      { boardId: BOARD, sourceUrl: 'https://a.example/' },
      expect.any(Blob),
      'still.png',
    );
    expect(api.clip).not.toHaveBeenCalled();
  });

  it('falls back to the image address when no fetcher can read it', async () => {
    const { api, deps: d } = deps({ imageFetchers: [async () => null] });
    await saveClip(
      d,
      { boardId: BOARD },
      { kind: 'image', srcUrl: 'https://cdn.example/still.jpg', sourceUrl: 'https://a.example/' },
    );
    expect(api.clipFile).not.toHaveBeenCalled();
    expect(api.clip).toHaveBeenCalledWith({
      boardId: BOARD,
      url: 'https://cdn.example/still.jpg',
      sourceUrl: 'https://a.example/',
    });
  });

  it('stops on images larger than the server accepts', async () => {
    const { api, deps: d } = deps({ imageFetchers: [async () => png()], uploadMaxBytes: 5 });
    await expect(
      saveClip(d, { boardId: BOARD }, { kind: 'image', srcUrl: 'https://cdn.example/a.png' }),
    ).rejects.toMatchObject({ kind: 'too_large' });
    expect(api.clip).not.toHaveBeenCalled();
  });

  it('stops when a fetcher already knows the image is too large', async () => {
    const tooLarge = async () => {
      throw new ClipperError('too_large');
    };
    const { deps: d } = deps({ imageFetchers: [tooLarge, async () => png()] });
    await expect(
      saveClip(d, { boardId: BOARD }, { kind: 'image', srcUrl: 'https://cdn.example/a.png' }),
    ).rejects.toMatchObject({ kind: 'too_large' });
  });
});

describe('helpers', () => {
  it('parses tags like the API wants them', () => {
    expect(parseTags(' ref, light ,, Ref, ')).toEqual(['ref', 'light']);
    expect(parseTags('x'.repeat(50))).toEqual(['x'.repeat(40)]);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','))).toHaveLength(20);
  });

  it('names images from their address or their type', () => {
    expect(imageFilename('https://a.example/img/frame%2001.jpg', 'image/jpeg')).toBe(
      'frame 01.jpg',
    );
    expect(imageFilename('https://a.example/media/12345', 'image/webp')).toBe('12345.webp');
    expect(imageFilename('data:image/png;base64,AAAA', 'image/png')).toBe('image.png');
    expect(imageFilename('https://a.example/', 'application/octet-stream')).toBe('image.jpg');
  });

  it('keeps only web addresses', () => {
    expect(webUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(webUrl('file:///home/a.html')).toBeUndefined();
    expect(webUrl(undefined)).toBeUndefined();
  });

  it('links to the board in the web app', () => {
    expect(boardUrl('https://ink.example', { id: 'b', projectId: 'p' })).toBe(
      'https://ink.example/p/p/b/b',
    );
  });
});
