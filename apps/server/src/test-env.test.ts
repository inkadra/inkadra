import { expect, it } from 'vitest';
import { missingTestEnv } from './test-env.ts';

const tools = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  exiftool: 'exiftool',
  pdftoppm: 'p',
  pdfinfo: 'p',
};

it('lets local runs skip, and names what a CI run lacks', () => {
  expect(missingTestEnv({}, {})).toEqual([]);
  expect(missingTestEnv({ CI: 'true', DATABASE_URL: 'pg' }, {})).toEqual(['REDIS_URL']);
  const ci = { CI: 'true', DATABASE_URL: 'pg', REDIS_URL: 'redis' };
  expect(missingTestEnv(ci, {})).toEqual([]);
  expect(missingTestEnv({ ...ci, INKADRA_TEST_MEDIA_TOOLS: 'required' }, tools)).toEqual([]);
  expect(
    missingTestEnv({ ...ci, INKADRA_TEST_MEDIA_TOOLS: 'required' }, { ...tools, exiftool: null }),
  ).toEqual(['exiftool']);
});
