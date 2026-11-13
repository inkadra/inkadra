import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { officeFiles } from './media/office.ts';
import { createStorage, localStorage, readAll, type Storage, variantKey } from './storage.ts';

const s3Endpoint = process.env.S3_TEST_ENDPOINT;

function contract(name: string, make: () => Storage) {
  describe(name, () => {
    const storage = make();
    const key = variantKey('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', '256');

    it('writes, reads whole or in part, and removes', async () => {
      await storage.write(key, Buffer.from('0123456789'), 'image/webp');
      expect(await storage.size(key)).toBe(10);
      expect((await readAll(await storage.read(key))).toString()).toBe('0123456789');
      expect((await readAll(await storage.read(key, { start: 2, end: 4 }))).toString()).toBe('234');
      const copy = await storage.localCopy(key, mkdtempSync(join(tmpdir(), 'inkadra-copy-')));
      expect(copy.path).toBeTruthy();
      await copy.done();
      await storage.remove([key]);
      expect(await storage.size(key)).toBeNull();
    });

    it('writes streams of unknown length, in parts when large', async () => {
      const small = variantKey('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11', '256');
      await storage.writeStream(small, Readable.from([Buffer.from('abc')]), 'image/webp');
      expect((await readAll(await storage.read(small))).toString()).toBe('abc');
      // Over one 16 MiB part: S3 takes it as a multipart upload.
      const big = Buffer.alloc(17 * 1024 * 1024, 7);
      const large = variantKey('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12', '256');
      const pieces = Array.from({ length: 17 }, (_, i) =>
        big.subarray(i * 1024 * 1024, (i + 1) * 1024 * 1024),
      );
      await storage.writeStream(large, Readable.from(pieces), 'application/zip');
      expect(await storage.size(large)).toBe(big.length);
      await storage.remove([small, large]);
    });

    it('refuses keys that could escape the storage root', async () => {
      await expect(
        storage.write('../etc/passwd', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow();
      await expect(storage.read('originals/../../x')).rejects.toThrow();
    });
  });
}

contract('local storage', () => localStorage(mkdtempSync(join(tmpdir(), 'inkadra-storage-'))));

it('local storage keeps the previous file when a write fails half-way', async () => {
  const root = mkdtempSync(join(tmpdir(), 'inkadra-storage-'));
  const storage = localStorage(root);
  const key = variantKey('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13', '256');
  await storage.write(key, Buffer.from('whole'), 'image/webp');
  // writeFile also takes an iterable: one that breaks off stands in for a crash or a full disk.
  async function* broken() {
    yield Buffer.from('trunc');
    throw new Error('disk full');
  }
  await expect(storage.write(key, broken() as unknown as Buffer, 'image/webp')).rejects.toThrow(
    'disk full',
  );
  expect((await readAll(await storage.read(key))).toString()).toBe('whole');
  expect(readdirSync(dirname(join(root, key)))).toEqual([basename(key)]);
});

// Run against an S3 server with S3_TEST_ENDPOINT, S3_TEST_BUCKET, S3_TEST_ACCESS_KEY_ID and
// S3_TEST_SECRET_ACCESS_KEY, for example RustFS as in deploy/.
describe.skipIf(!s3Endpoint)('s3 storage (needs S3_TEST_ENDPOINT)', () => {
  contract('s3', () =>
    createStorage(
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
    ),
  );
});

it('removes only the keys it is given; Office derivatives are listed for Office assets only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-storage-'));
  const storage = localStorage(dir);
  const id = 'office-test';
  await storage.write(`originals/${id}`, Buffer.from('original'), 'text/plain');
  await storage.write(`variants/${id}/office-manifest.json`, Buffer.from('{}'), 'application/json');
  await storage.write(`variants/${id}/office-page-50.webp`, Buffer.from('page'), 'image/webp');
  await storage.remove([`originals/${id}`]);
  expect(await storage.size(`variants/${id}/office-manifest.json`)).toBe(2);
  const keys = officeFiles([
    { id, filename: 'Budget.XLSX' },
    { id: 'photo', filename: 'photo.jpg' },
  ]);
  expect(keys).toHaveLength(51);
  expect(keys.every((key) => key.startsWith(`variants/${id}/office-`))).toBe(true);
  await storage.remove(keys);
  expect(await storage.size(`variants/${id}/office-manifest.json`)).toBeNull();
  expect(await storage.size(`variants/${id}/office-page-50.webp`)).toBeNull();
});

it('local storage keeps two writes of one key apart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'inkadra-storage-'));
  const storage = localStorage(root);
  const key = variantKey('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13', '256');
  const bodies = ['a'.repeat(1 << 20), 'b'.repeat(1 << 20)];
  await Promise.all(bodies.map((body) => storage.write(key, Buffer.from(body), 'image/webp')));
  expect(bodies).toContain((await readAll(await storage.read(key))).toString());
  expect(readdirSync(dirname(join(root, key)))).toEqual([basename(key)]);
});
