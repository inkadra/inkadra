// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PlanDrawing } from './PlanDrawing.tsx';
import { PLAN } from './plan-sample.fixture.ts';

/**
 * The board's SVG of a sample plan, kept as a fixture (decision 0116): written from `main` before
 * the plan's geometry moved to canvas-core, it must stay the same. Numbers are rounded to 1e-6
 * view units. Lines, arrows and measures with a rotation are left out: the editor never writes
 * one (it turns their ends), and they are now drawn as turned points rather than under a
 * rotate(), the same picture in other markup; canvas-core's tests turn them.
 */
const LEVEL = {
  ...PLAN,
  shapes: (PLAN.shapes ?? []).filter(
    (s) => !(s.rotation && (s.kind === 'line' || s.kind === 'arrow' || s.kind === 'measure')),
  ),
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function svg(props: Omit<Parameters<typeof PlanDrawing>[0], 'plan'>): Promise<string> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<PlanDrawing plan={LEVEL} {...props} />));
  const html = host.innerHTML;
  await act(async () => root.unmount());
  return `${html
    .replace(/-?\d+\.\d+(e-?\d+)?/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6 + 0))
    .replace(/></g, '>\n<')}\n`;
}

/** Numbers in English whatever the machine's language, so the fixture reads alike everywhere. */
const ownLocale = Number.prototype.toLocaleString;
beforeAll(() => {
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

describe('a set plan on the board', () => {
  it('draws the sample plan as it did before the geometry moved to canvas-core', async () => {
    await expect(await svg({ extent: true })).toMatchFileSnapshot('./__fixtures__/plan-drawing.svg.txt');
  });

  it('draws it as the editor does, blocking as a route', async () => {
    await expect(await svg({ extent: true, route: true, grid: 25 })).toMatchFileSnapshot(
      './__fixtures__/plan-drawing-editor.svg.txt',
    );
  });
});
