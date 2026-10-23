import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
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

    it('refuses keys that could escape the storage root', async () => {
      await expect(
        storage.write('../etc/passwd', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow();
      await expect(storage.read('originals/../../x')).rejects.toThrow();
    });
  });
}

contract('local storage', () => localStorage(mkdtempSync(join(tmpdir(), 'inkadra-storage-'))));

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
