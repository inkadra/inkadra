// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';

/**
 * Playable video copies in several sizes, played over HLS (decision 0128). A server that makes
 * them lists this capability in `GET /api/v1/instance/version`, and its assets carry
 * `Asset.playback`.
 */
export const VIDEO_RENDITIONS_CAPABILITY = 'video-renditions';
/**
 * Renditions encoded while someone watches, for rungs not stored (yet) (decision 0128). Its
 * levels appear in the same master playlist: clients need nothing more than `playback.hls`.
 */
export const VIDEO_LIVE_CAPABILITY = 'video-live';

/** Rungs of the ladder, by the shorter side of the picture. */
export const VIDEO_RUNGS = ['480', '720', '1080', '2160'] as const;
export const VideoRung = z.enum(VIDEO_RUNGS);
export type VideoRung = z.infer<typeof VideoRung>;

export const VideoQuality = z.enum(['light', 'balanced', 'high']);
export type VideoQuality = z.infer<typeof VideoQuality>;

/** Target video bitrate in kbit/s of each rung up to 30 fps; above 30 fps × 1.4. */
export const VIDEO_TARGET_KBPS: Record<VideoQuality, Record<VideoRung, number>> = {
  light: { '480': 900, '720': 1800, '1080': 3500, '2160': 12000 },
  balanced: { '480': 1400, '720': 3000, '1080': 6000, '2160': 20000 },
  high: { '480': 2000, '720': 4500, '1080': 10000, '2160': 32000 },
};
/** Audio of every copy, kbit/s. */
export const VIDEO_AUDIO_KBPS = 128;

/** Megabytes a minute of one rung at most takes, at 30 fps or less: "circa N MB al minuto". */
export const rungMbPerMinute = (quality: VideoQuality, rung: VideoRung) =>
  ((VIDEO_TARGET_KBPS[quality][rung] + VIDEO_AUDIO_KBPS) * 60) / 8 / 1000;

/**
 * The rungs a source of shorter side `side` gets from `chosen`: those below it and a top one
 * no larger than the source (never upscaled), dropping rungs within 80 % of the top one. The
 * top rung keeps the name of the chosen rung it stands for.
 */
export function ladderFor(chosen: readonly VideoRung[], side: number): VideoRung[] {
  const sorted = [...chosen].sort((a, b) => Number(a) - Number(b));
  if (sorted.length === 0 || !(side > 0)) return [];
  const below = sorted.filter((r) => Number(r) < side);
  const above = sorted.find((r) => Number(r) >= side);
  const top = above ?? below.pop();
  if (!top) return [];
  const topSide = Math.min(side, Number(top));
  return [...below.filter((r) => Number(r) <= topSide * 0.8), top];
}

/** Bounds of the custom values of a rung (decision 0128), checked by the server. */
export const VIDEO_BITRATE_MIN = 200_000;
export const VIDEO_BITRATE_MAX = 80_000_000;
export const VIDEO_QUALITY_MAX = 51;
export const VIDEO_LIVE_SESSIONS_MAX = 16;

/**
 * Values an expert admin set for one rung instead of the preset's: target and peak bitrate
 * (bit/s) and the quality value of the active encoder (CRF, CQ or global_quality).
 */
export const VideoRungCustom = z
  .object({
    target: z.int().min(VIDEO_BITRATE_MIN).max(VIDEO_BITRATE_MAX).optional(),
    peak: z.int().min(VIDEO_BITRATE_MIN).max(VIDEO_BITRATE_MAX).optional(),
    quality: z.int().min(0).max(VIDEO_QUALITY_MAX).optional(),
  })
  .strict()
  .openapi('VideoRungCustom');
export type VideoRungCustom = z.infer<typeof VideoRungCustom>;

/** What becomes of each rung: made and kept, made while watched, or not offered. */
export const VideoRungMode = z.enum(['stored', 'live', 'off']);
export type VideoRungMode = z.infer<typeof VideoRungMode>;

