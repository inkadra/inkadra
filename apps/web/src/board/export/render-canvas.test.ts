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
});
