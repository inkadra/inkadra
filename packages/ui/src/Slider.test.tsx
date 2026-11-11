// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Slider } from './components.tsx';

const props = { min: -50, max: 50, value: 0, 'aria-label': 'Value', onChange: () => {} };

it.each([
  [-100, '0%'],
  [0, '50%'],
  [100, '100%'],
])('clamps the fill for %s', (value, fill) => {
  expect(Slider({ ...props, value }).props.style['--ink-slider-fill']).toBe(fill);
});

it('handles a collapsed range', () => {
  expect(Slider({ ...props, max: -50 }).props.style['--ink-slider-fill']).toBe('0%');
});

it('passes meaningful colours to CSS without leaking the prop to the input', () => {
  const meaning = {
    gradient: 'linear-gradient(to right, var(--ink-surface-1), var(--ink-text-primary))',
    thumbColor: 'var(--ink-text-secondary)',
  };
  const input = Slider({ ...props, meaning });
  expect(input.props.className).toContain('ink-slider--meaning');
  expect(input.props.style['--ink-slider-track']).toBe(meaning.gradient);
  expect(input.props.style['--ink-slider-thumb']).toBe(meaning.thumbColor);
  expect(input.props.meaning).toBeUndefined();
  expect(Slider(props).props.className).toBe('ink-slider');
});

it('draws the same outer thumb in Gecko as in WebKit', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const block = (selector: string) => css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
  // WebKit: the size includes the border.
  const webkit = block('.ink-slider::-webkit-slider-thumb');
  expect(webkit).toContain('box-sizing: border-box;');
  expect(webkit).toContain('width: var(--ink-slider-size);');
  // Gecko adds the border outside the size, so the content is the size less both borders.
  const gecko = block('.ink-slider::-moz-range-thumb');
  expect(gecko).toContain('box-sizing: content-box;');
  expect(gecko).toContain('width: calc(var(--ink-slider-size) - 2 * var(--ink-slider-border-width));');
  expect(gecko).toContain('height: calc(var(--ink-slider-size) - 2 * var(--ink-slider-border-width));');
  expect(gecko).toContain('border: var(--ink-slider-border-width) solid');
});
