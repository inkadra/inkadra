import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { instanceSetting } from '../db/schema.ts';
import {
  type Detection,
  detectVideoEncoder,
  type EncoderTuning,
  type HwAccelMode,
  type LiveMeasure,
  measureLive,
  SOFTWARE_ENCODER,
  type VideoEncoder,
} from './hwaccel.ts';
import { mediaTools } from './tools.ts';

/** Key of the encoder the last worker to start detected: the web role shows it. */
const KEY = 'videoEncoder';

export interface SavedEncoder {
  backend: VideoEncoder['backend'];
  label: string;
  requested: HwAccelMode;
  detectedAt: string;
  /** Rate control the card took (decision 0128); absent on libx264 and older rows. */
  tuning?: EncoderTuning;
  /** Codecs the card encodes (`h264`, `av1`): AV1 is shown, not used. */
  codecs?: string[];
  /**
   * Live playback measured at start (decision 0128): sessions at once (0: off), the speed of one
   * 1080p encode (× real time), when, and why it is off.
   */
  liveSessions?: number;
  liveSpeed?: number | null;
  measuredAt?: string;
  liveError?: string | null;
}

interface Log {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Detects the encoder of playable copies when the worker starts, logs the choice and saves it
 * for Diagnostics. Software when ffmpeg is missing or detection fails; never throws.
 */
export async function chooseVideoEncoder(
  db: Database,
  opts: { mode: HwAccelMode; vaapiDevice: string },
  log: Log,
  detect: typeof detectVideoEncoder = detectVideoEncoder,
  measure: typeof measureLive = measureLive,
): Promise<VideoEncoder> {
  const { ffmpeg } = await mediaTools();
  if (!ffmpeg) {
    await forgetVideoEncoder(db);
    return SOFTWARE_ENCODER;
  }
  let detection: Detection;
  try {
    detection = await detect(ffmpeg, opts);
  } catch (err) {
    log.warn({ err }, 'video encoder detection failed: playable copies use libx264');
    detection = { encoder: SOFTWARE_ENCODER, requested: opts.mode, rejected: [] };
  }
  const { encoder, requested, rejected } = detection;
  const fields = { encoder: encoder.label, requested, rejected };
  if (encoder.backend === 'software' && requested !== 'auto' && requested !== 'none')
    log.warn(fields, `VIDEO_PROXY_HWACCEL=${requested} does not work here: using libx264`);
  else log.info(fields, `video encoding: ${encoder.label}`);
  const value: SavedEncoder = {
    backend: encoder.backend,
    label: encoder.label,
    requested,
    detectedAt: new Date().toISOString(),
    ...(encoder.tuning ? { tuning: encoder.tuning } : {}),
    ...(encoder.codecs ? { codecs: encoder.codecs } : {}),
  };
  // Live playback: measured on a hardware encoder only; libx264 never encodes live.
  if (encoder.backend !== 'software') {
    const live = await measure(ffmpeg, encoder).catch(
      (err): LiveMeasure => ({ sessions: 0, speed: null, error: String(err) }),
    );
    Object.assign(value, {
      liveSessions: live.sessions,
      liveSpeed: live.speed,
      measuredAt: new Date().toISOString(),
      liveError: live.error,
    });
    if (live.error)
      log.warn({ speed: live.speed, reason: live.error }, 'live video playback is off');
    else log.info({ sessions: live.sessions, speed: live.speed }, 'live video playback measured');
  }
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value: { ...value } })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value: { ...value } } });
  return encoder;
}

/** No playable copies here (VIDEO_PROXIES=false, no ffmpeg): Diagnostics shows none. */
export async function forgetVideoEncoder(db: Pick<Database, 'delete'>) {
  await db.delete(instanceSetting).where(eq(instanceSetting.key, KEY));
}

/** The encoder saved by the last worker to start, or null (no worker, no ffmpeg). */
export async function readVideoEncoder(db: Pick<Database, 'select'>): Promise<SavedEncoder | null> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const value = row?.value as Partial<SavedEncoder> | undefined;
  if (!value || typeof value.label !== 'string' || typeof value.backend !== 'string') return null;
  return {
    backend: value.backend,
    label: value.label,
    requested: value.requested ?? 'auto',
    detectedAt: value.detectedAt ?? '',
    ...(value.tuning === 'full' || value.tuning === 'basic' ? { tuning: value.tuning } : {}),
    ...(Array.isArray(value.codecs)
      ? { codecs: value.codecs.filter((c): c is string => typeof c === 'string').slice(0, 4) }
      : {}),
    ...(typeof value.liveSessions === 'number'
      ? {
          liveSessions: Math.max(0, Math.min(8, Math.floor(value.liveSessions))),
          liveSpeed: typeof value.liveSpeed === 'number' ? value.liveSpeed : null,
          measuredAt: typeof value.measuredAt === 'string' ? value.measuredAt : '',
          liveError: typeof value.liveError === 'string' ? value.liveError : null,
        }
      : {}),
  };
}
