// SPDX-License-Identifier: AGPL-3.0-only

import { type PlanShape, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { measureValue } from './kit.ts';
import { measureText } from './PlanDrawing.tsx';

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
