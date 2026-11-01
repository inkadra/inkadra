// SPDX-License-Identifier: AGPL-3.0-only
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readAll, type Storage } from '../storage.ts';
import { withJobDir } from './scratch.ts';
import { runTool } from './tools.ts';

export const METADATA_CAP = 1024 * 1024;

/** Pure, bounded parser; kept self-contained so the worker can run it in a capped process. */
export function parseFileMetadata(
  data: Buffer,
  extension: string,
  sourceSize: number,
  codecs: Pick<typeof import('node:zlib'), 'inflateSync' | 'brotliDecompressSync'>,
): Record<string, unknown> | null {
  try {
    const cap = 1024 * 1024;
    if (data.length > cap || sourceSize < data.length) return null;
    const range = (offset: number, length: number) =>
      Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= data.length;
    if (extension === 'glb' || extension === 'gltf') {
      let json = data;
      if (extension === 'glb') {
        if (
          !range(0, 20) ||
          data.toString('ascii', 0, 4) !== 'glTF' ||
          data.readUInt32LE(4) !== 2 ||
          data.readUInt32LE(8) !== sourceSize ||
          data.readUInt32LE(16) !== 0x4e4f534a
        )
          return null;
        const length = data.readUInt32LE(12);
        if (length % 4 || !range(20, length)) return null;
        json = data.subarray(20, 20 + length);
      } else if (sourceSize > cap) return null;
      const doc = JSON.parse(json.toString('utf8'));
      if (
        doc?.asset?.version !== '2.0' ||
        !Array.isArray(doc.meshes) ||
        !Array.isArray(doc.accessors)
      )
        return null;
      let polygons = 0;
      let primitives = 0;
      for (const mesh of doc.meshes) {
        if (!Array.isArray(mesh.primitives)) return null;
        for (const primitive of mesh.primitives) {
          if (++primitives > 10000) return null;
          const mode = primitive.mode ?? 4;
          if (![4, 5, 6].includes(mode)) continue;
          const index = primitive.indices ?? primitive.attributes?.POSITION;
          if (!Number.isSafeInteger(index) || index < 0) return null;
          const count = doc.accessors[index]?.count;
          if (!Number.isSafeInteger(count) || count < 0 || count > 100000000) return null;
          polygons += mode === 4 ? Math.floor(count / 3) : Math.max(0, count - 2);
          if (polygons > 100000000) return null;
        }
      }
      return { polygons };
    }
    if (['ttf', 'otf', 'woff', 'woff2'].includes(extension)) {
      const woff = extension === 'woff';
      const woff2 = extension === 'woff2';
      const web = woff || woff2;
      const headerSize = woff2 ? 48 : woff ? 44 : 12;
      if (!range(0, headerSize)) return null;
      const signature = data.toString('ascii', 0, 4);
      const flavor = data.readUInt32BE(web ? 4 : 0);
      // shortcut: font collections are not individual font cards; add collection selection
      // before accepting ttcf. No outline tables are reconstructed here.
      if (flavor !== 0x10000 && flavor !== 0x4f54544f) return null;
      if (web && (signature !== (woff2 ? 'wOF2' : 'wOFF') || data.readUInt32BE(8) !== sourceSize))
        return null;
      const count = data.readUInt16BE(web ? 12 : 4);
      if (!count || count > 128) return null;
      const decodedCap = 8 * 1024 * 1024;
      const declaredSize = web ? data.readUInt32BE(16) : sourceSize;
      if (declaredSize > decodedCap || declaredSize < 12 + count * 16) return null;
      const tables = new Map<string, Buffer>();
      const wanted = (tag: string) => ['name', 'OS/2', 'maxp'].includes(tag);
      const seen = new Set<string>();
      if (woff2) {
        // https://www.w3.org/TR/WOFF2/#table_dir_format
        const tags =
          'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
            .split(' ')
            .map((tag) => tag.replace('_', ' '));
        let cursor = 48;
        const base128 = () => {
          let value = 0;
          for (let i = 0; i < 5; i++) {
            if (!range(cursor, 1)) throw new Error('Truncated UIntBase128');
            const byte = data[cursor++] as number;
            if (i === 0 && byte === 0x80) throw new Error('Leading zero');
            value = value * 128 + (byte & 127);
            if (value > 0xffffffff) throw new Error('UIntBase128 overflow');
            if (!(byte & 128)) return value;
          }
          throw new Error('Overlong UIntBase128');
        };
        const entries: Array<{ tag: string; offset: number; length: number }> = [];
        let decodedSize = 0;
        for (let i = 0; i < count; i++) {
          if (!range(cursor, 1)) return null;
          const flags = data[cursor++] as number;
          let tag = tags[flags & 63];
          if ((flags & 63) === 63) {
            if (!range(cursor, 4)) return null;
            tag = data.toString('ascii', cursor, cursor + 4);
            cursor += 4;
          }
          if (!tag || seen.has(tag)) return null;
          seen.add(tag);
          const original = base128();
          const version = flags >>> 6;
          const outline = tag === 'glyf' || tag === 'loca';
          if (
            outline ? version !== 0 && version !== 3 : tag === 'hmtx' ? version > 1 : version !== 0
          )
            return null;
          const transformed = outline ? version === 0 : version !== 0;
          const length = transformed ? base128() : original;
          if (
            original > decodedCap ||
            length > decodedCap ||
            (tag === 'loca' && transformed && length !== 0)
          )
            return null;
          if (wanted(tag) && length > cap) return null;
          entries.push({ tag, offset: decodedSize, length });
          decodedSize += length;
          if (decodedSize > decodedCap) return null;
        }
        const compressedSize = data.readUInt32BE(20);
        if (!decodedSize || !compressedSize || !range(cursor, compressedSize)) return null;
        // totalSfntSize is advisory for transformed WOFF2. The directory gives the exact
        // Brotli stream length; bound both independently, then require that exact output.
        const decoded = codecs.brotliDecompressSync(
          data.subarray(cursor, cursor + compressedSize),
          { maxOutputLength: decodedSize },
        );
        if (decoded.length !== decodedSize) return null;
        for (const entry of entries)
          if (wanted(entry.tag))
            tables.set(entry.tag, decoded.subarray(entry.offset, entry.offset + entry.length));
      } else {
        const directoryEnd = headerSize + count * (woff ? 20 : 16);
        if (!range(headerSize, directoryEnd - headerSize) || (woff && data.readUInt16BE(14) !== 0))
          return null;
        const spans: Array<{ start: number; end: number }> = [];
        let sfntSize = 12 + count * 16;
        for (let i = 0; i < count; i++) {
          const p = headerSize + i * (woff ? 20 : 16);
          const tag = data.toString('ascii', p, p + 4);
          if (seen.has(tag)) return null;
          seen.add(tag);
          const offset = data.readUInt32BE(p + (woff ? 4 : 8));
          const length = data.readUInt32BE(p + (woff ? 8 : 12));
          const original = woff ? data.readUInt32BE(p + 12) : length;
          if (
            offset < directoryEnd ||
            offset + length > sourceSize ||
            length > original ||
            original > decodedCap
          )
            return null;
          if (length) spans.push({ start: offset, end: offset + length });
          sfntSize += Math.ceil(original / 4) * 4;
          if (sfntSize > decodedCap) return null;
          if (wanted(tag)) {
            if (original > cap || !range(offset, length)) return null;
            const bytes = data.subarray(offset, offset + length);
            const decoded =
              length === original
                ? bytes
                : codecs.inflateSync(bytes, { maxOutputLength: original });
            if (decoded.length !== original) return null;
            tables.set(tag, decoded);
          }
        }
        spans.sort((a, b) => a.start - b.start);
        for (let i = 1; i < spans.length; i++)
          if ((spans[i]?.start ?? 0) < (spans[i - 1]?.end ?? 0)) return null;
        if (woff && sfntSize !== declaredSize) return null;
      }
      const result: Record<string, unknown> = {};
      const names = tables.get('name');
      if (names && names.length >= 6) {
        const n = names.readUInt16BE(2);
        const start = names.readUInt16BE(4);
        if (n > 512 || 6 + n * 12 > names.length || start < 6 + n * 12) return null;
        for (let i = 0; i < n; i++) {
          const p = 6 + i * 12;
          const platform = names.readUInt16BE(p);
          const id = names.readUInt16BE(p + 6);
          const length = names.readUInt16BE(p + 8);
          const offset = start + names.readUInt16BE(p + 10);
          if (offset + length > names.length) return null;
          if (![1, 2].includes(id) || length > 512 || ![0, 3].includes(platform) || length % 2)
            continue;
          const value = Buffer.from(names.subarray(offset, offset + length))
            .swap16()
            .toString('utf16le')
            .replace(/\p{Cc}/gu, '')
            .trim();
          if (value) result[id === 1 ? 'family' : 'style'] = value;
        }
      }
      const os = tables.get('OS/2');
      if (os && os.length >= 6) {
        const weight = os.readUInt16BE(4);
        if (weight >= 1 && weight <= 1000) result.weight = weight;
      }
      const maxp = tables.get('maxp');
      if (maxp && maxp.length >= 6) result.glyphs = maxp.readUInt16BE(4);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/** Only a capped prefix reaches the parser; buffers, external references and geometry never do. */
export async function readFileMetadata(
  storage: Storage,
  key: string,
  filename: string,
  size: number,
  tmpDir: string,
) {
  if (size <= 0) return null;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!['glb', 'gltf', 'ttf', 'otf', 'woff', 'woff2'].includes(ext)) return null;
  return withJobDir(tmpDir, async (dir) => {
    const prefix = await readAll(
      await storage.read(key, { start: 0, end: Math.min(size, METADATA_CAP) - 1 }),
    );
    const path = join(dir, 'prefix');
    await writeFile(path, prefix);
    const script = `const fs=require('node:fs');const parse=${parseFileMetadata.toString()};process.stdout.write(JSON.stringify(parse(fs.readFileSync(process.argv[1]),process.argv[2],Number(process.argv[3]),require('node:zlib'))));`;
    try {
      const output = await runTool(
        process.execPath,
        ['--max-old-space-size=64', '-e', script, path, ext, String(size)],
        {
          memoryBytes: 16 * 1024 ** 3,
          fileBytes: 65536,
          nice: true,
          timeoutMs: 5000,
          maxBuffer: 4096,
        },
      );
      return JSON.parse(output.toString()) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  });
}
