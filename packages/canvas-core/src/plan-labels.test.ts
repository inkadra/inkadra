// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { iconLabel, iconSubLabel, wattsText } from './plan-labels.ts';

const icon = (extra: Partial<PlanIcon>): PlanIcon =>
  ({ id: 'iconAAAAAAAAA', kind: 'cob', color: '#EDD963', x: 0, y: 0, ...extra }) as PlanIcon;

describe('the words of the plan (decision 0118)', () => {
  it('writes watts as the mockup does: watts below a kilowatt, then "2K"', () => {
    expect(wattsText(300, 'en')).toBe('300 W');
    expect(wattsText(2000, 'en')).toBe('2K');
    expect(wattsText(1200, 'en')).toBe('1.2K');
    expect(wattsText(1200, 'it')).toBe('1,2K');
  });

  it('labels a light with its watts once, a camera with its lens when asked', () => {
    expect(iconLabel(icon({ label: 'Key', watts: 300 }), 'en')).toBe('Key · 300 W');
    expect(iconLabel(icon({ label: 'Sodium', watts: 2000 }), 'en')).toBe('Sodium · 2K');
    expect(iconLabel(icon({ label: 'Key 300 W', watts: 300 }), 'en')).toBe('Key 300 W');
    expect(iconLabel(icon({ label: 'Key', power: '1,2K', watts: 1200 }))).toBe('Key · 1,2K');
    const cam = icon({ kind: 'camera', label: 'A cam', lens: 32 });
    expect(iconLabel(cam)).toBe('A cam');
    expect(iconLabel({ ...cam, showLens: true })).toBe('A cam · 32 mm');
    expect(iconLabel({ ...cam, label: 'A cam 32mm', showLens: true })).toBe('A cam 32mm');
  });

  it('gives a named light a second line with its colour temperature and level', () => {
    expect(iconSubLabel(icon({ label: 'Key', kelvin: 5600, intensity: 0.6 }))).toBe('5600 K · 60%');
    expect(iconSubLabel(icon({ label: 'Key', kelvin: 2100 }))).toBe('2100 K');
    // Unnamed lights and other icons have none.
    expect(iconSubLabel(icon({ kelvin: 5600 }))).toBe('');
    expect(iconSubLabel(icon({ kind: 'camera', label: 'A', kelvin: 5600 }))).toBe('');
  });
});
