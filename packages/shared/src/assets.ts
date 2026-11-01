// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

export const AssetKind = z.enum(['image', 'video', 'audio', 'file']);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetStatus = z.enum(['pending', 'processing', 'ready', 'failed']);

/**
 * Camera RAW formats, by file extension. The worker makes the thumbnails of these from the
 * JPEG preview the camera embedded (decision 0048); the original is kept and downloaded as
 * it is.
 */
export const RAW_IMAGE_TYPES = {
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  dng: 'image/x-adobe-dng',
  raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
} as const;

/** True for the type of a camera RAW file (`Asset.mime`). */
export const isRawImageType = (mime: string) =>
  (Object.values(RAW_IMAGE_TYPES) as string[]).includes(mime);

/** Thumbnail widths produced by the worker; every variant is WebP. */
export const ThumbnailSize = z.enum(['256', '512', '1024', '2048']);
export type ThumbnailSize = z.infer<typeof ThumbnailSize>;

export const AssetVariant = z
  .object({
    size: ThumbnailSize,
    width: z.int(),
    height: z.int(),
    url: z.string().openapi({
      description: 'Same-origin path, `/api/v1/assets/{assetId}/variants/{size}`.',
    }),
  })
  .openapi('AssetVariant');

/**
 * State of the H.264/AAC MP4 copy the worker makes of a video the browser cannot play
 * (ProRes, MKV, AVI, MXF, HEVC…), or of the AAC M4A of an audio file not every browser plays
 * (Ogg, Opus, WebM, AIFF, CAF, ALAC). `skipped` means one was needed but not made: proxies are
 * turned off (VIDEO_PROXIES), the source is past the limits, or the server has no ffmpeg.
 */
export const AssetProxyStatus = z.enum(['queued', 'processing', 'ready', 'failed', 'skipped']);
export type AssetProxyStatus = z.infer<typeof AssetProxyStatus>;

export const AssetProxy = z
  .object({
    status: AssetProxyStatus,
    progress: z.int().min(0).max(100).nullable().openapi({
      description: 'Percent done while `processing`; 100 once `ready`; null when unknown.',
    }),
    url: z
      .string()
      .nullable()
      .openapi({
        description:
          'Same-origin path, `/api/v1/assets/{assetId}/proxy`, once `ready`; null before. ' +
          'Supports `Range`. The original stays at `Asset.url`.',
      }),
    mime: z.enum(['video/mp4', 'audio/mp4']),
    width: z.int().nullable(),
    height: z.int().nullable(),
    size: z.int().min(0).nullable().openapi({ description: 'Bytes of the copy once ready.' }),
  })
  .openapi('AssetProxy');
export type AssetProxy = z.infer<typeof AssetProxy>;

/**
 * The route of a GPX file (decision 0053): its length, the climb when the points have an
 * elevation, and the line to draw over the preview, as x, y pairs in fractions of the
 * preview's width and height (at most 512 points).
 */
export const AssetTrack = z
  .object({
    distanceM: z.number().min(0),
    elevationGainM: z.number().min(0).nullable().openapi({
      description: 'Total climb, ignoring rises under 3 m; null without elevations.',
    }),
    points: z.array(z.number().min(0).max(1)).max(1024),
    view: z
      .object({ zoom: z.int().min(1).max(19), left: z.number(), top: z.number() })
      .optional()
      .openapi({
        description:
          'Where the picture of the route sits on the map: its zoom and top-left corner in ' +
          'Web Mercator pixels, 256 per tile, so `points` can be placed on an interactive map. ' +
          'Absent for routes read before it was recorded.',
      }),
  })
  .openapi('AssetTrack');
export type AssetTrack = z.infer<typeof AssetTrack>;

