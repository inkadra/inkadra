import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupManifest } from '@inkadra/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { archiveToRestore, type BackupRemote, restoreBackupFiles, verifyBackup } from './backup.ts';
import { loadConfig } from './config.ts';
import { createStorage, localStorage, readAll, type Storage } from './storage.ts';
import { tempDir } from './test-tmpdir.ts';
import { writeZip } from './transfers/zip.ts';

const log = pino({ level: 'silent' });
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const folder = (name: string) => tempDir(`${name}-`);

/**
 * An archive of a backup with files, as `runBackup` writes one, without tables: `files.jsonl`
 * lists every key, `media.jsonl` the files inside. `inside` replaces the bytes stored in the
 * archive (a damaged entry); `lines` replaces the lines of `media.jsonl` (a forged listing).
 */
async function mediaArchive(
  files: Array<{ key: string; data: Buffer; inside?: Buffer }>,
  opts: { lines?: string[] } = {},
) {
  const path = join(folder('media-archive'), 'inkadra-backup-test.zip');
  const zip = writeZip(path);
  const list = files.map((f) => `${JSON.stringify({ key: f.key, size: null, sha256: null })}\n`);
  const lines =
    opts.lines ??
    files.map((f) => JSON.stringify({ key: f.key, size: f.data.length, sha256: sha(f.data) }));
  const media = lines.map((l) => `${l}\n`).join('');
  await zip.addBuffer('files.jsonl', list.join(''));
  for (const f of files) await zip.addBuffer(`media/${f.key}`, f.inside ?? f.data, false);
  await zip.addBuffer('media.jsonl', media);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: 'test',
    createdAt: new Date().toISOString(),
    migrations: [],
    tables: [],
    rebuilt: [],
    files: { count: files.length, bytes: 0, entry: 'files.jsonl', sha256: sha(list.join('')) },
    media: {
      count: lines.length,
      bytes: files.reduce((n, f) => n + f.data.length, 0),
      missing: 0,
      entry: 'media.jsonl',
      sha256: sha(media),
    },
  };
  await zip.addJson('manifest.json', manifest);
  await zip.close();
  return path;
}

const original = { key: 'originals/still', data: Buffer.from('frame 1'.repeat(500)) };
const thumb = { key: 'variants/still/256.webp', data: Buffer.from('a small picture') };

/** `storage` whose writes fail with a storage error while `fails(key)` says so. */
const failing = (storage: Storage, fails: (key: string) => boolean): Storage => ({
  ...storage,
  async writeStream(key, body, type) {
    if (fails(key)) {
      body.destroy();
      throw new Error('503 Slow Down');
    }
    return storage.writeStream(key, body, type);
  },
});

describe('restoring the files of a backup (#899)', () => {
  it('tries storage errors again, counts lasting failures and finishes on a second run', async () => {
    const file = await mediaArchive([original, thumb]);
    const storage = localStorage(join(folder('restore-files'), 'files'));

    // Down for the original, and only for it: the others go on, the failure is named.
    const down = failing(storage, (key) => key === original.key);
    expect(await restoreBackupFiles({ file, storage: down, log, retryMs: 1 })).toMatchObject({
      restored: 1,
      failed: 1,
      failedExamples: [original.key],
    });
    expect(await storage.size(original.key)).toBeNull();

    // A moment's failure is tried again; the second run writes only what is missing.
    let left = 2;
    const flaky = failing(storage, () => left-- > 0);
    expect(await restoreBackupFiles({ file, storage: flaky, log, retryMs: 1 })).toMatchObject({
      restored: 1,
      kept: 1,
      failed: 0,
      missing: 0,
    });
    expect(await readAll(await storage.read(original.key))).toEqual(original.data);
    expect(await restoreBackupFiles({ file, storage, log })).toMatchObject({
      restored: 0,
      kept: 2,
    });

    // Same size, other bytes: kept on a size check, written again when hashed.
    await storage.write(thumb.key, Buffer.alloc(thumb.data.length, 7), 'image/webp');
    expect(await restoreBackupFiles({ file, storage, log })).toMatchObject({ restored: 0 });
    expect(await restoreBackupFiles({ file, storage, log, hashExisting: true })).toMatchObject({
      restored: 1,
      kept: 1,
    });
    expect(await readAll(await storage.read(thumb.key))).toEqual(thumb.data);
  });

  it('never puts a file whose bytes in the archive are not as listed into storage', async () => {
    const file = await mediaArchive([
      { ...original, inside: Buffer.alloc(original.data.length, 1) },
      thumb,
    ]);
    const root = join(folder('restore-damaged'), 'files');
    const storage = localStorage(root);
    expect(await restoreBackupFiles({ file, storage, log, retryMs: 1 })).toMatchObject({
      restored: 1,
      failed: 1,
      failedExamples: [original.key],
    });
    expect(await storage.size(original.key)).toBeNull();
    // Not renamed into place, and no partial file left either.
    expect(await readdir(join(root, 'originals'))).toEqual([]);
    await expect(verifyBackup(file, storage)).rejects.toThrow(
      /originals\/still does not read back/,
    );
  });

  it('refuses a listing with keys outside the stored files, or not in the file list, before writing', async () => {
    const line = (key: string, data: Buffer) =>
      JSON.stringify({ key, size: data.length, sha256: sha(data) });
    for (const [key, error] of [
      ['backups/inkadra-backup-old.zip', /not a stored file/],
      ['originals/../backups/x', /not a stored file/],
      ['variants/other/256.webp', /not in the file list/],
    ] as const) {
      const file = await mediaArchive([original, thumb], {
        lines: [line(original.key, original.data), line(key, thumb.data)],
      });
      const storage = localStorage(join(folder('restore-forged'), 'files'));
      await expect(restoreBackupFiles({ file, storage, log })).rejects.toThrow(error);
      // Not even the first, well-formed line was written.
      expect(await storage.size(original.key)).toBeNull();
    }
  });

  it('checks the file list within its budget and the files of the archive within theirs', async () => {
    const file = await mediaArchive([original, thumb]);
    const storage = localStorage(join(folder('verify-parts'), 'files'));
    // Storage that never answers: the file list runs out of time, the files are still read.
    const hanging = { ...storage, size: () => new Promise<number | null>(() => {}) };
    const checked = await verifyBackup(file, hanging, { budgetMs: 200 });
    expect(checked).toMatchObject({
      complete: false,
      parts: { tables: true, files: false, media: true },
      media: { checked: 2, count: 2 },
    });
  });
});

