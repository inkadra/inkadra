import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RAW_IMAGE_TYPES } from '@inkadra/shared';
import sharp, { type Sharp } from 'sharp';
import { pickExif } from './exif.ts';
import { runTool } from './tools.ts';

/** Address space of one exiftool run: Perl reading a 100 MB RAW fits well within it. */
const EXIFTOOL_MEMORY = 2 * 1024 ** 3;
const EXIFTOOL_TIMEOUT_MS = 30_000;
/** Largest embedded preview read: full-size JPEGs of 100 MP cameras stay well below it. */
export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
/** Pixels sharp decodes of a preview: about 100 MP, past which the preview is refused. */
export const MAX_PREVIEW_PIXELS = 100_000_000;

const extension = (filename: string) => /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();

/** The RAW type a file name stands for (`.CR3` → `image/x-canon-cr3`), else null. */
export function rawTypeOf(filename: string): string | null {
  const ext = extension(filename);
  return ext && Object.hasOwn(RAW_IMAGE_TYPES, ext)
    ? RAW_IMAGE_TYPES[ext as keyof typeof RAW_IMAGE_TYPES]
    : null;
}

/**
 * The camera RAW type of a file, from its first bytes and, for the formats that are plain
 * TIFF inside (NEF, ARW, DNG), its name or declared type. Null for anything else, TIFF
 * photos included.
 */
export function sniffRaw(head: Uint8Array, filename: string, declared: string): string | null {
  const text = (from: number, length: number) =>
    String.fromCharCode(...head.subarray(from, from + length));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const tiff = starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a);
  if (tiff && text(8, 2) === 'CR') return RAW_IMAGE_TYPES.cr2;
  if (text(4, 4) === 'ftyp' && text(8, 4) === 'crx ') return RAW_IMAGE_TYPES.cr3;
  if (text(0, 15) === 'FUJIFILMCCD-RAW') return RAW_IMAGE_TYPES.raf;
  if (['IIRO', 'IIRS', 'MMOR'].includes(text(0, 4))) return RAW_IMAGE_TYPES.orf;
  if (starts(0x49, 0x49, 0x55, 0x00)) return RAW_IMAGE_TYPES.rw2;
  if (!tiff) return null;
  const named = rawTypeOf(filename);
  const types: string[] = [RAW_IMAGE_TYPES.nef, RAW_IMAGE_TYPES.arw, RAW_IMAGE_TYPES.dng];
  if (named && types.includes(named)) return named;
  return types.includes(declared) ? declared : null;
}

/** Embedded JPEGs, best first: full size, then the large preview, then any other. */
const PREVIEW_TAGS = ['JpgFromRaw', 'PreviewImage', 'OtherImage'] as const;

/**
 * The largest JPEG preview the camera embedded in a RAW file, extracted by exiftool without
 * developing the RAW itself. Null when there is none (or exiftool cannot read the file).
 */
export async function extractRawPreview(
  exiftool: string,
  file: string,
  workDir: string,
): Promise<Buffer | null> {
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    await runTool(
      exiftool,
      ['-q', '-m', '-b', '-W', join(workDir, '%t.%s'), ...PREVIEW_TAGS.map((t) => `-${t}`), file],
      // No file it writes may be larger than the largest preview read.
      {
        timeoutMs: EXIFTOOL_TIMEOUT_MS,
        memoryBytes: EXIFTOOL_MEMORY,
        fileBytes: MAX_PREVIEW_BYTES,
      },
    ).catch(() => null);
    let best: Buffer | null = null;
    for (const name of await readdir(workDir)) {
      const path = join(workDir, name);
      const size = (await stat(path)).size;
      if (size > MAX_PREVIEW_BYTES || size <= (best?.length ?? 0)) continue;
      const data = await readFile(path);
      const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
      if (jpeg && data.length > (best?.length ?? 0)) best = data;
    }
    return best;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * EXIF tags asked of exiftool, under the names exifr gives JPEG photos (see exif.ts), so RAW
 * and JPEG files carry the same fields. `#` asks for numbers rather than printed values.
 */
const EXIFTOOL_TAGS: Record<string, string> = {
  Make: 'Make',
  Model: 'Model',
  LensMake: 'LensMake',
  LensModel: 'LensModel',
  'FNumber#': 'FNumber',
  'ExposureTime#': 'ExposureTime',
  'ISO#': 'ISO',
  'FocalLength#': 'FocalLength',
  'FocalLengthIn35mmFormat#': 'FocalLengthIn35mmFormat',
  'ExposureCompensation#': 'ExposureBiasValue',
  ExposureProgram: 'ExposureProgram',
  MeteringMode: 'MeteringMode',
  Flash: 'Flash',
  WhiteBalance: 'WhiteBalance',
  DateTimeOriginal: 'DateTimeOriginal',
  OffsetTimeOriginal: 'OffsetTimeOriginal',
  ColorSpace: 'ColorSpace',
  Software: 'Software',
  'Orientation#': 'Orientation',
};

/** `2024:05:01 10:00:00` as exifr revives it on a server in UTC. */
const exifDate = (value: unknown) => {
  const m =
    typeof value === 'string' ? /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(value) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : value;
};

/**
 * Camera and exposure data of a RAW file, with the same fields and the same rule as photos:
 * no location, ever. `orientation` is the EXIF orientation of the sensor data (1 to 8).
 */
export async function readRawExif(exiftool: string, file: string) {
  try {
    const stdout = await runTool(
      exiftool,
      ['-j', '-q', '-m', ...Object.keys(EXIFTOOL_TAGS).map((t) => `-${t}`), file],
      { timeoutMs: EXIFTOOL_TIMEOUT_MS, memoryBytes: EXIFTOOL_MEMORY, maxBuffer: 256 * 1024 },
    );
    const [raw] = JSON.parse(stdout.toString('utf8')) as Array<Record<string, unknown>>;
    const named: Record<string, unknown> = {};
    for (const [tag, field] of Object.entries(EXIFTOOL_TAGS)) {
      const value = raw?.[tag.replace('#', '')];
      if (value !== undefined)
        named[field] = field === 'DateTimeOriginal' ? exifDate(value) : value;
    }
    const orientation = Number(named.Orientation);
    return {
      exif: pickExif(named),
      orientation:
        Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1,
    };
  } catch {
    return { exif: null, orientation: 1 };
  }
}

/**
 * Pixels of a JPEG preview turned the way the RAW says (EXIF orientation 1 to 8). The JPEG's
 * own orientation is ignored: cameras write the preview as the sensor saw it, and the
 * orientation of the shot is in the RAW. One step at a time, so rotation and mirror never
 * swap order.
 */
export async function orientedPixels(jpeg: Buffer, orientation: number) {
  let { data, info } = await sharp(jpeg, { failOn: 'error', limitInputPixels: MAX_PREVIEW_PIXELS })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const step = async (op: (s: Sharp) => Sharp) => {
    const raw = { width: info.width, height: info.height, channels: info.channels };
    ({ data, info } = await op(sharp(data, { raw })).raw().toBuffer({ resolveWithObject: true }));
  };
  const angle = { 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 }[orientation];
  if (angle) await step((s) => s.rotate(angle));
  // 2 mirrors; 4 is 180° and a mirror; 5 and 7 are a quarter turn and a mirror.
  if ([2, 4, 5, 7].includes(orientation)) await step((s) => s.flop());
  return { data, width: info.width, height: info.height, channels: info.channels };
}
