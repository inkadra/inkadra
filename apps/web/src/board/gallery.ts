// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import { isYoutubeUrl } from './youtube.ts';

export type ViewableElement = Extract<Element, { type: 'image' | 'file' | 'link' }>;

/**
 * Cards the viewer can open, in reading order (top to bottom, then left to right). A guest
 * never gets the cards hidden from guests.
 */
export function viewableInOrder(elements: Iterable<Element>, guest: boolean): ViewableElement[] {
  return [...elements]
    .filter(
      (el): el is ViewableElement =>
        (el.type === 'image' ||
          el.type === 'file' ||
          (el.type === 'link' && isYoutubeUrl(el.url))) &&
        !(guest && el.guestHidden),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
