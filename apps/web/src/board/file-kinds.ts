// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import { type Asset, isRawImageType } from '@inkadra/shared';

/**
 * The file card family (#325): every file has the same anatomy, and the colour of its type
 * badge tells the family. `text` is the word-processor blue of the mockup; the rest follow
 * the palette tokens (see `.fbadge--*` in board.css).
 */
export type FileFamily =
  | 'doc'
  | 'text'
  | 'video'
  | 'audio'
  | 'image'
  | 'design'
  | 'map'
  | '3d'
  | 'font'
  | 'generic';

const BY_EXTENSION: Record<string, FileFamily> = {};
const families: Array<[FileFamily, string]> = [
  ['doc', 'pdf xls xlsx xlsm ods csv ppt pptx odp key numbers epub fdx fountain'],
  ['text', 'doc docx odt rtf pages txt md'],
  ['video', 'mov mp4 m4v mkv avi mxf webm mts m2ts mpg mpeg wmv flv 3gp r3d braw'],
  ['audio', 'mp3 m4a aac wav aif aiff flac ogg oga opus wma caf'],
  [
    'image',
    'jpg jpeg png gif webp avif heic heif tif tiff bmp svg cr2 cr3 nef arw dng raf orf rw2 exr',
  ],
  ['design', 'psd psb procreate ai indd idml sketch fig xd afdesign afphoto aep prproj drp'],
  ['map', 'gpx kml kmz geojson'],
  ['3d', 'glb gltf obj fbx stl usdz blend 3ds dae ply'],
  ['font', 'otf ttf woff woff2'],
  ['generic', 'zip rar 7z tar gz tgz bz2 xz dmg iso'],
];
for (const [family, list] of families)
  for (const ext of list.split(' ')) BY_EXTENSION[ext] = family;

/** Lower-case extension of a file name, without the dot; empty when it has none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * The name split so the stem can be cut with an ellipsis while the extension stays visible:
 * `intervista-A001` + `.mov`. A name without an extension is all stem.
 */
export function splitName(filename: string): { stem: string; ext: string } {
  const ext = extensionOf(filename);
  if (!ext || ext.length > 9) return { stem: filename, ext: '' };
  return { stem: filename.slice(0, -(ext.length + 1)), ext: filename.slice(-(ext.length + 1)) };
}

export const isDesignFile = (filename: string) => BY_EXTENSION[extensionOf(filename)] === 'design';

type Kind = Pick<Asset, 'kind' | 'mime' | 'filename'>;

export function isPdf(asset: Kind): boolean {
  return (
    extensionOf(asset.filename) !== 'ai' &&
    (asset.mime === 'application/pdf' || extensionOf(asset.filename) === 'pdf')
  );
}

export function isRaw(asset: Kind): boolean {
  return isRawImageType(asset.mime);
}

export function fileFamily(asset: Kind): FileFamily {
  if (isDesignFile(asset.filename)) return 'design';
  if (asset.kind === 'video') return 'video';
  if (asset.kind === 'audio') return 'audio';
  if (asset.kind === 'image' || isRaw(asset)) return 'image';
  if (isPdf(asset)) return 'doc';
  const byExt = BY_EXTENSION[extensionOf(asset.filename)];
  if (byExt) return byExt;
  if (asset.mime.startsWith('video/')) return 'video';
  if (asset.mime.startsWith('audio/')) return 'audio';
  if (asset.mime.startsWith('image/')) return 'image';
  if (asset.mime.startsWith('font/')) return 'font';
  return 'generic';
}

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  dnxhr: 'DNxHR',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  mjpeg: 'MJPEG',
  cfhd: 'CineForm',
};

/** A codec as people read it: `prores` is ProRes, `h264` is H.264. */
export function codecName(codec: string | null | undefined): string {
  if (!codec) return '';
  return CODEC_NAMES[codec.toLowerCase()] ?? codec.toUpperCase();
}

/**
 * The word in the type badge. Camera RAW files say RAW, ProRes says PRORES (the codec is what
 * matters in a MOV); everything else says its extension, at most five letters.
 */
export function fileBadge(asset: Pick<Asset, 'kind' | 'mime' | 'filename' | 'videoCodec'>): string {
  if (isRaw(asset)) return 'RAW';
  if (asset.videoCodec?.toLowerCase().startsWith('prores')) return 'PRORES';
  const ext = extensionOf(asset.filename);
  if (ext) return (fileFamily(asset) === 'design' ? ext : ext.slice(0, 5)).toUpperCase();
  if (isPdf(asset)) return 'PDF';
  return '';
}

/** 4,2 MB in Italian, 4.2 MB in English: one decimal under ten, none above. */
export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v < 10 ? 1 : 0;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(v);
  return `${number} ${units[i]}`;
}

/** 4K, 6K for camera resolutions, else the short side: 1080p, 720p. */
export function resolutionLabel(width: number | null, height: number | null): string {
  if (!width || !height) return '';
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long >= 3800) return `${Math.round(long / 1024)}K`;
  return `${short}p`;
}

/** 25 fps, 23.98 fps. */
export function fpsLabel(rate: number | null | undefined, locale?: string): string {
  if (!rate || !Number.isFinite(rate) || rate <= 0) return '';
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate);
  return `${value} fps`;
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** X-T5 · f/2 · 1/250: the camera and the exposure of a photo, for its card. */
export function exposureParts(exif: Record<string, unknown> | null | undefined): string[] {
  if (!exif) return [];
  const make = text(exif.Make).trim();
  let model = text(exif.Model).trim();
  if (make && model.toLowerCase().startsWith(make.toLowerCase()))
    model = model.slice(make.length).trim();
  const parts = [model || make];
  if (typeof exif.FNumber === 'number' && exif.FNumber > 0) parts.push(`f/${exif.FNumber}`);
  const t = exif.ExposureTime;
  if (typeof t === 'number' && t > 0)
    parts.push(t >= 1 ? `${Math.round(t * 10) / 10} s` : `1/${Math.round(1 / t)}`);
  return parts.filter(Boolean);
}

/**
 * The pieces of the meta line after the badge, in the order of the mockup: size first, then
 * what tells this file apart (resolution and frame rate, camera and exposure, duration).
 * Page counts are left to the caller, which knows the language.
 */
export function metaParts(
  asset: Pick<
    Asset,
    | 'kind'
    | 'mime'
    | 'filename'
    | 'size'
    | 'width'
    | 'height'
    | 'durationMs'
    | 'videoCodec'
    | 'frameRate'
    | 'exif'
  >,
  locale?: string,
): string[] {
  const parts: string[] = [];
  if (asset.size > 0) parts.push(formatBytes(asset.size, locale));
  const family = fileFamily(asset);
  if (asset.kind === 'video') {
    // ProRes is already in the badge.
    if (!asset.videoCodec?.toLowerCase().startsWith('prores'))
      parts.push(codecName(asset.videoCodec));
    parts.push(resolutionLabel(asset.width, asset.height));
    parts.push(fpsLabel(asset.frameRate, locale));
  } else if (asset.kind === 'audio' || family === 'audio') {
    if (asset.durationMs !== null && asset.durationMs > 0)
      parts.push(formatDuration(asset.durationMs));
  } else if (isRaw(asset)) {
    parts.push(...exposureParts(asset.exif));
  } else if (
    (asset.kind === 'image' || family === 'design') &&
    asset.width &&
    asset.height &&
    !isPdf(asset)
  ) {
    parts.push(`${asset.width}×${asset.height}`);
  }
  return parts.filter(Boolean);
}
