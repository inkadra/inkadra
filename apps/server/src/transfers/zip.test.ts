import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import yauzl from 'yauzl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ArchiveError, readZip, streamOf, writeZip } from './zip.ts';

const limits = { entries: 100, totalBytes: 50 * 1024 * 1024, compressionRatio: 200 };
let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkadra-zip-'));
});

async function zipOf(entries: Record<string, Buffer | string>, name = 'a.zip') {
  const path = join(dir, name);
  const zip = writeZip(path);
  for (const [entry, data] of Object.entries(entries)) await zip.addBuffer(entry, data);
  await zip.close();
  return path;
}

const reason = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'ok';
  } catch (err) {
    return err instanceof ArchiveError ? err.reason : String(err);
  }
};

describe('zip archives', () => {
  it('writes buffers and streams and reads them back with a schema', async () => {
    const path = join(dir, 'round.zip');
    const zip = writeZip(path);
    await zip.addJson('manifest.json', { hello: 'world' });
    await zip.addStream('files/one', streamOf(Buffer.from('bytes')), { compress: false, size: 5 });
    const size = await zip.close();
    expect(size).toBeGreaterThan(0);
    const read = await readZip(path, limits);
    expect(read.names().sort()).toEqual(['files/one', 'manifest.json']);
    expect(await read.json('manifest.json', z.object({ hello: z.string() }), 1024)).toEqual({
      hello: 'world',
    });
    expect((await read.buffer('files/one', 10)).toString()).toBe('bytes');
    expect(await reason(read.buffer('files/one', 4))).toBe('too_large');
    expect(await reason(read.json('manifest.json', z.object({ other: z.string() }), 1024))).toBe(
      'invalid_archive',
    );
    expect(await reason(read.buffer('missing', 10))).toBe('invalid_archive');
    read.close();
  });

  afterEach(() => vi.restoreAllMocks());

  it('destroys the yauzl stream when an entry is destroyed half read', async () => {
    // Without it the source only gets unpiped and keeps its reference on the file.
    const opened: NodeJS.ReadableStream[] = [];
    const open = yauzl.ZipFile.prototype.openReadStream;
    vi.spyOn(yauzl.ZipFile.prototype, 'openReadStream').mockImplementation(function (
      this: yauzl.ZipFile,
      ...args: unknown[]
    ) {
      const cb = args.at(-1) as (err: Error | null, s?: NodeJS.ReadableStream) => void;
      args[args.length - 1] = (err: Error | null, s?: NodeJS.ReadableStream) => {
        if (s) opened.push(s);
        cb(err, s);
      };
      return (open as (...a: unknown[]) => void).apply(this, args);
    } as never);
    const big = randomBytes(2 * 1024 * 1024);
    const path = join(dir, 'half.zip');
    const writer = writeZip(path);
    await writer.addBuffer('stored', big, false);
    await writer.addBuffer('deflated', big, true);
    await writer.close();
    const read = await readZip(path, { ...limits, compressionRatio: 1e9 });
    for (const name of ['stored', 'deflated']) {
      const entry = await read.stream(name, Number.MAX_SAFE_INTEGER);
      const source = opened.at(-1) as unknown as { destroyed: boolean };
      await new Promise((resolve) => entry.once('data', resolve));
      expect(source.destroyed, name).toBe(false);
      await new Promise((resolve) => {
        entry.once('close', resolve);
        entry.destroy();
      });
      expect(source.destroyed, name).toBe(true);
    }
    read.close();
  });

  it('refuses what is not a zip', async () => {
    const path = join(dir, 'plain.zip');
    await writeFile(path, 'not a zip at all');
    expect(await reason(readZip(path, limits))).toBe('invalid_archive');
  });

  it('refuses entry names that climb out of the archive (zip-slip)', async () => {
    const path = await zipOf({ 'aa/evil.txt': 'x', 'manifest.json': '{}' }, 'slip.zip');
    // Same length, so offsets stay valid: rename the entry to ../evil.txt in place.
    const bytes = await readFile(path);
    await writeFile(
      path,
      Buffer.from(bytes.toString('latin1').replaceAll('aa/evil', '../evil'), 'latin1'),
    );
    expect(await reason(readZip(path, limits))).toBe('invalid_archive');
  });

  it('refuses entries that expand too much (zip bombs) and too many bytes in total', async () => {
    const bomb = await zipOf({ 'files/zeros': Buffer.alloc(8 * 1024 * 1024) }, 'bomb.zip');
    expect(await reason(readZip(bomb, limits))).toBe('too_large');
    const big = await zipOf({ 'files/zeros': Buffer.alloc(2 * 1024 * 1024) }, 'big.zip');
    expect(
      await reason(readZip(big, { ...limits, compressionRatio: 1e9, totalBytes: 1024 * 1024 })),
    ).toBe('too_large');
    const many = await zipOf({ a: '1', b: '2', c: '3' }, 'many.zip');
    expect(await reason(readZip(many, { ...limits, entries: 2 }))).toBe('too_large');
  });

  it('fails an entry whose stream is shorter than the size given, instead of hanging', async () => {
    const zip = writeZip(join(dir, 'short.zip'));
    await expect(
      zip.addStream('files/one', streamOf(Buffer.from('12345')), { compress: false, size: 10 }),
    ).rejects.toThrow();
    zip.abort();
  });

  it('refuses duplicate names and symbolic links', async () => {
    // Same length names, renamed in place so the second entry collides with the first.
    const dup = await zipOf({ 'files/aa': 'x', 'files/bb': 'y' }, 'dup.zip');
    const bytes = await readFile(dup);
    await writeFile(
      dup,
      Buffer.from(bytes.toString('latin1').replaceAll('files/bb', 'files/aa'), 'latin1'),
    );
    expect(await reason(readZip(dup, limits))).toBe('invalid_archive');

    const path = join(dir, 'link.zip');
    const zip = writeZip(path);
    await zip.addBuffer('files/aa', 'x');
    await zip.close();
    const raw = await readFile(path);
    // Central directory header: external attributes at offset 38, Unix mode in the high half.
    const at = raw.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    raw.writeUInt32LE((0o120777 << 16) >>> 0, at + 38);
    await writeFile(path, raw);
    expect(await reason(readZip(path, limits))).toBe('invalid_archive');
  });
});
