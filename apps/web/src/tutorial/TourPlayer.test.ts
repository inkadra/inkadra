import { describe, expect, it } from 'vitest';
import { placeCoach } from './TourPlayer.tsx';

const card = { w: 308, h: 262 };
const view = { w: 1280, h: 800 };

describe('placeCoach', () => {
  it('centres a card without an element', () => {
    expect(placeCoach(null, undefined, card, view, false)).toEqual({ x: 486, y: 269 });
  });

  it('puts the card on the asked side when it fits', () => {
    const r = { x: 500, y: 400, w: 200, h: 40 };
    expect(placeCoach(r, 'top', card, view, false)).toEqual({ x: 446, y: 114 });
  });

  it('turns to the other side instead of covering the element', () => {
    // The review's decision buttons, near the top: no room above.
    const r = { x: 918, y: 165, w: 339, h: 50 };
    const at = placeCoach(r, 'top', card, view, false);
    expect(at.y).toBeGreaterThanOrEqual(r.y + r.h);
  });
});
