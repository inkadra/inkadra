// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { readUserPreferences } from './preferences.ts';

it('keeps the valid icons of a list with a bad entry, once each and within the limit', () => {
  const read = readUserPreferences({
    planFavorites: ['led', 42, 'led', 'hologram', ''],
    planRecents: Array.from({ length: 12 }, (_, i) => `kind${i}`),
  });
  expect(read.planFavorites).toEqual(['led', 'hologram']);
  expect(read.planRecents).toHaveLength(8);
});
