import { describe, expect, it } from 'vitest';
import { aboveChrome } from './Pill.tsx';

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('aboveChrome', () => {
  const pill = box(460, 740, 360, 40);

  it('lifts a pill above the dock it would cover', () => {
    expect(aboveChrome(pill, [box(420, 730, 720, 54)], 800)).toBe(82);
  });

  it('ignores chrome beside it, above it, hidden or in the top half', () => {
    const corner = box(16, 750, 150, 34);
    const actions = box(400, 660, 700, 40);
    const hidden = box(400, 760, 0, 0);
    const header = box(0, 10, 1280, 44);
    expect(aboveChrome(pill, [corner, actions, hidden, header], 800)).toBe(0);
  });

  it('clears stacked chrome, the lowest first', () => {
    const phonePill = box(12, 790, 366, 44);
    const tabs = box(0, 780, 390, 64);
    expect(aboveChrome(phonePill, [tabs, box(12, 657, 225, 44)], 844)).toBe(76);
    expect(aboveChrome(phonePill, [tabs, box(12, 700, 225, 44)], 844)).toBe(156);
  });
});