describe('downloading an archive to restore (#899)', () => {
  const remoteOf = (storage: Storage): BackupRemote => ({
    storage,
    prefix: 'backups/',
    label: 's3://archives/backups/',
  });

  it('downloads into the backup folder when there is room, and refuses when there is not', async () => {
    const bucket = localStorage(join(folder('download-bucket'), 'files'));
    const name = 'inkadra-backup-20261102-030000-0193f0a4.zip';
    await bucket.write(`backups/${name}`, Buffer.from('zip'), 'application/zip');
    const dir = join(folder('download-dir'), 'backups');
    expect(await archiveToRestore(name, dir, remoteOf(bucket), log)).toEqual({
      path: join(dir, name),
      downloaded: true,
    });
    // Already here: used as it is.
    expect(await archiveToRestore(name, dir, remoteOf(bucket), log)).toEqual({
      path: join(dir, name),
      downloaded: false,
    });

    const huge = { ...bucket, size: async () => Number.MAX_SAFE_INTEGER };
    const other = join(folder('download-full'), 'backups');
    await expect(archiveToRestore(name, other, remoteOf(huge), log)).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(await readdir(other)).toEqual([]);
    await expect(archiveToRestore('absent.zip', other, remoteOf(bucket), log)).rejects.toThrow(
      /neither in/,
    );
  });
});

// Against RustFS or another S3 server, as the storage tests: S3_TEST_ENDPOINT and friends.
const s3Endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!s3Endpoint)('restoring files into S3 (needs S3_TEST_ENDPOINT)', () => {
  it('never completes an object whose bytes are not as listed', async () => {
    const storage = createStorage(
      loadConfig({
        PUBLIC_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgres://unused',
        AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: s3Endpoint,
        S3_BUCKET: process.env.S3_TEST_BUCKET ?? 'inkadra',
        S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY,
        S3_FORCE_PATH_STYLE: 'true',
      }),
    );
    const id = randomUUID();
    // Above 16 MiB: the upload is multipart, and the mismatch shows only at its end.
    const big = { key: `originals/${id}`, data: Buffer.alloc(17 * 1024 * 1024, 3) };
    const small = { key: `variants/${id}/256.webp`, data: Buffer.from('a small picture') };
    const file = await mediaArchive([
      { ...big, inside: Buffer.alloc(big.data.length, 4) },
      { ...small, inside: Buffer.from('a small pictur3') },
    ]);
    try {
      expect(await restoreBackupFiles({ file, storage, log, retryMs: 1 })).toMatchObject({
        restored: 0,
        failed: 2,
      });
      expect(await storage.size(big.key)).toBeNull();
      expect(await storage.size(small.key)).toBeNull();
      const good = await mediaArchive([small]);
      expect(await restoreBackupFiles({ file: good, storage, log })).toMatchObject({
        restored: 1,
      });
      expect(await readAll(await storage.read(small.key))).toEqual(small.data);
    } finally {
      await storage.remove([big.key, small.key]);
    }
  }, 60_000);
});
