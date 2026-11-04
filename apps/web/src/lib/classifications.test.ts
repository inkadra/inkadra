import { DEFAULT_CLASSIFICATIONS } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { shotText } from './classifications.ts';

const t = ((key: string) => key) as unknown as TFunction;
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
