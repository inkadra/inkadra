#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// `icons` (before vite build) draws the icons into public/icons; `zip` (after) stamps the
// version in dist/manifest.json and zips dist/ into release/ for the Chrome Web Store.
// No dependencies: zlib does the PNG and ZIP compression.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const release = join(root, 'release');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Icons ----------------------------------------------------------------------------------
// The logo of apps/web/public/favicon.svg (32×32 units): a light tile with two dark frames.

const TILE = [0xed, 0xed, 0xed];
const INK = [0x0e, 0x0e, 0x10];
const SHAPES = [
  { x: 0, y: 0, w: 32, h: 32, r: 8.6, color: TILE, alpha: 1 },
  { x: 5.3, y: 10.7, w: 9.3, h: 11.6, r: 1.7, color: INK, alpha: 1 },
  { x: 17.4, y: 10.7, w: 9.3, h: 11.6, r: 1.7, color: INK, alpha: 0.55 },
];

function inside(s, px, py) {
  if (px < s.x || py < s.y || px > s.x + s.w || py > s.y + s.h) return false;
  const cx = Math.min(Math.max(px, s.x + s.r), s.x + s.w - s.r);
  const cy = Math.min(Math.max(py, s.y + s.r), s.y + s.h - s.r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= s.r ** 2;
}

function drawIcon(size) {
  const SS = 4; // samples per side, for anti-aliased edges
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) * 32) / size;
          const py = ((y + (sy + 0.5) / SS) * 32) / size;
          // Composite the shapes over transparency, then accumulate premultiplied colour.
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          for (const s of SHAPES) {
            if (!inside(s, px, py)) continue;
            cr = s.color[0] * s.alpha + cr * (1 - s.alpha);
            cg = s.color[1] * s.alpha + cg * (1 - s.alpha);
            cb = s.color[2] * s.alpha + cb * (1 - s.alpha);
            ca = s.alpha + ca * (1 - s.alpha);
          }
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      rgba[i] = alpha ? Math.round(r / n / alpha) : 0;
      rgba[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      rgba[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Zip ------------------------------------------------------------------------------------

function listFiles(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    })
    .sort();
}

/** A plain deflate ZIP with fixed timestamps, so the same build gives the same bytes. */
function zip(files) {
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// Run ------------------------------------------------------------------------------------

function icons() {
  const dir = join(root, 'public', 'icons');
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 48, 128])
    writeFileSync(join(dir, `icon-${size}.png`), drawIcon(size));
}

function pack() {
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const files = listFiles(dist).map((path) => ({
    name: relative(dist, path).split('\\').join('/'),
    data: readFileSync(path),
  }));
  mkdirSync(release, { recursive: true });
  const zipPath = join(release, `inkadra-clipper-${version}.zip`);
  writeFileSync(zipPath, zip(files));
  console.log(`${relative(root, zipPath)}: ${files.length} files`);
}

const step = process.argv[2];
if (step === 'icons') icons();
else if (step === 'zip') pack();
else {
  console.error('Usage: package.mjs icons|zip');
  process.exit(1);
}
