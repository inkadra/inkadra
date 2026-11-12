// SPDX-License-Identifier: MPL-2.0
import { type Element, PLAN_ASPECT } from '@inkadra/doc-schema';
import { croppedRotatedSize } from './image-crop.ts';

/**
 * Height of a card before it has been drawn and measured, in board units: where a client
 * places and stacks cards until it knows the real height. Every client uses the same numbers,
 * so a board is laid out alike before the first measure. An image is 4:3 until its picture is
 * known, cropped and rotated like the picture would be.
 */
export function estimateHeight(el: Element): number {
  switch (el.type) {
    case 'image': {
      const dims = croppedRotatedSize(4, 3, el.crop, el.rotation);
      return Math.round((el.w * dims.height) / dims.width);
    }
    case 'column':
    case 'scene':
      return 120;
    case 'frame':
      return Math.round(el.w * 0.56) + 48;
    case 'color':
      return el.w;
    case 'board':
      return 66;
    case 'todo':
      return 48 + el.items.length * 26;
    case 'section':
      return 44;
    case 'table':
      return el.rows.length * 31 + 2;
    case 'plan':
      return Math.round(el.w / PLAN_ASPECT) + 34;
    case 'map':
      return el.imageAssetId ? Math.round((el.w * 560) / 1024) + 52 : 52;
    default:
      return 64;
  }
}

/** Below this zoom a board is seen from far: cards draw no text, only pictures and drawings. */
export const FAR_ZOOM = 0.3;
