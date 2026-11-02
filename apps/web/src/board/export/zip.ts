// SPDX-License-Identifier: AGPL-3.0-only
/** A ZIP archive of files stored without compression (PNGs are compressed already). */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Zips `files`. The blobs go into the archive as they are, so memory stays near their size.
 * shortcut: no ZIP64, so at most 65 535 files of 4 GiB; exports stay far below that.
 */
export async function zipBlobs(files: readonly { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, blob } of files) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true); // version needed
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(10, dosTime, true);
    head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, blob.size, true);
    head.setUint32(22, blob.size, true);
    head.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, blob.size, true);
    entry.setUint32(24, blob.size, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(head.buffer, nameBytes, blob);
    central.push(entry.buffer, nameBytes);
    offset += 30 + nameBytes.length + blob.size;
  }
  const centralSize = central.reduce(
    (sum, p) => sum + (p as ArrayBuffer | Uint8Array).byteLength,
    0,
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
