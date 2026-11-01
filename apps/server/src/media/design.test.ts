// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../http/uploads.ts';
import { writeZip } from '../transfers/zip.ts';
import { archiveDesignPreview, designExtension, photoshopPreview } from './design.ts';
import { runTool } from './tools.ts';

vi.mock('./tools.ts', () => ({ runTool: vi.fn() }));
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkadra-design-'));
});
async function archive(name: string) {
  const path = join(dir, `${Math.random()}.zip`);
  const zip = writeZip(path);
  await zip.addBuffer(name, 'small generated preview');
  await zip.close();
  return path;
}

describe('design previews', () => {
  it.each(['psd', 'psb', 'procreate', 'sketch', 'afdesign', 'afphoto', 'ai'])(
    'keeps %s as an original file',
    (ext) => {
      expect(designExtension(`art.${ext.toUpperCase()}`)).toBe(ext);
      expect(kindOf('image/vnd.adobe.photoshop', `art.${ext}`)).toBe('file');
    },
  );
  it.each([
    ['procreate', 'QuickLook/Thumbnail.png'],
    ['sketch', 'previews/preview.png'],
    ['afdesign', 'previews/preview.png'],
    ['afphoto', 'QuickLook/Thumbnail.png'],
  ])('reads only the embedded %s preview', async (ext, name) => {
    expect((await archiveDesignPreview(await archive(name), ext))?.toString()).toBe(
      'small generated preview',
    );
    expect(await archiveDesignPreview(await archive('other.png'), ext)).toBeNull();
  });
  it.each(['psd', 'psb'])(
    'bounds exiftool for %s thumbnails and tolerates absent thumbnails',
    async () => {
      vi.mocked(runTool)
        .mockResolvedValueOnce(Buffer.from('jpeg'))
        .mockResolvedValueOnce(Buffer.alloc(0));
      expect(await photoshopPreview('exiftool', 'source')).toEqual(Buffer.from('jpeg'));
      expect(runTool).toHaveBeenCalledWith(
        'exiftool',
        ['-b', '-PhotoshopThumbnail', 'source'],
        expect.objectContaining({ timeoutMs: 30_000, nice: true, memoryBytes: 2 * 1024 ** 3 }),
      );
      expect(await photoshopPreview('exiftool', 'source')).toBeNull();
    },
  );
  it.each(['traversal', 'huge', 'many', 'bomb'])(
    'rejects a malicious archive: %s',
    async (attack) => {
      const path = await archive('previews/preview.png');
      const data = await readFile(path);
      const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      if (attack === 'traversal') Buffer.from('../evil/preview.png!').copy(data, central + 46);
      if (attack === 'huge') data.writeUInt32LE(65 * 1024 ** 2, central + 24);
      if (attack === 'bomb') {
        data.writeUInt32LE(2 * 1024 ** 2, central + 24);
        data.writeUInt32LE(1, central + 20);
      }
      if (attack === 'many') {
        data.writeUInt16LE(10_001, data.length - 14);
        data.writeUInt16LE(10_001, data.length - 12);
      }
      await writeFile(path, data);
      await expect(archiveDesignPreview(path, 'sketch')).rejects.toThrow();
    },
  );
});
