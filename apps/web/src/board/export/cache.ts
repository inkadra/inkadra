// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { closeImages, type LoadedImage, loadAssetImage } from './images.ts';

/**
 * Pictures of the dialog's preview, decoded once at preview size and reused while the options
 * change; closed with the dialog. Exports load their own and free them when done.
 */
export class ExportCache {
  private images = new Map<string, Promise<LoadedImage | null>>();
  private settled: LoadedImage[] = [];
  private closed = false;
  readonly names = new Map<string, string>();

  image(asset: Asset, pixels: number, signal?: AbortSignal): Promise<LoadedImage | null> {
    const key = `${asset.id}@${pixels}`;
    let p = this.images.get(key);
    if (!p) {
      // Not tied to one preview's signal: a newer preview may still want it.
      p = loadAssetImage(asset, pixels, 'bitmap').then((img) => {
        // Arrived after the dialog closed: free it at once.
        if (this.closed) {
          closeImages([img]);
          return null;
        }
        if (img) this.settled.push(img);
        else this.images.delete(key);
        return img;
      });
      this.images.set(key, p);
    }
    return signal
      ? Promise.race([
          p,
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          ),
        ])
      : p;
  }

  close() {
    this.closed = true;
    closeImages(this.settled);
    this.settled = [];
    this.images.clear();
    this.names.clear();
  }
}
