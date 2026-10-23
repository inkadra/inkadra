import { createRequire } from 'node:module';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** True for an ISO-BMFF file whose brands say HEVC-coded HEIF (not AVIF, which sharp reads). */
export function isHeic(head: Uint8Array): boolean {
  if (head.length < 16) return false;
  const text = (from: number) => String.fromCharCode(...head.subarray(from, from + 4));
  if (text(4) !== 'ftyp') return false;
  const boxSize = Math.min(new DataView(head.buffer, head.byteOffset).getUint32(0), head.length);
  const brands = [text(8)];
  for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(text(at));
  if (brands.some((b) => AVIF_BRANDS.has(b))) return false;
  return brands.some((b) => HEIC_BRANDS.has(b) || b === 'mif1' || b === 'msf1');
}

type Decoded = { width: number; height: number; data: Uint8ClampedArray };
type Decoder = (input: { buffer: Uint8Array }) => Promise<Decoded>;

let decoder: Decoder | undefined;

/**
 * Decodes the primary image of a HEIC file to RGBA with libheif compiled to WebAssembly
 * (heic-decode), so the image needs no system codec. Loaded on first use: it is large.
 */
export async function decodeHeic(buffer: Uint8Array): Promise<Decoded> {
  decoder ??= createRequire(import.meta.url)('heic-decode') as Decoder;
  return decoder({ buffer });
}

/** Image type from the first bytes of a file, for originals uploaded with a vague type. */
export function sniffImage(head: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const text = (from: number, length: number) =>
    String.fromCharCode(...head.subarray(from, from + length));
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (text(0, 4) === 'GIF8') return 'image/gif';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  if (isHeic(head)) return 'image/heic';
  if (text(4, 4) === 'ftyp' && /avi[fs]/.test(text(8, 32))) return 'image/avif';
  return null;
}
