import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import * as codecs from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Storage } from '../storage.ts';
import { METADATA_CAP, parseFileMetadata, readFileMetadata } from './file-metadata.ts';

const gltf = (count: number) =>
  Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ indices: 0 }] }],
      accessors: [{ count }],
    }),
  );
const glb = (json: Buffer) => {
  const padded = Buffer.from(json.toString().padEnd(Math.ceil(json.length / 4) * 4));
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
};
const parse = (data: Buffer, extension: string) =>
  parseFileMetadata(data, extension, data.length, codecs);

// Small generated table fixture: no outlines or copyrighted font data.
function font(otf = false) {
  const buffer = Buffer.alloc(64);
  if (otf) buffer.write('OTTO');
  else buffer.writeUInt32BE(0x10000);
  buffer.writeUInt16BE(2, 4);
  buffer.write('maxp', 12);
  buffer.writeUInt32BE(44, 20);
  buffer.writeUInt32BE(6, 24);
  buffer.write('OS/2', 28);
  buffer.writeUInt32BE(50, 36);
  buffer.writeUInt32BE(6, 40);
  buffer.writeUInt16BE(412, 48);
  buffer.writeUInt16BE(700, 54);
  return buffer;
}

describe('bounded file metadata', () => {
  it('runs the bounded parser in the sandboxed child', async () => {
    const data = gltf(36);
    const storage = { read: async () => Readable.from([data]) } as unknown as Storage;
    expect(
      await readFileMetadata(storage, 'originals/test', 'test.gltf', data.length, tmpdir()),
    ).toEqual({ polygons: 12 });
  });
  it('counts triangles from GLTF/GLB accessors without opening buffers', () => {
    expect(parse(gltf(36), 'gltf')).toEqual({ polygons: 12 });
    expect(parse(glb(gltf(36)), 'glb')).toEqual({ polygons: 12 });
  });
  it('rejects malicious counts, oversized JSON and broken GLB lengths', () => {
    expect(parse(gltf(1e20), 'gltf')).toBeNull();
    expect(parse(Buffer.alloc(METADATA_CAP + 1), 'gltf')).toBeNull();
    const bad = glb(gltf(36));
    bad.writeUInt32LE(0xffffffff, 12);
    expect(parse(bad, 'glb')).toBeNull();
    expect(parse(bad.subarray(0, 12), 'glb')).toBeNull();
    expect(parse(Buffer.from('{'), 'gltf')).toBeNull();
  });
  it('reads TTF and OTF weight and glyph count with bounds checks', () => {
    expect(parse(font(), 'ttf')).toEqual({ glyphs: 412, weight: 700 });
    expect(parse(font(true), 'otf')).toEqual({ glyphs: 412, weight: 700 });
    const bad = font();
    bad.writeUInt32BE(0xffffffff, 20);
    expect(parse(bad, 'ttf')).toBeNull();
    bad.writeUInt16BE(65535, 4);
    expect(parse(bad, 'ttf')).toBeNull();
    expect(parse(font().subarray(0, 11), 'otf')).toBeNull();
  });
  it('validates font name records and their string offsets', () => {
    const bytes = Buffer.alloc(64);
    bytes.writeUInt32BE(0x10000);
    bytes.writeUInt16BE(1, 4);
    bytes.write('name', 12);
    bytes.writeUInt32BE(28, 20);
    bytes.writeUInt32BE(36, 24);
    bytes.writeUInt16BE(1, 30);
    bytes.writeUInt16BE(18, 32);
    bytes.writeUInt16BE(3, 34);
    bytes.writeUInt16BE(1, 40);
    bytes.writeUInt16BE(8, 42);
    bytes.writeUInt16BE(0, 44);
    Buffer.from('Test', 'utf16le').swap16().copy(bytes, 46);
    expect(parse(bytes, 'ttf')).toEqual({ family: 'Test' });
    bytes.writeUInt16BE(65535, 44);
    expect(parse(bytes, 'ttf')).toBeNull();
  });
  it('bounds WOFF directories and safely skips formats without parsers', () => {
    const woff = Buffer.alloc(44);
    woff.write('wOFF');
    woff.writeUInt32BE(44, 8);
    expect(parse(woff, 'woff')).toBeNull();
    woff.writeUInt16BE(65535, 12);
    expect(parse(woff, 'woff')).toBeNull();
    for (const ext of ['obj', 'fbx', 'stl', 'usdz'])
      expect(parse(Buffer.alloc(32), ext)).toBeNull();
  });
});

