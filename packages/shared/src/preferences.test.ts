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

it('keeps the valid tutorial ids and offers tutorials by default', () => {
  expect(readUserPreferences(null)).toMatchObject({ tutorialsSeen: [], tutorialHints: true });
  const read = readUserPreferences({
    tutorialsSeen: ['welcome', 'x'.repeat(41), 'welcome', 'storyboard'],
    tutorialHints: false,
  });
  expect(read.tutorialsSeen).toEqual(['welcome', 'storyboard']);
  expect(read.tutorialHints).toBe(false);
});

it('opens the Server page in the simple view until an administrator picks the advanced one', () => {
  expect(readUserPreferences(null).serverView).toBe('simple');
  expect(readUserPreferences({ serverView: 'advanced' }).serverView).toBe('advanced');
  expect(readUserPreferences({ serverView: 'charts' }).serverView).toBe('simple');
});

it('groups shots by scene until this person picks another grouping', () => {
  expect(readUserPreferences(null).shotGroupBy).toBe('scene');
  expect(readUserPreferences({ shotGroupBy: 'setup' }).shotGroupBy).toBe('setup');
  expect(readUserPreferences({ shotGroupBy: 'camera' }).shotGroupBy).toBe('scene');
});
