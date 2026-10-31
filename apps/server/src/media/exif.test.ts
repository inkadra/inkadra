import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { pickExif, readExif } from './exif.ts';

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

  it('reads EXIF from a file path without leaking a FileHandle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkadra-exif-'));
    try {
      const file = join(dir, 'photo.jpg');
      const jpeg = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#C83C28' },
      })
        .jpeg()
        .withExif({
          IFD0: { Make: 'FUJIFILM', Model: 'X-T5' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 12/1' },
        })
        .toBuffer();
      await writeFile(file, jpeg);
      await expect(readExif(file)).resolves.toMatchObject({ Make: 'FUJIFILM', Model: 'X-T5' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
