// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { zipBlobs } from './zip.ts';

describe('zipBlobs', () => {
  it('writes a stored archive with every file listed in the central directory', async () => {
    const zip = await zipBlobs([
      { name: 'a-001.png', blob: new Blob(['hello']) },
      { name: 'a-002.png', blob: new Blob(['world!']) },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(zip.type).toBe('application/zip');
    // First local header: signature, CRC-32 of "hello", sizes, name, then the data itself.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x3610a686);
    expect(view.getUint32(18, true)).toBe(5);
    expect(new TextDecoder().decode(bytes.subarray(30, 39))).toBe('a-001.png');
    expect(new TextDecoder().decode(bytes.subarray(39, 44))).toBe('hello');
    // End of central directory: two entries, central directory right after the files.
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(view.getUint32(bytes.length - 22 + 16, true)).toBe(44 + 30 + 9 + 6);
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});
