// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanIcon, type PlanShape, STROKE_GRID } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { kitList, measureValue } from './kit.ts';
import { measureText } from './PlanDrawing.tsx';

const t = ((key: string) => key.split('.').at(-1)) as unknown as TFunction;
/** The name and count of each line, what these tests are about. */
const lines = (kit: ReturnType<typeof kitList>) => kit.map(({ name, count }) => ({ name, count }));
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
  expect(lines(kitList(plan, t))).toEqual([
    { name: 'fresnel 1,2K', count: 1 },
    { name: 'cstand', count: 3 },
    { name: 'fresnel 650', count: 1 },
    { name: 'dolly', count: 1 },
  ]);
  expect(lines(kitList({ ...plan, hiddenLayers: ['lights'] }, t))).toEqual([{ name: 'dolly', count: 1 }]);
  // With a scale, a track says how long it is.
  const track = icon('track', { w: 300, h: 40 });
  expect(lines(kitList({ icons: [track], scale: 100 }, t, 'it'))).toEqual([
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

it('counts watts, modifiers, gels and the stands named on lights (decision 0104)', () => {
  const plan = {
    icons: [
      icon('cob', { id: 'cobAAAAAAAAAA', watts: 300, gel: 'CTO ½', stand: 'combo' }),
      icon('softbox', { id: 'boxAAAAAAAAAA', on: 'cobAAAAAAAAAA' }),
      icon('led', { id: 'ledAAAAAAAAAA', gel: 'CTO ½', stand: 'cstand', on: 'standAAAAAAAA' }),
      icon('cstand', { id: 'standAAAAAAAA' }),
      icon('camera', { id: 'camAAAAAAAAAA', support: 'tripod' }),
      icon('crew'),
    ],
  };
  expect(lines(kitList(plan, t))).toEqual([
    { name: 'cob 300 W', count: 1 },
    { name: 'softbox', count: 1 },
    { name: 'led', count: 1 },
    { name: 'cstand', count: 1 },
    { name: 'camera', count: 1 },
    { name: 'gel: CTO ½', count: 2 },
    { name: 'combo', count: 1 },
    { name: 'tripod', count: 1 },
  ]);
});

it('sorts each line into its section, with the watts of a light each', () => {
  const kit = kitList(
    { icons: [icon('fresnel', { watts: 2000 }), icon('flag'), icon('camera', { support: 'tripod' })] },
    t,
  );
  expect(kit).toEqual([
    { name: 'fresnel 2000 W', count: 1, group: 'lights', watts: 2000 },
    { name: 'flag', count: 1, group: 'grip' },
    { name: 'camera', count: 1, group: 'camera' },
    { name: 'tripod', count: 1, group: 'camera' },
  ]);
});
