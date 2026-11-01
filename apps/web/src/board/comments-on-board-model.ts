// SPDX-License-Identifier: AGPL-3.0-only

/** A card as drawn, in pixels from the top-left corner of the canvas area. */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

/** Zoom range in which a bubble follows the card's scale; beyond it, it stays legible. */
export const BUBBLE_SCALE = { min: 0.85, max: 1.3 };
/** Below this zoom the cards are too small for a bubble to mean anything: it hides. */
export const BUBBLE_HIDE_BELOW = 0.35;

/**
 * Where the bubble of a card goes: on the top-right corner, scaled with the zoom within limits.
 * Null when the card is zoomed far out, or entirely outside the canvas area.
 */
export function bubbleLayout(
  card: Rect,
  layoutWidth: number,
  area?: { w: number; h: number },
): { x: number; y: number; scale: number } | null {
  if (layoutWidth <= 0) return null;
  const zoom = card.width / layoutWidth;
  if (zoom < BUBBLE_HIDE_BELOW) return null;
  if (area && (card.right < 0 || card.left > area.w || card.bottom < 0 || card.top > area.h))
    return null;
  return {
    x: card.right,
    y: card.top,
    scale: Math.min(BUBBLE_SCALE.max, Math.max(BUBBLE_SCALE.min, zoom)),
  };
}

const GAP = 28;
const MARGIN = 8;

/** The popover goes to the right of the card, or to its left when there is no room. */
export function popoverPosition(
  card: Rect,
  pop: { w: number; h: number },
  area: { w: number; h: number },
) {
  const side = card.right + GAP + pop.w <= area.w - MARGIN ? 'right' : 'left';
  const x = side === 'right' ? card.right + GAP : card.left - GAP - pop.w;
  return {
    side,
    x: Math.max(MARGIN, Math.min(x, area.w - pop.w - MARGIN)),
    y: Math.max(MARGIN, Math.min(card.top - MARGIN, area.h - pop.h - MARGIN)),
  } as const;
}
