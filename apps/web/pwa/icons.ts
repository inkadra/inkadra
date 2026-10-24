import { deflateSync } from 'node:zlib';

/**
 * The app icons, drawn at build time from the shapes of public/favicon.svg (a 32-unit tile with
 * two frames, the second at 55%), so no image tool or binary file is needed.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const TILE: Box = { x: 0, y: 0, w: 32, h: 32, r: 8.6 };
const FRAMES: Array<Box & { alpha: number }> = [
  { x: 5.3, y: 10.7, w: 9.3, h: 11.6, r: 1.7, alpha: 1 },
  { x: 17.4, y: 10.7, w: 9.3, h: 11.6, r: 1.7, alpha: 0.55 },
];
/** Centre of the two frames, in favicon units. */
const MARK_CENTRE = { x: 16, y: 16.5 };

export interface IconOptions {
  size: number;
  /** Tile and frame colours, as #RRGGBB. */
  tile: string;
  ink: string;
  /**
   * Fill the whole square (maskable and Apple icons, which the system crops) instead of the
   * rounded tile on a transparent background.
   */
  fullBleed?: boolean;
  /** Size of the mark relative to the favicon's; below 1 leaves room for the system's mask. */
  scale?: number;
}

function inside(b: Box, x: number, y: number): boolean {
  if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false;
  const dx = Math.max(b.x + b.r - x, 0, x - (b.x + b.w - b.r));
  const dy = Math.max(b.y + b.r - y, 0, y - (b.y + b.h - b.r));
  return dx * dx + dy * dy <= b.r * b.r;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGBA pixels of the icon, 4×4 samples per pixel for smooth edges. */
export function drawIcon({ size, tile, ink, fullBleed = false, scale = 1 }: IconOptions) {
  const tileRgb = rgb(tile);
  const inkRgb = rgb(ink);
  const samples = 4;
  const pixels = new Uint8Array(size * size * 4);
  const unit = size / 32;
  const centre = fullBleed ? { x: 16, y: 16 } : MARK_CENTRE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Premultiplied sums over the samples.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / unit;
          const y = (py + (sy + 0.5) / samples) / unit;
          if (!fullBleed && !inside(TILE, x, y)) continue;
          let c: [number, number, number] = tileRgb;
          // The mark, scaled around its centre; centred on squares the system crops.
          const mx = MARK_CENTRE.x + (x - centre.x) / scale;
          const my = MARK_CENTRE.y + (y - centre.y) / scale;
          for (const frame of FRAMES) {
            if (!inside(frame, mx, my)) continue;
            const a = frame.alpha;
            c = [
              c[0] * (1 - a) + inkRgb[0] * a,
              c[1] * (1 - a) + inkRgb[1] * a,
              c[2] * (1 - a) + inkRgb[2] * a,
            ];
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a === 0) continue;
      pixels[o] = Math.round(r / a);
      pixels[o + 1] = Math.round(g / a);
      pixels[o + 2] = Math.round(b / a);
      pixels[o + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A PNG file (8-bit RGBA) of square RGBA pixels. */
export function encodePng(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    // Each row starts with filter type 0 (none).
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(
      rows,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

export const iconPng = (options: IconOptions) => encodePng(drawIcon(options), options.size);
