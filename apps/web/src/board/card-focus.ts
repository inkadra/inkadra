/** Keyboard focus among the cards of the canvas (#825). Kept apart so it can be tested. */
export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** The first card in reading order: top row first, then from the left. */
export function firstCard(cards: readonly CardBox[]): string | undefined {
  return [...cards].sort((a, b) => a.y - b.y || a.x - b.x)[0]?.id;
}

/**
 * The nearest card whose centre lies in `direction` from the centre of `from`; a card off to
 * the side counts twice its sideways distance, so the arrow keeps to its row or column.
 */
export function nextCard(
  cards: readonly CardBox[],
  from: string,
  direction: Direction,
): string | undefined {
  const start = cards.find((c) => c.id === from);
  if (!start) return firstCard(cards);
  const centre = (c: CardBox) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
  const o = centre(start);
  let best: { id: string; score: number } | undefined;
  for (const card of cards) {
    if (card.id === from) continue;
    const c = centre(card);
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const ahead = { left: -dx, right: dx, up: -dy, down: dy }[direction];
    const aside = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (ahead <= 0) continue;
    const score = ahead + 2 * aside;
    if (!best || score < best.score) best = { id: card.id, score };
  }
  return best?.id;
}
