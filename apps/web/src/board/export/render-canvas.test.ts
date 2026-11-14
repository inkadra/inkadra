// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderImages } from './render-canvas.ts';

describe('renderImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encodes PNG or JPEG at quality 90, at the size asked, on the page background', async () => {
    const encoded: unknown[] = [];
    const sizes: number[][] = [];
    const fills: string[] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(width: number, height: number) {
          sizes.push([width, height]);
        }
        getContext() {
          const ctx = {
            save() {},
            restore() {},
            setTransform() {},
            set fillStyle(value: string) {
              fills.push(value);
            },
            fillRect() {},
          };
          return ctx;
        }
        convertToBlob(options: unknown) {
          encoded.push(options);
          return Promise.resolve(new Blob());
        }
      },
    );
    const page = { width: 1080, height: 1350, background: '#161616', ops: [] };
    await renderImages([page], [1], new Map(), { format: 'jpeg' });
    await renderImages([{ ...page, background: null }], [2], new Map());
    expect(encoded).toEqual([{ type: 'image/jpeg', quality: 0.9 }, { type: 'image/png' }]);
    expect(sizes).toEqual([
      [1080, 1350],
      [2160, 2700],
    ]);
    // A transparent PNG gets nothing under it.
    expect(fills).toEqual(['#161616']);
  });

  it('decodes pictures kept as files for their page only, and closes them after it', async () => {
    const closed: number[] = [];
    let live = 0;
    let peak = 0;
    vi.stubGlobal('createImageBitmap', () => {
      live += 1;
      peak = Math.max(peak, live);
      return Promise.resolve({
        close() {
          live -= 1;
          closed.push(1);
        },
      });
    });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            save() {},
            restore() {},
            setTransform() {},
            fillRect() {},
            drawImage() {},
          };
        }
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    const at = (key: string) => ({
      width: 10,
      height: 10,
      background: null,
      ops: [{ kind: 'image', key, x: 0, y: 0, w: 10, h: 10 }],
    });
    const images = new Map([
      ['a', { width: 10, height: 10, blob: new Blob() }],
      ['b', { width: 10, height: 10, blob: new Blob() }],
    ]);
    // biome-ignore lint/suspicious/noExplicitAny: a minimal page for the test
    await renderImages([at('a'), at('b')] as any, [1, 1], images);
    expect(closed.length).toBe(2);
    expect(peak).toBe(1);
  });
});
