import type { InstanceRelease } from '@inkadra/shared';
import { expect, it } from 'vitest';
import { releaseNews } from './updates.ts';

const release: InstanceRelease = {
  version: '0.9.0',
  publishedAt: null,
  prerelease: false,
  url: 'https://github.com/inkadra/inkadra/releases/tag/v0.9.0',
  highlights: ['From the body'],
  beforeUpdating: [],
};
const it_ = { highlights: ['Novità'], beforeUpdating: ['Leggi'] };
const en = { highlights: ['News'], beforeUpdating: ['Read'] };

it("picks the reader's language, then English, then the release body", () => {
  expect(releaseNews({ ...release, notes: { it: it_, en } }, 'it-IT')).toEqual(it_);
  expect(releaseNews({ ...release, notes: { it: it_, en } }, 'pt')).toEqual(en);
  expect(releaseNews({ ...release, notes: { it: it_ } }, 'de')).toEqual({
    highlights: ['From the body'],
    beforeUpdating: [],
  });
  expect(releaseNews({ ...release, highlights: [] }, 'en').highlights).toEqual([]);
});
