// SPDX-License-Identifier: AGPL-3.0-only
/** Prefer the card's right side, flip left when needed, then clamp to the viewport. */
export function commentPanelPosition(
  card: { left: number; right: number; top: number },
  panel: { w: number; h: number },
  viewport: { w: number; h: number },
) {
  const gap = 12;
  const x =
    card.right + gap + panel.w <= viewport.w - 8 ? card.right + gap : card.left - gap - panel.w;
  return {
    x: Math.max(8, Math.min(x, viewport.w - panel.w - 8)),
    y: Math.max(48, Math.min(card.top, viewport.h - panel.h - 8)),
  };
}
