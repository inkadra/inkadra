import { mkdir, mkdtemp, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureFreeSpace,
  NotEnoughSpace,
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
});