const base128 = (value: number): Buffer => {
  const bytes = [value & 127];
  while (value >= 128) {
    value = Math.floor(value / 128);
    bytes.unshift((value & 127) | 128);
  }
  return Buffer.from(bytes);
};
function fontTables() {
  const names = ['Preview Serif', 'Bold'].map((value) => Buffer.from(value, 'utf16le').swap16());
  const name = Buffer.alloc(30);
  name.writeUInt16BE(2, 2);
  name.writeUInt16BE(30, 4);
  names.forEach((value, i) => {
    const p = 6 + 12 * i;
    name.writeUInt16BE(3, p);
    name.writeUInt16BE(i + 1, p + 6);
    name.writeUInt16BE(value.length, p + 8);
    name.writeUInt16BE(i ? (names[0]?.length ?? 0) : 0, p + 10);
  });
  const os = Buffer.alloc(96);
  os.writeUInt16BE(700, 4);
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x10000);
  maxp.writeUInt16BE(412, 4);
  return [
    { tag: 'name', bytes: Buffer.concat([name, ...names]), flag: 5 },
    { tag: 'OS/2', bytes: os, flag: 6 },
    { tag: 'maxp', bytes: maxp, flag: 4 },
  ];
}
function webfont(woff2: boolean) {
  const tables = fontTables();
  const sfntSize =
    12 +
    tables.length * 16 +
    tables.reduce((sum, table) => sum + Math.ceil(table.bytes.length / 4) * 4, 0);
  const header = Buffer.alloc(woff2 ? 48 : 44);
  header.write(woff2 ? 'wOF2' : 'wOFF');
  header.writeUInt32BE(0x10000, 4);
  header.writeUInt16BE(tables.length, 12);
  header.writeUInt32BE(sfntSize, 16);
  let body: Buffer;
  if (woff2) {
    const directory = Buffer.concat(
      tables.map((table) =>
        Buffer.concat([Buffer.from([table.flag]), base128(table.bytes.length)]),
      ),
    );
    const compressed = codecs.brotliCompressSync(Buffer.concat(tables.map((table) => table.bytes)));
    header.writeUInt32BE(compressed.length, 20);
    body = Buffer.concat([directory, compressed]);
  } else {
    const directory = Buffer.alloc(tables.length * 20);
    let cursor = header.length + directory.length;
    const chunks = tables.map((table, i) => {
      const compressed = codecs.deflateSync(table.bytes);
      const bytes = compressed.length < table.bytes.length ? compressed : table.bytes;
      const p = i * 20;
      directory.write(table.tag, p);
      directory.writeUInt32BE(cursor, p + 4);
      directory.writeUInt32BE(bytes.length, p + 8);
      directory.writeUInt32BE(table.bytes.length, p + 12);
      const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
      bytes.copy(padded);
      cursor += padded.length;
      return padded;
    });
    body = Buffer.concat([directory, ...chunks]);
  }
  header.writeUInt32BE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}
const expectedFont = { family: 'Preview Serif', style: 'Bold', weight: 700, glyphs: 412 };

