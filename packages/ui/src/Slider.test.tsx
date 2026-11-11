// SPDX-License-Identifier: MPL-2.0
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
