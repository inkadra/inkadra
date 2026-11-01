import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureFreeSpace,
  NotEnoughSpace,
  privateInput,
  STALE_JOB_MS,
  sweepJobDirs,
  withJobDir,
} from './scratch.ts';

describe('job folders', () => {
  it('gives each job a folder of its own and removes it, even on failure', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'inkadra-scratch-'));
    let seen = '';
    await expect(
      withJobDir(tmp, async (dir) => {
        seen = dir;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(seen.startsWith(join(tmp, 'job-'))).toBe(true);
    expect(await readdir(tmp)).toEqual([]);
  });

  it('sweeps only job folders a crash left behind', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'inkadra-scratch-'));
    for (const name of ['job-old', 'job-new', 'clip-old']) await mkdir(join(tmp, name));
    const old = new Date(Date.now() - STALE_JOB_MS - 60_000);
    await utimes(join(tmp, 'job-old'), old, old);
    await utimes(join(tmp, 'clip-old'), old, old);
    expect(await sweepJobDirs(tmp)).toBe(1);
    expect((await readdir(tmp)).sort()).toEqual(['clip-old', 'job-new']);
  });

  it('refuses a job that would not fit on the volume', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'inkadra-scratch-'));
    await expect(ensureFreeSpace(tmp, 2 ** 60, 'a test')).rejects.toBeInstanceOf(NotEnoughSpace);
    await expect(ensureFreeSpace(tmp, 1, 'a test')).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'gives the tools a link to the original alone in a private folder',
    async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'inkadra-scratch-'));
      const originals = join(tmp, 'files', 'originals');
      await mkdir(originals, { recursive: true });
      await writeFile(join(originals, 'a'), 'video');
      await writeFile(join(originals, 'b'), 'someone else');
      await withJobDir(join(tmp, 'tmp'), async (dir) => {
        const input = await privateInput(dir, join(originals, 'a'));
        expect(input).toBe(join(dir, 'in', 'source'));
        expect((await lstat(input)).isSymbolicLink()).toBe(true);
        expect(await realpath(input)).toBe(await realpath(join(originals, 'a')));
        expect(await readFile(input, 'utf8')).toBe('video');
        // Nothing beside it: a relative reference finds no other original.
        expect(await readdir(join(dir, 'in'))).toEqual(['source']);
        expect((await stat(join(dir, 'in'))).mode & 0o777).toBe(0o700);
      });
      // The link goes with the job; the original stays.
      expect(await readFile(join(originals, 'a'), 'utf8')).toBe('video');
    },
  );
});
