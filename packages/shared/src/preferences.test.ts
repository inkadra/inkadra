// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { addPlanRecents, readUserPreferences, togglePlanFavorite } from './preferences.ts';

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

it("keeps the set plan editor's choices: defaults, types, the hidden groups once each and capped", () => {
  expect(readUserPreferences(null)).toMatchObject({
    planSnap: true,
    planAttach: true,
    planGhosts: true,
    planHidden: [],
    planShelf: 'lights',
  });
  const read = readUserPreferences({
    planSnap: false,
    planAttach: 'no',
    planGhosts: 0,
    planHidden: ['camera', 'grip', 'camera', 'x'.repeat(41), 7, ''],
    planShelf: 'people',
  });
  expect(read).toMatchObject({ planSnap: false, planAttach: true, planGhosts: true });
  // Group names, once each; a name too long or not a string is dropped, not the whole list.
  expect(read.planHidden).toEqual(['camera', 'grip']);
  expect(read.planShelf).toBe('people');
  // A list that is valid as a whole loses its repeats too.
  expect(readUserPreferences({ planHidden: ['set', 'set'] }).planHidden).toEqual(['set']);
  expect(
    readUserPreferences({ planHidden: Array.from({ length: 14 }, (_, i) => `g${i}`) }).planHidden,
  ).toHaveLength(10);
  expect(readUserPreferences({ planShelf: 'x'.repeat(41) }).planShelf).toBe('lights');
  expect(readUserPreferences({ planShelf: '' }).planShelf).toBe('lights');
});

it('puts the set plan icons just placed first in the recents, once each and capped', () => {
  expect(addPlanRecents(['fresnel', 'flag'], ['softbox'])).toEqual(['softbox', 'fresnel', 'flag']);
  // Placed again: moved to the front, not listed twice.
  expect(addPlanRecents(['fresnel', 'flag', 'softbox'], ['softbox'])).toEqual([
    'softbox',
    'fresnel',
    'flag',
  ]);
  // A burst, newest first, merged with the stored list; a kind this build does not know stays.
  expect(addPlanRecents(['hologram', 'flag'], ['cob', 'flag'])).toEqual([
    'cob',
    'flag',
    'hologram',
  ]);
  const full = Array.from({ length: 8 }, (_, i) => `kind${i}`);
  expect(addPlanRecents(full, ['new'])).toEqual(['new', ...full.slice(0, 7)]);
  expect(addPlanRecents([], [])).toEqual([]);
});

it('stars a set plan icon last, or unstars it, keeping kinds this build does not know', () => {
  expect(togglePlanFavorite(['fresnel', 'hologram'], 'softbox')).toEqual([
    'fresnel',
    'hologram',
    'softbox',
  ]);
  expect(togglePlanFavorite(['fresnel', 'hologram', 'softbox'], 'fresnel')).toEqual([
    'hologram',
    'softbox',
  ]);
  expect(togglePlanFavorite([], 'arrow')).toEqual(['arrow']);
});
