// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import type { PlanElement } from './plan.ts';
import { trackedPlanValues } from './plan-tracked.ts';

type Tracked = Parameters<typeof trackedPlanValues>[0];
const lamp = { id: 'l1', kind: 'fresnel', color: '#FFFFFF', x: 10, y: 20 } as NonNullable<
  PlanElement['icons']
>[number];

describe('the tracked values of a set plan', () => {
  it('names a plan field by itself and an item field by its list and id', () => {
    const values = trackedPlanValues({
      title: 'Diner',
      icons: [{ ...lamp, label: 'Key', kelvin: 5600 }],
      walls: [{ id: 'w1', points: [0, 0, 10, 0], thickness: 5, label: 'Kitchen' }],
      circuits: [{ id: 'c1', name: 'A', amps: 16 }],
      shapes: [
        {
          id: 's1',
          kind: 'text',
          color: '#000000',
          width: 1,
          x0: 0,
          y0: 0,
          x1: 1,
          y1: 1,
          text: 'Exit',
        },
      ],
    } as Tracked);
    expect(values.get('title')).toBe('"Diner"');
    expect(values.get('variant')).toBeNull();
    expect(values.get('icons.l1.label')).toBe('"Key"');
    expect(values.get('icons.l1.kelvin')).toBe('5600');
    expect(values.get('icons.l1.gel')).toBeNull();
    expect(values.get('walls.w1.label')).toBe('"Kitchen"');
    expect(values.get('circuits.c1.amps')).toBe('16');
    expect(values.get('shapes.s1.text')).toBe('"Exit"');
  });

  it('leaves out positions, sizes, angles and locks', () => {
    const values = trackedPlanValues({
      icons: [{ ...lamp, rotation: 90, locked: true }],
    } as Tracked);
    for (const key of values.keys())
      expect(key).not.toMatch(/\.(x|y|w|h|rotation|locked|on|tier)$/);
  });

  it('shows what changed between two readings, and only that', () => {
    const before = trackedPlanValues({ icons: [{ ...lamp, label: 'Key' }] } as Tracked);
    const after = trackedPlanValues({ icons: [{ ...lamp, x: 99, label: 'Fill' }] } as Tracked);
    const changed = [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
    expect(changed).toEqual(['icons.l1.label']);
  });
});
