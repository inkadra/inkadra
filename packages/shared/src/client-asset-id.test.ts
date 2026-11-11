// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { clientAssetUploadId, uuidV5 } from './client-asset-id.ts';

const userId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const clientAssetId = '4f2c8e1a-7b3d-4c9e-a1f0-5d6e7f8a9b0c';

it('derives the documented asset id from the uploader and the client id', () => {
  // Test vector of decision 0097; Python: uuid.uuid5(UUID(userId), clientAssetId).
  expect(clientAssetUploadId(userId, clientAssetId)).toBe('929280d4-8876-5c1f-9299-6d5d127ef047');
  expect(clientAssetUploadId(userId, clientAssetId.toUpperCase())).toBe(
    '929280d4-8876-5c1f-9299-6d5d127ef047',
  );
  expect(clientAssetUploadId('6ba7b810-9dad-11d1-80b4-00c04fd430c8', clientAssetId)).not.toBe(
    clientAssetUploadId(userId, clientAssetId),
  );
});

it('matches RFC 9562 UUIDv5 for names of any length', () => {
  // RFC example: the DNS namespace and python.org.
  expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe(
    '886313e1-3b8a-5372-9b90-0c9aee199e5d',
  );
  const ns = Buffer.from(userId.replace(/-/g, ''), 'hex');
  for (let n = 0; n < 200; n += 7) {
    const name = 'é'.repeat(n);
    const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
    hash[6] = (hash[6]! & 0x0f) | 0x50;
    hash[8] = (hash[8]! & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    expect(uuidV5(userId, name)).toBe(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  }
  expect(() => uuidV5('nope', 'x')).toThrow();
});
