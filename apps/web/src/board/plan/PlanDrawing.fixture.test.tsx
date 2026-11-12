// @vitest-environment happy-dom
import { type PlanElement, variantView } from '@inkadra/canvas-core';
import i18next from 'i18next';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en.json';
import { PlanDrawing } from './PlanDrawing.tsx';
import {
  CATALOGUE,
  expectFixture,
  PLAN,
  PLAN_HIDDEN,
  SETUP,
  TURNED,
} from './plan-sample.fixture.ts';

/**
 * The board's SVG of the sample plans, kept as fixtures (decision 0116): written from `main`'s
 * renderer, it must stay the same. Numbers are rounded to 1e-6 view units. Lines, arrows and
 * measures with a rotation are drawn as turned points now, not under a rotate(): the same picture
 * in other markup, so they are compared by their geometry (the last test), not their markup.
 */
const level = (plan: PlanElement): PlanElement => ({
  ...plan,
  shapes: (plan.shapes ?? []).filter(
    (s) => !(s.rotation && (s.kind === 'line' || s.kind === 'arrow' || s.kind === 'measure')),
  ),
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const i18n = i18next.createInstance();

/** Numbers in English whatever the machine's language, so the fixture reads alike everywhere. */
const ownLocale = Number.prototype.toLocaleString;
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locale?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return ownLocale.call(this, locale ?? 'en', options);
  });
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function svg(
  plan: PlanElement,
  props: Omit<Parameters<typeof PlanDrawing>[0], 'plan'> = { extent: true },
): Promise<string> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <PlanDrawing plan={plan} {...props} />
      </I18nextProvider>,
    ),
  );
  const html = host.innerHTML;
  await act(async () => root.unmount());
  return `${html
    .replace(/-?\d+\.\d+(e-?\d+)?/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6 + 0))
    .replace(/></g, '>\n<')}\n`;
}

const fixture = (name: string) => `${import.meta.dirname}/__fixtures__/${name}`;

describe('a set plan on the board', () => {
  it('draws the sample plan as it did before the geometry moved to canvas-core', async () => {
    expectFixture(await svg(level(PLAN)), fixture('plan-drawing.svg.txt'));
  });

  it('draws it as the editor does, blocking as a route', async () => {
    expectFixture(
      await svg(level(PLAN), { extent: true, route: true, grid: 25 }),
      fixture('plan-drawing-editor.svg.txt'),
    );
  });

  it('draws it as the card does, framed with its background', async () => {
    expectFixture(
      await svg(level(PLAN), { background: true }),
      fixture('plan-drawing-card.svg.txt'),
    );
  });

  it('leaves out its hidden layers', async () => {
    expectFixture(await svg(level(PLAN_HIDDEN)), fixture('plan-drawing-hidden.svg.txt'));
  });

  it('draws every kind of the catalogue', async () => {
    expectFixture(await svg(CATALOGUE), fixture('plan-drawing-catalogue.svg.txt'));
  });

  it('draws a setup over its base’s Set layer', async () => {
    expectFixture(
      await svg(level(variantView(SETUP, PLAN))),
      fixture('plan-drawing-setup.svg.txt'),
    );
  });

  it('draws turned lines, arrows and measures where main’s rotate() put them', async () => {
    const drawn = await svg(TURNED);
    if (process.env.WRITE_PLAN_FIXTURES) {
      expectFixture(drawn, fixture('plan-drawing-turned.svg.txt'));
      return;
    }
    const { readFileSync } = await import('node:fs');
    const before = geometry(readFileSync(fixture('plan-drawing-turned.svg.txt'), 'utf8'));
    const after = geometry(drawn);
    expect(after.map((e) => e.what)).toEqual(before.map((e) => e.what));
    expect(after).toHaveLength(9);
    after.forEach((e, i) => {
      const was = before[i] as (typeof before)[number];
      expect(e.points.length, e.what).toBe(was.points.length);
      e.points.forEach(([x, y], j) => {
        expect(Math.abs(x - (was.points[j]?.[0] ?? Number.NaN)), e.what).toBeLessThan(1e-4);
        expect(Math.abs(y - (was.points[j]?.[1] ?? Number.NaN)), e.what).toBeLessThan(1e-4);
      });
    });
  });
});

const GEOMETRY = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'd', 'width', 'height', 'transform']);
type Turn = [number, number, number];

/**
 * The drawn elements of an SVG, each with its points where they land on the plan (every
 * rotate() of it and its groups applied) and what it is (its tag and its other attributes).
 */
function geometry(markup: string): Array<{ what: string; points: Array<[number, number]> }> {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const out: Array<{ what: string; points: Array<[number, number]> }> = [];
  const walk = (el: Element, turns: Turn[]) => {
    const t = el.getAttribute('transform')?.match(/rotate\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/);
    const here: Turn[] = t ? [...turns, [Number(t[1]), Number(t[2]), Number(t[3])]] : turns;
    const n = (name: string) => Number(el.getAttribute(name));
    let points: Array<[number, number]> | null = null;
    if (el.tagName === 'line') {
      points = [
        [n('x1'), n('y1')],
        [n('x2'), n('y2')],
      ];
    } else if (el.tagName === 'path') {
      const v = (el.getAttribute('d')?.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
      points = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i] as number, v[i + 1] as number]);
    } else if (el.tagName === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      points = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
    } else if (el.tagName === 'text') points = [[n('x'), n('y')]];
    if (points) {
      // Innermost turn first: a point inside nested groups is turned by each, inside out.
      const placed = points.map(([x, y]) =>
        here.reduceRight<[number, number]>(
          ([px, py], [deg, cx, cy]) => {
            const a = (deg * Math.PI) / 180;
            return [
              cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a),
              cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a),
            ];
          },
          [x, y],
        ),
      );
      const attrs = [...el.attributes]
        .filter((a) => !GEOMETRY.has(a.name))
        .map((a) => `${a.name}=${a.value}`)
        .sort();
      out.push({ what: `${el.tagName} ${attrs.join(' ')} ${el.textContent ?? ''}`, points: placed });
    }
    for (const child of el.children) walk(child, here);
  };
  walk(host, []);
  return out;
}
