// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanIcon, type PlanShape, STROKE_GRID } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { kitList, measureValue } from './kit.ts';
import { measureText } from './PlanDrawing.tsx';

const t = ((key: string) => key.split('.').at(-1)) as unknown as TFunction;
const icon = (kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: `${kind}AAAAAAAAAAAA`.slice(0, 13),
  kind,
  color: '#1C1C1E',
  x: 0,
  y: 0,
  ...extra,
});

it('counts the kit of a plan by type and power, and nothing else', () => {
  const plan = {
    icons: [
      icon('fresnel', { power: '1,2K' }),
      icon('cstand'),
      icon('cstand'),
      icon('fresnel', { power: '650' }),
      icon('cstand'),
      icon('actor'),
      icon('sofa'),
      icon('dolly'),
    ],
  };
  expect(kitList(plan, t)).toEqual([
    { name: 'fresnel 1,2K', count: 1 },
    { name: 'cstand', count: 3 },
    { name: 'fresnel 650', count: 1 },
    { name: 'dolly', count: 1 },
  ]);
  expect(kitList({ ...plan, hiddenLayers: ['lights'] }, t)).toEqual([{ name: 'dolly', count: 1 }]);
  // With a scale, a track says how long it is.
  const track = icon('track', { w: 300, h: 40 });
  expect(kitList({ icons: [track], scale: 100 }, t, 'it')).toEqual([
    { name: 'track 3 m', count: 1 },
  ]);
});

describe('a measure written by hand', () => {
  it('reads a length typed in either way and refuses anything else', () => {
    expect(measureValue('6,20')).toBe('6.2');
    expect(measureValue(' 3.5 ')).toBe('3.5');
    for (const wrong of ['0', '-1', '', 'tre', '100000']) expect(measureValue(wrong)).toBeNull();
  });

  it('shows what was written, else what the scale says, else nothing', () => {
    const line: PlanShape = {
      id: 'measureAAAAAA',
      kind: 'measure',
      color: '#7AD689',
      width: 4,
      x0: 0,
      y0: 0,
      x1: STROKE_GRID,
      y1: 0,
    };
    expect(measureText(line, undefined, 'it')).toBe('');
    expect(measureText(line, 100, 'it')).toBe('10,00 m');
    expect(measureText({ ...line, text: '6.2' }, 100, 'it')).toBe('6,20 m');
    expect(measureText({ ...line, text: '6.2' }, undefined, 'it')).toBe('6,20 m');
  });
});
