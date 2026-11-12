// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLASSIFICATIONS,
  isRenamedDefault,
  shotOptionLabel,
  shotText,
} from './classifications.ts';
import { SHOT_WORDS_EN, type ShotWords, type Words } from './shot-words.ts';
import { SHOT_WORDS_IT } from './shot-words-it.ts';

/** A language's words read as i18next reads them; a key the package does not carry throws. */
const reader =
  (words: ShotWords): Words =>
  (key) => {
    const text = key
      .split('.')
      .reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], words);
    if (typeof text !== 'string') throw new Error(`No word for ${key}`);
    return text;
  };
const english = reader(SHOT_WORDS_EN);
const italian = reader(SHOT_WORDS_IT);
const t = ((key: string) => key) as Words;
const added = '0b6f4f0e-7e0c-4a7c-9a64-6f4e7c3d2a11';
const catalogs = {
  ...DEFAULT_CLASSIFICATIONS,
  shotSizes: [
    { id: 'ws', label: 'Wide', archived: false },
    { id: 'ms', label: 'Piano americano', archived: false },
    { id: 'cu', label: 'Primissimo', archived: true },
    { id: added, label: 'Totale', archived: true },
  ],
};

it('reads a frame field from the catalog, whatever happened to the value', () => {
  expect(shotText(catalogs, 'shotSizes', undefined, t)).toBe('');
  expect(shotText(catalogs, 'shotSizes', 'ws', t)).toBe('film.shot.ws');
  expect(shotText(catalogs, 'shotSizes', 'ms', t)).toBe('Piano americano');
  expect(shotText(catalogs, 'shotSizes', 'cu', t)).toBe('Primissimo');
  expect(shotText(catalogs, 'shotSizes', added, t)).toBe('Totale');
  expect(shotText(catalogs, 'shotSizes', 'Testo libero', t)).toBe('Testo libero');
});

it('never shows the id of a value it does not know', () => {
  expect(shotText(catalogs, 'shotSizes', '11111111-2222-4333-8444-555555555555', t)).toBe('');
});

it('reads an empty field as nothing', () => {
  expect(shotText(DEFAULT_CLASSIFICATIONS, 'shotAngles', '', english)).toBe('');
});

describe.each([
  ['shotSizes', 'cu', 'Close-up', 'Primo piano'],
  ['shotAngles', 'ots', 'Over the shoulder', 'Di spalla'],
  ['shotMovements', 'handheld', 'Handheld', 'A mano'],
] as const)('a default value of %s', (key, id, en, it_) => {
  it('is written in the reader’s language, from the shared words', () => {
    expect(shotText(DEFAULT_CLASSIFICATIONS, key, id, english)).toBe(en);
    expect(shotText(DEFAULT_CLASSIFICATIONS, key, id, italian)).toBe(it_);
  });

  it('has its one name once renamed, in every language', () => {
    const renamed = { ...DEFAULT_CLASSIFICATIONS, [key]: [{ id, label: 'Ours', archived: false }] };
    expect(isRenamedDefault(key, { id, label: 'Ours', archived: false })).toBe(true);
    expect(isRenamedDefault(key, { id, label: en, archived: false })).toBe(false);
    expect(shotText(renamed, key, id, italian)).toBe('Ours');
  });

  it('keeps text typed in the field, even when it reads like an id', () => {
    expect(shotText(DEFAULT_CLASSIFICATIONS, key, `${id} (2)`, italian)).toBe(`${id} (2)`);
  });
});

it('names every default value of every catalog with a word English has', () => {
  for (const key of ['shotSizes', 'shotAngles', 'shotMovements'] as const)
    for (const option of DEFAULT_CLASSIFICATIONS[key])
      expect(shotOptionLabel(key, option, english)).toBe(option.label);
});

it('names a value added to a catalog by its label', () => {
  expect(
    shotOptionLabel('shotAngles', { id: added, label: 'Rasoterra', archived: false }, english),
  ).toBe('Rasoterra');
});