export const VideoSettings = z
  .object({
    quality: VideoQuality,
    rungs: z.record(VideoRung, VideoRungMode).openapi({
      description:
        'Every rung, by name. At least one is not `off`. `live` only when `live.enabled`.',
    }),
    playable: z.enum(['heavy', 'always', 'never']).openapi({
      description:
        'Originals the browser already plays: copies only when heavy (shorter side over ' +
        '1080, over 12 Mbit/s or over 60 fps), always, or never.',
    }),
    live: z
      .object({
        enabled: z.boolean(),
        maxSessions: z
          .int()
          .min(0)
          .max(VIDEO_LIVE_SESSIONS_MAX)
          .openapi({
            description:
              'Renditions encoded at once for viewers, on the whole instance; 0 turns live ' +
              'playback off. By default what the worker measured; the admin may set more.',
          }),
        perViewer: z.int().min(1).max(8).openapi({
          description: 'At once for one person or one share link.',
        }),
      })
      .openapi({
        description:
          'Renditions made while someone watches: right after an upload, for `live` rungs, ' +
          'past the limits the player keeps to the stored ones.',
      }),
    custom: z.partialRecord(VideoRung, VideoRungCustom).optional().openapi({
      description: 'Values set by hand over the preset, by rung (Advanced).',
    }),
  })
  .openapi('VideoSettings');
export type VideoSettings = z.infer<typeof VideoSettings>;

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  quality: 'balanced',
  rungs: { '480': 'stored', '720': 'stored', '1080': 'stored', '2160': 'off' },
  playable: 'heavy',
  live: { enabled: true, maxSessions: 3, perViewer: 1 },
};

/**
 * Whether live playback can run on this instance (decision 0128): only on a GPU, with the
 * sessions the worker measured, the admin's own value, or VIDEO_LIVE_MAX_SESSIONS, which wins.
 */
export const VideoLiveStatus = z
  .object({
    available: z.boolean(),
    reason: z
      .enum(['no-gpu', 'too-slow', 'failed', 'set-off'])
      .nullable()
      .openapi({
        description:
          '`no-gpu`: no hardware encoder (libx264 never encodes live). `too-slow`: the GPU ' +
          'measured under 1.5× real time. `failed`: the measurement failed (see the log). ' +
          '`set-off`: VIDEO_LIVE_MAX_SESSIONS is 0.',
      }),
    sessions: z
      .int()
      .min(0)
      .openapi({ description: 'The cap: measured, or from the environment.' }),
    measured: z.int().min(0).nullable().optional().openapi({
      description: 'Sessions the last measurement allowed; the admin may set more.',
    }),
    speed: z.number().positive().nullable().openapi({
      description: 'Speed of one 1080p live encode measured at start, × real time.',
    }),
    measuredAt: z.iso.datetime().nullable(),
    locked: z.boolean().openapi({ description: 'VIDEO_LIVE_MAX_SESSIONS is set.' }),
  })
  .openapi('VideoLiveStatus');
export type VideoLiveStatus = z.infer<typeof VideoLiveStatus>;

export const UpdateVideoSettings = z
  .object({
    quality: VideoQuality.optional(),
    rungs: z.record(VideoRung, VideoRungMode).optional(),
    playable: VideoSettings.shape.playable.optional(),
    live: VideoSettings.shape.live
      .partial()
      .extend({
        maxSessions: z.int().min(0).max(VIDEO_LIVE_SESSIONS_MAX).nullable().optional().openapi({
          description: 'null: back to the value the worker measured.',
        }),
      })
      .optional(),
    /** A rung set to null, or a field left out, goes back to the preset. */
    custom: z.partialRecord(VideoRung, VideoRungCustom.nullable()).optional(),
  })
  .strict()
  .openapi('UpdateVideoSettings');
export type UpdateVideoSettings = z.infer<typeof UpdateVideoSettings>;

/** Minutes of video on the instance by the rung of their shorter side, and fast or not. */
export const VideoLibrary = z
  .object({
    side: VideoRung,
    minutes: z.number().nonnegative(),
    fastMinutes: z.number().nonnegative().openapi({ description: 'Of which above 30 fps.' }),
    videos: z.int().min(0),
  })
  .openapi('VideoLibrary');

export const VideoBackfill = z
  .object({
    scope: z.enum(['missing', 'outdated']),
    status: z.enum(['running', 'stopped', 'done']),
    total: z.int().min(0),
    done: z.int().min(0),
    startedAt: z.iso.datetime(),
  })
  .openapi('VideoBackfill');
export type VideoBackfill = z.infer<typeof VideoBackfill>;