describe('compressed font metadata', () => {
  for (const extension of ['woff', 'woff2']) {
    const woff2 = extension === 'woff2';
    it(`reads all three ${extension} tables with native codecs, including in the child process`, async () => {
      const bytes = webfont(woff2);
      expect(parse(bytes, extension)).toEqual(expectedFont);
      const storage = { read: async () => Readable.from([bytes]) } as unknown as Storage;
      expect(
        await readFileMetadata(
          storage,
          'originals/font',
          `preview.${extension}`,
          bytes.length,
          tmpdir(),
        ),
      ).toEqual(expectedFont);
    });
    it(`rejects ${extension} truncation and unreasonable advertised sizes`, () => {
      const bytes = webfont(woff2);
      for (let i = 0; i < bytes.length; i++)
        expect(parse(bytes.subarray(0, i), extension)).toBeNull();
      bytes.writeUInt32BE(0xffffffff, 16);
      expect(parse(bytes, extension)).toBeNull();
    });
  }
  it('rejects WOFF output length mismatches, bombs, duplicate tags and overlapping tables', () => {
    for (const change of [
      (b: Buffer) => b.writeUInt32BE(1, 56),
      (b: Buffer) => b.writeUInt32BE(b.readUInt32BE(56) - 1, 56),
      (b: Buffer) => b.writeUInt32BE(b.readUInt32BE(56) + 1, 56),
      (b: Buffer) => b.writeUInt32BE(METADATA_CAP + 1, 56),
      (b: Buffer) => b.writeUInt32BE(b.readUInt32BE(16) - 4, 16),
      (b: Buffer) => b.write('name', 64),
      (b: Buffer) => b.writeUInt32BE(b.readUInt32BE(48), 68),
      (b: Buffer) => b.writeUInt32BE(0xffffffff, 48),
    ]) {
      const bytes = webfont(false);
      change(bytes);
      expect(parse(bytes, 'woff')).toBeNull();
    }
  });
  it('rejects WOFF2 malformed Base128, transforms, duplicate tags and output mismatches', () => {
    for (const change of [
      (b: Buffer) => {
        b[49] = 0x80;
      },
      (b: Buffer) => {
        b.fill(0xff, 49, 54);
      },
      (b: Buffer) => {
        b[48] = 0x45;
      },
      (b: Buffer) => {
        b[50] = 5;
      },
      (b: Buffer) => {
        b[49] = (b[49] ?? 0) - 1;
      },
      (b: Buffer) => {
        b[49] = (b[49] ?? 0) + 1;
      },
      (b: Buffer) => b.writeUInt32BE(0xffffffff, 20),
      (b: Buffer) => b.writeUInt32BE(0x74746366, 4),
    ]) {
      const bytes = webfont(true);
      change(bytes);
      expect(parse(bytes, 'woff2')).toBeNull();
    }
  });
  it('skips transformed outline data while locating untransformed WOFF2 metadata', () => {
    const original = webfont(true);
    const prefix = Buffer.from([10, 20, 3, 11, 12, 0, 0x43, 8, 2]);
    const tables = fontTables();
    const directory = Buffer.concat([prefix, original.subarray(48, 54)]);
    const stream = Buffer.concat([Buffer.alloc(5), ...tables.map((t) => t.bytes)]);
    const compressed = codecs.brotliCompressSync(stream);
    const header = Buffer.from(original.subarray(0, 48));
    header.writeUInt16BE(6, 12);
    header.writeUInt32BE(48 + directory.length + compressed.length, 8);
    header.writeUInt32BE(compressed.length, 20);
    expect(parse(Buffer.concat([header, directory, compressed]), 'woff2')).toEqual(expectedFont);
  });
});

it.each(['ttf', 'otf'])('reads full family/style/weight/glyph metadata from %s', (extension) => {
  const tables = fontTables();
  let offset = 12 + tables.length * 16;
  const header = Buffer.alloc(offset);
  header.writeUInt32BE(extension === 'otf' ? 0x4f54544f : 0x10000);
  header.writeUInt16BE(tables.length, 4);
  const chunks = tables.map((table, i) => {
    const p = 12 + i * 16;
    header.write(table.tag, p);
    header.writeUInt32BE(offset, p + 8);
    header.writeUInt32BE(table.bytes.length, p + 12);
    const padded = Buffer.alloc(Math.ceil(table.bytes.length / 4) * 4);
    table.bytes.copy(padded);
    offset += padded.length;
    return padded;
  });
  expect(parse(Buffer.concat([header, ...chunks]), extension)).toEqual(expectedFont);
});
