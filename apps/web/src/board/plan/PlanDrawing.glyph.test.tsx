// @vitest-environment happy-dom
import { placedGlyph } from '@inkadra/canvas-core';
import { PLAN_ICON_KINDS, type PlanIcon } from '@inkadra/doc-schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanIconView } from './PlanDrawing.tsx';

/**
 * The board draws a glyph as SVG in glyph units under its icon's scale(); canvas-core's
 * placedGlyph gives a second client the same parts in view units (decision 0116). Here the two
 * are held together: each part's stroke width and dashes as the board's SVG sets them, times
 * the icon's scale (the mean of its two axes), are placedGlyph's.
 */
const VARIANTS: Array<Partial<PlanIcon>> = [
  {},
  { rotation: 137, percent: 260 },
  { rotation: 90, w: 300, h: 40 },
  { rotation: 300, w: 25, h: 90 },
  { percent: 15 },
  { pose: 'seated', rotation: 45 },
];

const NUMBER = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;
const styleOf = (el: Element, name: string) =>
  el.getAttribute('style')?.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1];

/** What the board strokes each part of an icon's glyph with, in view units. */
function boardStrokes(icon: PlanIcon): Array<{ width: number; dash?: number[] }> {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <svg aria-hidden="true">
      <PlanIconView icon={icon} noCone />
    </svg>,
  );
  const group = host.querySelector('g[transform]') as Element;
  const scale = group
    .getAttribute('transform')
    ?.match(/scale\(([^ ]+) ([^)]+)\)/)
    ?.slice(1)
    .map(Number) as [number, number];
  const mean = Math.sqrt(scale[0] * scale[1]);
  const base = Number(styleOf(group, 'stroke-width'));
  return [...group.children].flatMap((el) => {
    const width = Number(styleOf(el, 'stroke-width') ?? base) * mean;
    const dash = styleOf(el, 'stroke-dasharray')
      ?.match(NUMBER)
      ?.map((d) => Number(d) * mean);
    // A path draws one polyline per subpath (each M); circles, ellipses and rectangles one.
    const count = el.tagName === 'path' ? (el.getAttribute('d')?.match(/[Mm]/g)?.length ?? 0) : 1;
    return Array.from({ length: count }, () => ({ width, ...(dash ? { dash } : {}) }));
  });
}

describe('placedGlyph and the board', () => {
  it('strokes every kind of the catalogue as the board does, at every size and turn', () => {
    let parts = 0;
    for (const kind of PLAN_ICON_KINDS)
      for (const variant of VARIANTS) {
        const icon = {
          id: 'iconAAAAAAAAA',
          kind,
          color: '#EDD963',
          x: 2048,
          y: 2048,
          ...variant,
        } as PlanIcon;
        const board = boardStrokes(icon);
        const placed = placedGlyph(icon);
        const what = `${kind} ${JSON.stringify(variant)}`;
        expect(placed.length, what).toBe(board.length);
        placed.forEach((part, i) => {
          const drawn = board[i] as (typeof board)[number];
          expect(Math.abs(part.width - drawn.width) / drawn.width, what).toBeLessThan(1e-9);
          expect(part.dash?.length, what).toBe(drawn.dash?.length);
          part.dash?.forEach((d, j) => {
            expect(Math.abs(d - (drawn.dash?.[j] ?? Number.NaN)), what).toBeLessThan(1e-9);
          });
        });
        parts += placed.length;
      }
    expect(parts).toBeGreaterThan(PLAN_ICON_KINDS.length * VARIANTS.length);
  });
});
