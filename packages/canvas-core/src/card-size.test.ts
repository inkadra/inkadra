// SPDX-License-Identifier: MPL-2.0
import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { estimateHeight } from './card-size.ts';

const card = (type: string, patch: Record<string, unknown> = {}) =>
  ({ id: 'card', type, w: 240, ...patch }) as unknown as Element;

describe('estimateHeight', () => {
  it('gives each card type its height before the first measure', () => {
    expect(estimateHeight(card('note'))).toBe(64);
    expect(estimateHeight(card('column'))).toBe(120);
    expect(estimateHeight(card('scene'))).toBe(120);
    expect(estimateHeight(card('board'))).toBe(66);
    expect(estimateHeight(card('section'))).toBe(44);
    expect(estimateHeight(card('color', { w: 90 }))).toBe(90);
  });

  it('grows with the items of a to-do list and the rows of a table', () => {
    expect(estimateHeight(card('todo', { items: [] }))).toBe(48);
    expect(estimateHeight(card('todo', { items: [{}, {}, {}] }))).toBe(48 + 3 * 26);
    expect(estimateHeight(card('table', { rows: [] }))).toBe(2);
    expect(estimateHeight(card('table', { rows: [{}, {}] }))).toBe(64);
  });

  it('rounds the proportional heights of frames, plans and maps', () => {
    expect(estimateHeight(card('frame', { w: 241 }))).toBe(135 + 48);
    expect(estimateHeight(card('plan', { w: 241 }))).toBe(161 + 34);
    expect(estimateHeight(card('map', { w: 241 }))).toBe(52);
    expect(estimateHeight(card('map', { w: 241, imageAssetId: 'a' }))).toBe(132 + 52);
  });

  it('keeps an image at 4:3, cropped and rotated', () => {
    expect(estimateHeight(card('image'))).toBe(180);
    expect(estimateHeight(card('image', { rotation: 90 }))).toBe(320);
    expect(estimateHeight(card('image', { crop: { x: 0, y: 0, w: 1, h: 0.5 } }))).toBe(90);
  });
});
