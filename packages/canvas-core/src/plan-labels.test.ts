// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { iconLabel, iconSubLabel, wattsText } from './plan-labels.ts';

/** The host (browser, device) writes numbers in English, whatever the app's language. */
function englishHost(): void {
  const own = Number.prototype.toLocaleString;
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locale?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return own.call(this, locale ?? 'en-US', options);
  });
}

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
    expect(iconLabel(icon({ label: 'Key', power: '1,2K', watts: 1200 }), 'en')).toBe('Key · 1,2K');
    const cam = icon({ kind: 'camera', label: 'A cam', lens: 32 });
    expect(iconLabel(cam, 'en')).toBe('A cam');
    expect(iconLabel({ ...cam, showLens: true }, 'en')).toBe('A cam · 32 mm');
    expect(iconLabel({ ...cam, label: 'A cam 32mm', showLens: true }, 'en')).toBe('A cam 32mm');
  });

  describe('with an English browser', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes the watts in the app language, not the host one', () => {
      englishHost();
      expect(wattsText(1200, 'it')).toBe('1,2K');
      expect(iconLabel(icon({ label: 'Key', watts: 1200 }), 'it')).toBe('Key · 1,2K');
    });
  });

  it('gives a named light a second line with its colour temperature and level', () => {
    expect(iconSubLabel(icon({ label: 'Key', kelvin: 5600, intensity: 0.6 }))).toBe('5600 K · 60%');
    expect(iconSubLabel(icon({ label: 'Key', kelvin: 2100 }))).toBe('2100 K');
    expect(iconSubLabel(icon({ label: 'Sodium', kelvin: 2100, intensity: 1 }))).toBe('2100 K');
    // Unnamed lights and other icons have none.
    expect(iconSubLabel(icon({ kelvin: 5600 }))).toBe('');
    expect(iconSubLabel(icon({ kind: 'camera', label: 'A', kelvin: 5600 }))).toBe('');
  });
});
