import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeAvatar } from './account-routes.ts';

describe('account avatar validation', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'normalizes %s to a small static WebP',
    async (format) => {
      const input = await sharp({
        create: { width: 600, height: 300, channels: 3, background: 'red' },
      })
        .toFormat(format)
        .toBuffer();
      const result = await normalizeAvatar(input);
      expect(await sharp(result).metadata()).toMatchObject({
        format: 'webp',
        width: 256,
        height: 256,
      });
    },
  );
  it('rejects SVG, malformed content and oversized uploads', async () => {
    for (const input of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'),
      Buffer.from('not an image'),
      Buffer.alloc(1024 * 1024 + 1),
    ]) {
      await expect(normalizeAvatar(input)).rejects.toThrow();
    }
  });
  it('rejects excessive decoded dimensions even for a small compressed file', async () => {
    const input = await sharp({
      create: { width: 4100, height: 4100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(normalizeAvatar(input)).rejects.toThrow();
  });
});
