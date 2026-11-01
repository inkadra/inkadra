// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { OfficePartParams, OfficePreview } from './assets.ts';

it('bounds Office derivatives and rejects arbitrary part paths', () => {
  expect(
    OfficePreview.safeParse({
      pageCount: 6,
      sheets: [{ name: 'Budget', rows: [['Name', '=1+1']] }],
    }).success,
  ).toBe(true);
  for (const value of [
    { pageCount: 51, sheets: [] },
    { pageCount: 0, sheets: [{ name: 'Huge', rows: [['x'.repeat(2001)]] }] },
    { pageCount: 0, sheets: [{ name: 'Huge', rows: [Array(21).fill('x')] }] },
  ])
    expect(OfficePreview.safeParse(value).success).toBe(false);
  expect(OfficePartParams.shape.part.safeParse('page-50.webp').success).toBe(true);
  expect(OfficePartParams.shape.part.safeParse('../original').success).toBe(false);
  expect(OfficePartParams.shape.part.safeParse('page-51.webp').success).toBe(false);
});