export const VideoSettingsView = z
  .object({
    settings: VideoSettings,
    locked: z
      .object({
        quality: z.boolean(),
        rungs: z.boolean(),
        live: z.boolean(),
      })
      .openapi({
        description:
          'Set by the server environment (VIDEO_QUALITY, VIDEO_RENDITIONS, VIDEO_LIVE): ' +
          'read-only here.',
      }),
    enabled: z.boolean().openapi({ description: 'VIDEO_PROXIES and ffmpeg on the worker.' }),
    encoder: z
      .object({
        label: z.string(),
        backend: z.enum(['nvenc', 'qsv', 'vaapi', 'software']),
        tuning: z.enum(['full', 'basic']).nullable(),
        av1: z.boolean().openapi({ description: 'The card encodes AV1: shown, not used.' }),
        requested: z.string().openapi({ description: 'VIDEO_PROXY_HWACCEL.' }),
        concurrency: z.int().min(1),
      })
      .nullable()
      .openapi({ description: 'Detected by the last worker to start; null without one.' }),
    queue: z.object({ queued: z.int().min(0), processing: z.int().min(0) }),
    library: z.array(VideoLibrary),
    copiesBytes: z.number().nonnegative().openapi({ description: 'Space the copies take now.' }),
    freeBytes: z.number().nonnegative().nullable().openapi({
      description: 'Free space under DATA_DIR; null on S3.',
    }),
    outdated: z.int().min(0).openapi({
      description: 'Videos whose copies were made with other settings, or are missing.',
    }),
    speed: z
      .number()
      .positive()
      .nullable()
      .openapi({
        description:
          'Seconds of video encoded per second, from recent copies; null before any. Divides ' +
          'the minutes of `library` into the time a regeneration takes.',
      }),
    backfill: VideoBackfill.nullable(),
    liveStatus: VideoLiveStatus.optional(),
    /** A new measurement of the encoder and of live playback asked from the page. */
    benchmark: z
      .object({ running: z.boolean(), startedAt: z.iso.datetime().nullable() })
      .optional(),
    /**
     * The values of each preset for each rung on the active encoder, for the Advanced fields:
     * target and peak (bit/s, up to 30 fps) and the quality value, named by `qualityParam`.
     */
    presetValues: z
      .record(
        VideoQuality,
        z.record(VideoRung, z.object({ target: z.int(), peak: z.int(), quality: z.int() })),
      )
      .optional(),
    qualityParam: z.enum(['crf', 'cq', 'global_quality']).optional(),
  })
  .openapi('VideoSettingsView');
export type VideoSettingsView = z.infer<typeof VideoSettingsView>;

export const StartVideoBackfill = z
  .object({ scope: z.enum(['missing', 'outdated']) })
  .strict()
  .openapi('StartVideoBackfill');

// Playback of an asset ---------------------------------------------------------------------

export const AssetRendition = z
  .object({
    name: VideoRung,
    status: z.enum(['queued', 'processing', 'ready', 'failed']),
    progress: z.int().min(0).max(100).nullable(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    bitrate: z.int().nullable().openapi({ description: 'Average, bit/s, once ready.' }),
    size: z.number().int().min(0).nullable().openapi({ description: 'Bytes once ready.' }),
    url: z
      .string()
      .nullable()
      .openapi({
        description:
          'Same-origin path of the fragmented MP4 of the rung, playable on its own with ' +
          '`Range`, once ready.',
      }),
    live: z
      .boolean()
      .optional()
      .openapi({
        description:
          'The master playlist offers this rung encoded while watched until it is ready, or ' +
          'for good when it is not stored. Only from servers with `video-live`.',
      }),
  })
  .openapi('AssetRendition');
export type AssetRendition = z.infer<typeof AssetRendition>;

export const AssetPlayback = z
  .object({
    hls: z
      .string()
      .nullable()
      .openapi({
        description:
          'Same-origin path of the HLS master playlist (`/api/v1/assets/{assetId}/hls/' +
          'master.m3u8?v=…`), once a rung is ready or can be encoded live; null before.',
      }),
    original: z.boolean().openapi({
      description: 'The original plays in the browser as it is: offer it as a choice.',
    }),
    renditions: z.array(AssetRendition).openapi({
      description: 'Smallest first; a rung larger than the source is never listed.',
    }),
  })
  .openapi('AssetPlayback');
export type AssetPlayback = z.infer<typeof AssetPlayback>;
