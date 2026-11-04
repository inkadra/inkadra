import type { Element } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  boardCast,
  characterAppearance,
  characterSceneCount,
  characterSubtitle,
} from './cast-appearances.ts';
import {
  mapSearchUrl,
  parseMapUrl,
  parseScenes,
  withRelation,
} from './StoryCardPanel.tsx';

describe('story card fields', () => {
  it('reads scene numbers as written, once each', () => {
    expect(parseScenes('1, 3A; 12 3A')).toEqual(['1', '3A', '12']);
    expect(parseScenes('  ,  ')).toBeUndefined();
    expect(parseScenes('1234567890123')).toEqual(['123456789012']);
  });

  it('keeps only web addresses as map links', () => {
    expect(parseMapUrl(' https://www.openstreetmap.org/#map=18/45.48/9.20 ')).toBe(
      'https://www.openstreetmap.org/#map=18/45.48/9.20',
    );
    expect(parseMapUrl('javascript:alert(1)')).toBeNull();
    expect(parseMapUrl('Piazza Duca d’Aosta')).toBeNull();
    expect(parseMapUrl('https://user:secret@maps.example.com/')).toBeNull();
    expect(parseMapUrl('https://user@maps.example.com/')).toBeNull();
    const long = `https://maps.example.com/?q=${'a'.repeat(2048)}`;
    expect(parseMapUrl(long)).toBeNull();
    expect(parseMapUrl(long.slice(0, 2048))).toBe(long.slice(0, 2048));
  });

  it('looks addresses up on OpenStreetMap without embedding a map', () => {
    expect(mapSearchUrl('Piazza Duca d’Aosta 1, Milano')).toBe(
      'https://www.openstreetmap.org/search?query=Piazza%20Duca%20d%E2%80%99Aosta%201%2C%20Milano',
    );
  });
});

it('finds where a character appears, by cast name, on this board and on others', () => {
  const elements = [
    { id: 'scene1234', type: 'scene', number: '3A', z: 'a0', parent: null },
    { id: 'frame1234', type: 'frame', parent: 'scene1234', z: 'a1', cast: [' MARTA '] },
    { id: 'frame5678', type: 'frame', parent: 'scene1234', z: 'a2', cast: ['Marta'] },
    { id: 'frame9999', type: 'frame', parent: null, z: 'a3', cast: ['Marta'] },
  ] as unknown as Element[];
  const here = boardCast({ byId: new Map(elements.map((el) => [el.id, el])) });
  const other = [{ name: 'marta', frames: 2, scenes: ['3A', '12'] }];
  expect(characterAppearance('Marta', here)).toEqual({ frames: 3, scenes: ['3A'] });
  expect(characterAppearance('marta', [...here, ...other])).toEqual({
    frames: 5,
    scenes: ['3A', '12'],
  });
  expect(characterAppearance('Paolo', here)).toEqual({ frames: 0, scenes: [] });
  expect(characterAppearance('', here)).toEqual({ frames: 0, scenes: [] });
});

it('counts the scenes of a character once, from its frames and its manual field', () => {
  const cast = [{ name: 'marta', frames: 2, scenes: ['3A', '12'] }];
  expect(characterSceneCount({ name: 'Marta', scenes: ['12', '1'] }, cast)).toBe(3);
  expect(characterSceneCount({ name: 'Paolo' }, cast)).toBe(0);
});

it('works out the cast of a board once for all its cards, until the board changes', () => {
  const byId = new Map<string, Element>();
  expect(boardCast({ byId })).toBe(boardCast({ byId }));
  expect(boardCast({ byId: new Map() })).not.toBe(boardCast({ byId }));
});

it('stops at the limit the schema allows: one more would make the card invalid', () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ characterId: `c${i}`, label: '' }));
  expect(withRelation(full, { characterId: 'more', label: '' })).toHaveLength(100);
  expect(withRelation(full.slice(1), { characterId: 'more', label: '' })).toHaveLength(100);
});

it('writes a plain age in words and keeps anything else as written', () => {
  const t = ((_: string, { age }: { age: string }) => `${age} anni`) as unknown as TFunction;
  expect(characterSubtitle({ role: 'Spalla', age: '36' }, t)).toBe('Spalla · 36 anni');
  expect(characterSubtitle({ age: 'circa 60' }, t)).toBe('circa 60');
  expect(characterSubtitle({}, t)).toBe('');
});
