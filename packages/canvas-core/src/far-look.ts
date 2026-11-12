// SPDX-License-Identifier: MPL-2.0
import type { Element } from '@inkadra/doc-schema';
import { FAR_ZOOM } from './card-size.ts';

/**
 * What a card looks like at a zoom, below `FAR_ZOOM` above all. From far a card draws no text,
 * icon, control, tag, lock or badge: only its shape and what pictures it.
 *
 * - `normal`: as at any zoom. Every card at `FAR_ZOOM` or closer, and arrows (with their labels)
 *   at every zoom: they are not cards.
 * - `picture`: only its picture. `surface`: the card's own background is drawn under it (a card
 *   on the board); a card inside a column or a scene draws its picture alone.
 * - `swatch`: a colour card's swatch, `color` its hex; `surface` as for `picture`.
 * - `tint`: a tinted note, filled with its tint as at any zoom; `color` is the note's colour.
 * - `block`: a card with nothing to picture, filled with the theme token `color`.
 * - `surface`: a column or a scene that holds a picture: its own background as at any zoom,
 *   without its texts; each child is drawn by its own look.
 * - `hidden`: a card inside a column or a scene with no picture: nothing of it is drawn, its
 *   container's background shows.
 */
export type FarLook =
  | { look: 'normal' }
  | { look: 'picture'; surface: boolean }
  | { look: 'swatch'; color: string; surface: boolean }
  | { look: 'tint'; color: string }
  | { look: 'block'; color: typeof FAR_BLOCK }
  | { look: 'surface' }
  | { look: 'hidden' };

/** The theme token a card with nothing to picture is filled with from far. */
export const FAR_BLOCK = 'border-default';

export interface FarLookContext {
  zoom: number;
  /** The children of a column or a scene, as `parent` gives them. Needed for a container. */
  children?: readonly Element[] | undefined;
  /**
   * True for a link the card plays itself: a YouTube or Vimeo video or an Instagram post. A
   * playable link shows its picture while `showPreview` allows, others while `showInfo` does.
   * shortcut: the web asks its `videoEmbedUrl`; pass the same rule until it moves to a package.
   */
  playable?: ((url: string) => boolean) | undefined;
  /**
   * False for an asset the client cannot show yet (loading or missing): a file, a link's image
   * and a map's picture then picture nothing, so the card is a block. Default: every asset is
   * shown. Images, frames, characters and locations keep their picture's place either way.
   */
  shown?: ((assetId: string) => boolean) | undefined;
}

/**
 * What pictures a card from far, or null when nothing does: an image (with its drawing), a
 * frame (its reference picture, pen strokes and shapes, or the empty frame's mark), a set plan's
 * drawing, a character's portrait (its initials without one), a location's photo, a map's
 * picture, a file's preview (a thumbnail, a page, a player or its file-type tile), a link's
 * preview image or video, a colour's swatch. A board card, a note, a to-do, a table and a
 * section have none.
 */
export function farPicture(el: Element, ctx: FarLookContext): 'picture' | 'swatch' | null {
  const shown = (id: string | undefined) => !!id && (ctx.shown?.(id) ?? true);
  switch (el.type) {
    case 'image':
    case 'frame':
    case 'plan':
    case 'character':
      return 'picture';
    case 'location':
      return el.assetId ? 'picture' : null;
    case 'map':
      return shown(el.imageAssetId) ? 'picture' : null;
    case 'file':
      return shown(el.assetId) ? 'picture' : null;
    case 'link': {
      const playable = ctx.playable?.(el.url) ?? false;
      const wanted = playable ? el.showPreview !== false : el.showInfo !== false;
      return wanted && (playable || shown(el.imageAssetId)) ? 'picture' : null;
    }
    case 'color':
      return 'swatch';
    default:
      return null;
  }
}

/**
 * How a client draws `el` at `ctx.zoom`, the web board's rule (`canvas__world--far` in
 * board.css). A card with `parent` set is inside a column or a scene.
 */
export function farLook(el: Element, ctx: FarLookContext): FarLook {
  if (ctx.zoom >= FAR_ZOOM || el.type === 'arrow') return { look: 'normal' };
  const free = el.parent === null;
  if (el.type === 'column' || el.type === 'scene') {
    const pictured = !el.collapsed && (ctx.children ?? []).some((c) => farPicture(c, ctx));
    return pictured ? { look: 'surface' } : { look: 'block', color: FAR_BLOCK };
  }
  if (el.type === 'color') return { look: 'swatch', color: el.hex, surface: free };
  if (farPicture(el, ctx)) return { look: 'picture', surface: free };
  if (!free) return { look: 'hidden' };
  if (el.type === 'note' && el.color) return { look: 'tint', color: el.color };
  return { look: 'block', color: FAR_BLOCK };
}
