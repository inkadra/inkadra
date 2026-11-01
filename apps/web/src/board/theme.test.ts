// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_PROJECT_THEME, ThemeColor } from '@inkadra/shared';
import { dark, light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import { contrast, headingFamily, paperAccent, resolveTheme } from './theme.ts';

describe('project theme', () => {
  it('follows the project colour and Inter until something else is chosen', () => {
    expect(resolveTheme(null)).toEqual({ color: 'neutral', headingFont: 'inter' });
    expect(resolveTheme({ theme: DEFAULT_PROJECT_THEME, projectColor: 'green' })).toEqual({
      color: 'green',
      headingFont: 'inter',
    });
    expect(
      resolveTheme({ theme: { accent: 'teal', headingFont: 'fraunces' }, projectColor: 'green' }),
    ).toEqual({ color: 'teal', headingFont: 'fraunces' });
    expect(headingFamily('fraunces')).toMatch(/Fraunces.*Inter/);
  });

  it('measures contrast like WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
  });

  it('prints every accent in its darker variant, readable on white', () => {
    for (const color of ThemeColor.options) {
      const hex = paperAccent(color);
      expect(contrast(hex, '#FFFFFF'), color).toBeGreaterThanOrEqual(4.5);
      if (color !== 'neutral') expect(hex).not.toBe(dark[`tag-${color}`]);
    }
    expect(paperAccent('green')).toBe(light['tag-green']);
  });
});
