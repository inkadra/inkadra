import { expect, it } from 'vitest';
import { easeZoom, WHEEL_STEP, wheelZoomFactor } from './wheel-zoom.ts';

it('zooms about 12 % per mouse wheel notch, in either direction', () => {
  for (const notch of [100, 120]) {
    const { factor, discrete } = wheelZoomFactor(-notch, 0);
    expect(discrete).toBe(true);
    expect(factor).toBeCloseTo(WHEEL_STEP, 5);
    expect(factor).toBeGreaterThan(1.1);
    expect(factor).toBeLessThan(1.15);
    expect(wheelZoomFactor(notch, 0).factor).toBeCloseTo(1 / WHEEL_STEP, 5);
  }
});

it('treats a line-mode notch (Firefox) as one step', () => {
  expect(wheelZoomFactor(-3, 1).factor).toBeCloseTo(WHEEL_STEP, 5);
  expect(wheelZoomFactor(1, 1).factor).toBeCloseTo(1 / WHEEL_STEP, 5);
});

it('clamps very large deltas to two notches', () => {
  expect(wheelZoomFactor(-5000, 0).factor).toBeCloseTo(WHEEL_STEP ** 2, 5);
  expect(wheelZoomFactor(900, 1).factor).toBeCloseTo(WHEEL_STEP ** -2, 5);
});

it('leaves trackpad pinch continuous and direct', () => {
  const small = wheelZoomFactor(-4.5, 0);
  expect(small.discrete).toBe(false);
  expect(small.factor).toBeCloseTo(Math.exp(0.045), 5);
  expect(wheelZoomFactor(12.25, 0).discrete).toBe(false);
  expect(wheelZoomFactor(0, 0).factor).toBe(1);
});

it('eases toward the target and lands on it', () => {
  const half = easeZoom(1, 2, 60);
  expect(half).toBeGreaterThan(1);
  expect(half).toBeLessThan(2);
  let z = 1;
  for (let i = 0; i < 30; i++) z = easeZoom(z, 2, 16);
  expect(z).toBe(2);
  expect(easeZoom(1, 0.5, 1000)).toBe(0.5);
});
