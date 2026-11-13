/**
 * Quality presets of playable copies (decision 0128): what each rung of the H.264 ladder aims
 * for. Rates are per shorter side and frame rate; the encoders aim at a constant quality under
 * a peak (CRF, CQ or QVBR), so simple footage stays below the target.
 */
export type VideoQuality = 'light' | 'balanced' | 'high';
export const VIDEO_QUALITIES = ['light', 'balanced', 'high'] as const;
export const DEFAULT_VIDEO_QUALITY: VideoQuality = 'balanced';

/** Rungs of the ladder, by shorter side. */
export const RUNGS = [480, 720, 1080, 2160] as const;
export type Rung = (typeof RUNGS)[number];

/** Target video bitrate in kbit/s of each rung, up to 30 frames per second. */
export const TARGET_KBPS: Record<VideoQuality, Record<Rung, number>> = {
  light: { 480: 900, 720: 1800, 1080: 3500, 2160: 12000 },
  balanced: { 480: 1400, 720: 3000, 1080: 6000, 2160: 20000 },
  high: { 480: 2000, 720: 4500, 1080: 10000, 2160: 32000 },
};

/** Audio of every copy: AAC-LC stereo. */
export const AUDIO_KBPS = 128;

/** Above 30 frames per second each frame gets fewer bits: the target grows by 40 %. */
const FAST_FPS = 30;
const FAST_FACTOR = 1.4;
/** Peak (`-maxrate`) over target; the buffer is two seconds at the peak. */
const PEAK_FACTOR = 1.5;

/**
 * Quality values of each encoder per preset, set by the spike of decision 0128 (VMAF of 1080p
 * copies of 4K camera files on libx264 and NVENC; Quick Sync and VAAPI from Immich's values).
 */
export const QUALITY_VALUES: Record<
  VideoQuality,
  { crf: number; x264Preset: string; cq: number; globalQuality: number }
> = {
  light: { crf: 24, x264Preset: 'veryfast', cq: 28, globalQuality: 28 },
  balanced: { crf: 21, x264Preset: 'fast', cq: 26, globalQuality: 24 },
  high: { crf: 19, x264Preset: 'medium', cq: 23, globalQuality: 21 },
};

export interface RungRate {
  /** Average the encoder aims at, bit/s (`-b:v` on Quick Sync and VAAPI). */
  target: number;
  /** `-maxrate`, bit/s. */
  peak: number;
  /** `-bufsize`, bits: two seconds at the peak. */
  buffer: number;
}

/**
 * Rate of a copy whose shorter side is `side` pixels at `fps` frames per second. A side
 * between rungs (a 900p source) takes the rate of the rung above scaled by the area; a side
 * past 2160 takes 2160's. `maxPeak` (VIDEO_PROXY_BITRATE) caps the peak, and the target under it.
 */
export function rungRate(
  quality: VideoQuality,
  side: number,
  fps: number | null,
  maxPeak?: number | null,
): RungRate {
  const rung = RUNGS.find((r) => r >= side) ?? 2160;
  const area = Math.min(1, (side / rung) ** 2);
  const fast = fps !== null && fps > FAST_FPS + 0.5 ? FAST_FACTOR : 1;
  let target = TARGET_KBPS[quality][rung] * 1000 * area * fast;
  let peak = target * PEAK_FACTOR;
  if (maxPeak && peak > maxPeak) {
    peak = maxPeak;
    target = Math.min(target, maxPeak / PEAK_FACTOR);
  }
  return { target: Math.round(target), peak: Math.round(peak), buffer: Math.round(peak * 2) };
}

/** Bits per second as ffmpeg reads them: `5M`, `2500k`, `800000`; null when it is not one. */
export function parseBitrate(value: string | null | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(value ?? '');
  if (!m) return null;
  const unit = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() ?? ''] ?? 1;
  return Number(m[1]) * unit;
}
