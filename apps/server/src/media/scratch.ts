import { mkdir, mkdtemp, readdir, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';

/** Prefix of the scratch folder of one media job, in DATA_DIR/tmp. */
const JOB_PREFIX = 'job-';

/**
 * Longer than any media job runs (a playable copy stops at 4 hours): a job folder this old
 * was left by a process that died, never by one still at work in another container.
 */
export const STALE_JOB_MS = 6 * 60 * 60 * 1000;

/**
 * Runs `work` with a scratch folder of its own (`tmpDir/job-XXXXXX`) for every temporary file
 * of one job: the copy of the source, posters, previews, rendered pages, the playable copy.
 * The folder goes when the job ends, whatever happened; `sweepJobDirs` takes the ones a crash
 * left behind.
 */
export async function withJobDir<T>(tmpDir: string, work: (dir: string) => Promise<T>) {
  await mkdir(tmpDir, { recursive: true });
  const dir = await mkdtemp(join(tmpDir, JOB_PREFIX));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Removes job folders older than `olderThanMs` (by mtime); returns how many went. */
export async function sweepJobDirs(tmpDir: string, olderThanMs = STALE_JOB_MS, now = Date.now()) {
  const names = await readdir(tmpDir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(JOB_PREFIX)) continue;
    const path = join(tmpDir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory() || now - info.mtimeMs < olderThanMs) continue;
    await rm(path, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** Bytes free for this process in the file system of `dir`; null where it cannot tell. */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const fs = await statfs(dir);
    return fs.bavail * fs.bsize;
  } catch {
    return null;
  }
}

/** The volume of the scratch files is too full for the job: worth another try later. */
export class NotEnoughSpace extends Error {}

/** Throws NotEnoughSpace unless `bytes` (plus a 256 MB margin) are free in `dir`. */
export async function ensureFreeSpace(dir: string, bytes: number, what: string) {
  const free = await freeBytes(dir);
  const needed = bytes + 256 * 1024 * 1024;
  if (free !== null && free < needed)
    throw new NotEnoughSpace(
      `Not enough free space for ${what}: ${Math.round(needed / 1024 ** 2)} MB needed, ` +
        `${Math.round(free / 1024 ** 2)} MB free in ${dir}.`,
    );
}