export const Asset = z
  .object({
    id: Id,
    projectId: Id,
    kind: AssetKind,
    mime: z.string(),
    filename: z.string(),
    size: z.int().min(0),
    sha256: z.string().length(64).nullable(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    durationMs: z.int().nullable(),
    videoCodec: z.string().nullable().openapi({
      description: 'Codec of the first video stream as ffprobe names it (`h264`, `prores`…).',
    }),
    audioCodec: z.string().nullable().openapi({
      description: 'Codec of the first audio stream (`aac`, `pcm_s16le`…); null when silent.',
    }),
    frameRate: z.number().nullable().openapi({ description: 'Frames per second of videos.' }),
    pageCount: z
      .int()
      .min(1)
      .nullable()
      .openapi({
        description:
          'Pages of a PDF; null for other files and for PDFs the server could not read ' +
          '(encrypted with a password to open, broken) or has no poppler for.',
      }),
    proxy: AssetProxy.nullable().openapi({
      description:
        'Playable MP4 copy of a video in a format browsers do not play, or AAC copy of an ' +
        'audio file not every browser plays. Null for other files and for media that already ' +
        'play (H.264 MP4, WebM, MP3, AAC, WAV, FLAC): use `url` then.',
    }),
    waveformUrl: z
      .string()
      .nullable()
      .openapi({
        description:
          'Peaks of an audio file (`AudioWaveform`), same-origin path ' +
          '`/api/v1/assets/{assetId}/waveform`, once ready; null for other files and without ' +
          'ffmpeg on the server.',
      }),
    status: AssetStatus,
    url: z.string().openapi({
      description:
        'Original file, served with the session cookie or token: same-origin path ' +
        '`/api/v1/assets/{assetId}/file`.',
    }),
    variants: z.array(AssetVariant).openapi({
      description:
        'WebP thumbnails, smallest first, empty until `status` is `ready`. Sizes wider than ' +
        'the original are skipped. For videos they show a poster frame, when the server has ' +
        'ffmpeg (Instance.media.videoPosters); otherwise videos have none. Camera RAW files ' +
        '(`mime` in RAW_IMAGE_TYPES) get them from the JPEG preview the camera embedded, ' +
        'when the server has exiftool (Instance.media.rawPreviews); none when there is no ' +
        'preview. PDFs get them from page 1 (Instance.media.pdfPreviews), and `width` and ' +
        '`height` are then the size of that rendered page, for its aspect ratio; none when ' +
        'the PDF does not render.',
    }),
    exif: z.record(z.string(), z.unknown()).nullable().openapi({
      description: 'Camera and exposure data. Location (GPS) fields are never stored.',
    }),
    palette: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).nullable(),
    animated: z.boolean().openapi({
      description:
        'True when the source moves and the worker wrote moving thumbnails beside the ' +
        'posters: add `?animated=1` to a variant URL up to 1024 px wide to play it. False ' +
        'for still pictures, for videos, and for GIFs past the worker limits.',
    }),
    track: AssetTrack.nullable().openapi({
      description:
        'The route of a GPX file, read by the worker; null for other files and GPX files ' +
        'without a track. Its preview (`variants`) is the map around the route, when the ' +
        'instance has maps (Instance.maps).',
    }),
    sourceUrl: z.url().nullable(),
    createdAt: Timestamp,
  })
  .openapi('Asset');
export type Asset = z.infer<typeof Asset>;

/** The waveform of an audio file: peaks from 0 to 100, the loudest at 100, oldest first. */
export const AudioWaveform = z
  .object({ peaks: z.array(z.int().min(0).max(100)).max(1000) })
  .openapi('AudioWaveform');
export type AudioWaveform = z.infer<typeof AudioWaveform>;

/**
 * Metadata sent in the tus `Upload-Metadata` header (values base64 encoded, as tus requires).
 * See https://tus.io/protocols/resumable-upload.
 */
export const UploadMetadata = z
  .object({
    projectId: Id,
    boardId: Id.optional().openapi({
      description:
        'Board the file goes to. People who can edit that board but are not editors of the ' +
        'whole project (board grants) must send it.',
    }),
    filename: z.string().min(1).max(255),
    filetype: z.string().min(1).max(255),
  })
  .openapi('UploadMetadata');
export type UploadMetadata = z.infer<typeof UploadMetadata>;

export const VariantParams = z.object({ assetId: Id, size: ThumbnailSize });

/**
 * Query of the thumbnail routes: `?animated=1` asks for the moving copy of the thumbnail
 * of a GIF or an animated WebP, at `variants/<size>-animated.webp`. Only ask for it when
 * the asset says `animated`; otherwise the answer is 404.
 */
export const VariantQuery = z.object({
  animated: z
    .enum(['1'])
    .optional()
    .openapi({
      description:
        'Ask for the moving copy of the thumbnail, when the asset has one (`Asset.animated`). ' +
        'The poster comes back when the flag is missing.',
    }),
});
export type VariantQuery = z.infer<typeof VariantQuery>;

/** Body of POST /api/v1/link-previews. */
export const CreateLinkPreview = z
  .object({
    projectId: Id.openapi({ description: 'Project that will own the preview image asset.' }),
    boardId: Id.optional().openapi({ description: 'As in UploadMetadata.' }),
    url: z.url({ protocol: /^https?$/ }),
  })
  .openapi('CreateLinkPreview');
export type CreateLinkPreview = z.infer<typeof CreateLinkPreview>;

export const LinkPreview = z
  .object({
    url: z.url().openapi({ description: 'Final address after redirects.' }),
    title: z.string().max(500).nullable(),
    description: z.string().max(2000).nullable(),
    siteName: z.string().max(200).nullable(),
    imageAssetId: Id.nullable().openapi({
      description: 'Preview image (og:image) copied into the project as an asset.',
    }),
  })
  .openapi('LinkPreview');
export type LinkPreview = z.infer<typeof LinkPreview>;
