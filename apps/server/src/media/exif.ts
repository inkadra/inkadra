import exifr from 'exifr';
import { readPrefix } from './scratch.ts';

/**
 * Camera and exposure fields kept from EXIF. Everything else is dropped, location above all:
 * GPS never reaches the database or the API (see the legal review in docs/decisions/0009).
 */
const KEEP = [
  'Make',
  'Model',
  'LensMake',
  'LensModel',
  'FNumber',
  'ExposureTime',
  'ISO',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'ExposureBiasValue',
  'ExposureProgram',
  'MeteringMode',
  'Flash',
  'WhiteBalance',
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'Orientation',
  'ColorSpace',
  'Software',
] as const;

const MAX_STRING = 200;

/**
 * Bytes of a file handed to exifr: EXIF sits in the first blocks of a JPEG, HEIC or TIFF, and an
 * original can be gigabytes. shortcut: EXIF placed past this point is not read; raise it if a
 * camera puts it later.
 */
export const EXIF_MAX_BYTES = 4 * 1024 * 1024;

export function pickExif(raw: Record<string, unknown> | undefined | null) {
  if (!raw) return null;
  const out: Record<string, string | number> = {};
  for (const key of KEEP) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.trim())
      out[key] = value.trim().slice(0, MAX_STRING);
    else if (value instanceof Date && !Number.isNaN(value.getTime()))
      out[key] = value.toISOString();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function readExif(file: string | Buffer) {
  try {
    const buf = typeof file === 'string' ? await readPrefix(file, EXIF_MAX_BYTES) : file;
    const raw = await exifr.parse(buf, {
      pick: [...KEEP],
      gps: false,
      translateValues: true,
      reviveValues: true,
    });
    return pickExif(raw);
  } catch {
    return null; // no EXIF, or a format exifr does not read
  }
}
