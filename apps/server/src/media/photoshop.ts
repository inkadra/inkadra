// SPDX-License-Identifier: AGPL-3.0-only
import { open } from 'node:fs/promises';
import { ThumbnailSize } from '@inkadra/shared';

const PREVIEW_SIDE = Math.max(...ThumbnailSize.options.map(Number));

/** Saved composite only; no layer rendering, colour profiles or ZIP prediction. */
export async function readPhotoshop(file: string) {
  const source = await open(file, 'r');
  let layerCount: number | null = null;
  try {
    const size = (await source.stat()).size;
    const deadline = Date.now() + 30_000;
    const read = async (at: number, length: number) => {
      if (Date.now() > deadline || at < 0 || length < 0 || at + length > size)
        throw new Error('Invalid Photoshop range');
      const data = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await source.read(data, filled, length - filled, at + filled);
        if (!bytesRead) throw new Error('Truncated Photoshop data');
        filled += bytesRead;
      }
      return data;
    };
    const header = await read(0, 26);
    const version = header.readUInt16BE(4);
    if (
      header.toString('ascii', 0, 4) !== '8BPS' ||
      ![1, 2].includes(version) ||
      header.subarray(6, 12).some((b) => b !== 0)
    )
      throw new Error('Invalid Photoshop header');
    const channels = header.readUInt16BE(12);
    const height = header.readUInt32BE(14);
    const width = header.readUInt32BE(18);
    const depth = header.readUInt16BE(22);
    const mode = header.readUInt16BE(24);
    if (
      !channels ||
      channels > 56 ||
      !width ||
      !height ||
      width > 30_000 ||
      height > 30_000 ||
      width * height > 100_000_000
    )
      throw new Error('Photoshop dimensions exceed limits');
    let offset = 26;
    const lengthAt = async (at: number, wide = false) => {
      const data = await read(at, wide ? 8 : 4);
      const n = wide ? Number(data.readBigUInt64BE()) : data.readUInt32BE();
      if (!Number.isSafeInteger(n) || n > size - at - data.length)
        throw new Error('Invalid section length');
      return n;
    };
    // Colour mode and image resources: seek past them, never load their contents.
    for (let i = 0; i < 2; i++) offset += 4 + (await lengthAt(offset));
    const wide = version === 2;
    const lengthBytes = wide ? 8 : 4;
    const maskLength = await lengthAt(offset, wide);
    offset += lengthBytes;
    if (maskLength) {
      if (maskLength < lengthBytes) throw new Error('Invalid layer section');
      const infoLength = await lengthAt(offset, wide);
      if (infoLength > maskLength - lengthBytes || (infoLength > 0 && infoLength < 2))
        throw new Error('Invalid layer info');
      if (infoLength) layerCount = Math.abs((await read(offset + lengthBytes, 2)).readInt16BE());
      // With no primary Layer Info, layers may live in a tagged 16/32-bit block.
      // Leave the count unknown rather than claiming there are zero layers.
    } else layerCount = 0;
    offset += maskLength;
    // shortcut: RGB/Grayscale, 8/16-bit raw or PackBits; other encodings use the thumbnail.
    const colourChannels = mode === 3 ? 3 : mode === 1 ? 1 : 0;
    if (
      !colourChannels ||
      ![8, 16].includes(depth) ||
      channels < colourChannels ||
      channels > colourChannels + 1
    )
      return { pixels: null, layerCount };
    const compression = (await read(offset, 2)).readUInt16BE();
    offset += 2;
    if (compression !== 0 && compression !== 1) return { pixels: null, layerCount };
    const rowBytes = width * (depth / 8);
    let lengths: Buffer | null = null;
    const countBytes = wide ? 4 : 2;
    if (compression === 1) {
      lengths = await read(offset, channels * height * countBytes);
      offset += lengths.length;
      let total = 0;
      for (let i = 0; i < channels * height; i++) {
        const n = wide
          ? lengths.readUInt32BE(i * countBytes)
          : lengths.readUInt16BE(i * countBytes);
        if (!n || n > rowBytes * 2 + 1024) throw new Error('Invalid packed row length');
        total += n;
      }
      if (total !== size - offset) throw new Error('Invalid packed image length');
    } else if (rowBytes * height * channels !== size - offset)
      throw new Error('Invalid raw image length');
    // Store only what the largest variant can use, while validating every source row.
    const step = Math.max(1, Math.ceil(Math.max(width, height) / PREVIEW_SIDE));
    const previewWidth = Math.ceil(width / step);
    const previewHeight = Math.ceil(height / step);
    const data = Buffer.alloc(previewWidth * previewHeight * colourChannels);
    for (let channel = 0; channel < channels; channel++) {
      for (let y = 0; y < height; y++) {
        const rowIndex = channel * height + y;
        const n = lengths
          ? wide
            ? lengths.readUInt32BE(rowIndex * countBytes)
            : lengths.readUInt16BE(rowIndex * countBytes)
          : rowBytes;
        const encoded = await read(offset, n);
        offset += n;
        const row = lengths ? unpackRow(encoded, rowBytes) : encoded;
        if (channel >= colourChannels || y % step !== 0) continue;
        for (let x = 0; x < width; x += step) {
          // PSD 16-bit samples are big-endian: the high byte gives an 8-bit preview.
          data[((y / step) * previewWidth + x / step) * colourChannels + channel] =
            row[x * (depth / 8)] ?? 0;
        }
      }
    }
    return {
      pixels: {
        data,
        width: previewWidth,
        height: previewHeight,
        channels: colourChannels as 1 | 3,
      },
      // The card shows the document's real size, not the subsampled preview's.
      document: { width, height },
      layerCount,
    };
  } catch {
    return { pixels: null, layerCount };
  } finally {
    await source.close();
  }
}

/** PackBits is byte-oriented even for 16-bit samples. Every row must fill exactly. */
function unpackRow(encoded: Buffer, size: number) {
  const row = Buffer.alloc(size);
  let at = 0;
  let out = 0;
  while (at < encoded.length) {
    const control = encoded.readInt8(at++);
    if (control === -128) continue;
    const count = control >= 0 ? control + 1 : 1 - control;
    if (out + count > size) throw new Error('Packed row overflow');
    if (control >= 0) {
      if (at + count > encoded.length) throw new Error('Truncated literal');
      encoded.copy(row, out, at, at + count);
      at += count;
    } else {
      if (at >= encoded.length) throw new Error('Truncated repeat');
      row.fill(encoded.readUInt8(at++), out, out + count);
    }
    out += count;
  }
  if (out !== size) throw new Error('Packed row underflow');
  return row;
}
