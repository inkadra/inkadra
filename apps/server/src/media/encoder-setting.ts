import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { instanceSetting } from '../db/schema.ts';
import {
  type Detection,
  detectVideoEncoder,
  type HwAccelMode,
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
  };
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
  };
}
