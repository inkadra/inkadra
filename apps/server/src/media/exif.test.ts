import { describe, expect, it } from 'vitest';
import { pickExif } from './exif.ts';

describe('pickExif', () => {
  it('keeps camera data and drops location and unknown fields', () => {
    const exif = pickExif({
      Make: 'FUJIFILM',
      Model: ' X-T5 ',
      FNumber: 2.8,
      ISO: 400,
      DateTimeOriginal: new Date('2026-10-01T10:00:00Z'),
      latitude: 45.07,
      longitude: 7.68,
      GPSLatitude: [45, 4, 12],
      GPSAltitude: 240,
      MakerNote: 'x'.repeat(5000),
    });
    expect(exif).toEqual({
      Make: 'FUJIFILM',
      Model: 'X-T5',
      FNumber: 2.8,
      ISO: 400,
      DateTimeOriginal: '2026-10-01T10:00:00.000Z',
    });
  });

  it('returns null when nothing useful is left', () => {
    expect(pickExif({ GPSLatitude: [1, 2, 3] })).toBeNull();
    expect(pickExif(undefined)).toBeNull();
  });
});
