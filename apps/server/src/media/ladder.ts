import { randomBytes } from 'node:crypto';
import { ladderFor, type VideoRung } from '@inkadra/shared';
import {
  encoderMemory,
  FFMPEG_MEMORY,
  SOFTWARE_ENCODER,
  type VideoEncoder,
  videoPipeline,
} from './hwaccel.ts';
import { AUDIO_KBPS, parseBitrate, rungRate } from './quality.ts';
import {
  copiesVideo,
  decodesOnGpu,
  frameFilters,
  mergesMono,
  type ProxySettings,
  proxyPlan,
  safeInput,
  sourceBitrate,
  type VideoInfo,
  webPlayable,
  withinLimits,
} from './video.ts';

/**
 * What a video gets (decision 0128): nothing (it plays and is light, or has no picture),
 * `skip` (one is needed but the instance does not make it), a `remux` into one MP4 (light
 * 8-bit H.264 in a MOV or MKV), an AAC `audio` copy, or the H.264 `ladder` of these rungs.
 */
export type VideoPlan =
  | { kind: 'none' | 'skip' | 'remux' | 'audio' }
  | { kind: 'ladder'; rungs: VideoRung[]; original: boolean };

/** Above these the original is too heavy to stream as it is, even where it plays. */
export const HEAVY_SIDE = 1080;
export const HEAVY_BITRATE = 12_000_000;
export const HEAVY_FPS = 60;

/** Shorter side of the picture as shown, or null. */
export const shortSide = (info: VideoInfo) =>
  info.width && info.height ? Math.min(info.width, info.height) : null;

/** Larger than 1080p, over 12 Mbit/s on average, or over 60 fps. */
export function isHeavy(info: VideoInfo, sourceBytes: number) {
  return (
    (shortSide(info) ?? 0) > HEAVY_SIDE ||
    (sourceBitrate(info, sourceBytes) ?? 0) > HEAVY_BITRATE ||
    (info.frameRate ?? 0) > HEAVY_FPS
  );
}

/** The rungs `info` gets: the stored ones, never above its size nor VIDEO_PROXY_RESOLUTION. */
export function rungsOf(info: VideoInfo, settings: ProxySettings) {
  const side = Math.min(shortSide(info) ?? settings.resolution, settings.resolution);
  return ladderFor(settings.rungs, side);
}

export function videoPlan(
  container: string,
  info: VideoInfo,
  sourceBytes: number,
  settings: ProxySettings,
): VideoPlan {
  const base = proxyPlan(container, info, sourceBytes, settings);
  if (container.startsWith('audio/') || !info.videoCodec)
    return { kind: base === 'make' ? 'audio' : base };
  const playable = webPlayable(container, info);
  if (playable) {
    const wanted =
      settings.playable === 'always' ||
      (settings.playable === 'heavy' && isHeavy(info, sourceBytes));
    // Past the limits the original still plays: nothing is missing.
    if (!wanted || !withinLimits(info, sourceBytes, settings)) return { kind: 'none' };
  } else if (base !== 'make') return { kind: base };
  else if (copiesVideo(info, settings, sourceBytes)) return { kind: 'remux' };
  const rungs = rungsOf(info, settings);
  if (rungs.length === 0) return playable ? { kind: 'none' } : { kind: 'skip' };
  return { kind: 'ladder', rungs, original: playable };
}

/** Shorter side a rung is made at: its own, never more than the source or the cap. */
export function rungSide(info: VideoInfo, settings: ProxySettings, rung: VideoRung) {
  const source = shortSide(info) ?? Number(rung);
  return Math.min(Number(rung), source, settings.resolution);
}

/** What made a rung: the codec, the preset and the version of the encoding table. */
export const RECIPE_VERSION = 1;
export const recipeOf = (settings: ProxySettings) => `h264/${settings.quality}/${RECIPE_VERSION}`;

/** A new generation of files: six characters in their storage key and in their URLs. */
export const newGeneration = () => randomBytes(6).toString('base64url').slice(0, 6);

export const renditionKey = (assetId: string, generation: string, rung: VideoRung) =>
  `variants/${assetId}/r${generation}-${rung}.mp4`;

/** The generation in a rendition key, or null. */
export const generationOf = (key: string | null) =>
  /\/r([A-Za-z0-9_-]{6})-\d+\.mp4$/.exec(key ?? '')?.[1] ?? null;

/** Levels of H.264: macroblocks per second, per frame, and their `level_idc`. */
const LEVELS: Array<[number, number, number]> = [
  [40_500, 1_620, 30],
  [108_000, 3_600, 31],
  [216_000, 5_120, 32],
  [245_760, 8_192, 40],
  [522_240, 8_704, 42],
  [589_824, 22_080, 50],
  [983_040, 36_864, 51],
  [2_073_600, 36_864, 52],
];

/** RFC 6381 codecs of a rung: H.264 High at the level its size and rate need, and AAC-LC. */
export function renditionCodecs(width: number, height: number, fps: number | null) {
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = frame * Math.min(fps ?? 30, 60);
  const level = LEVELS.find(([rate, size]) => mbps <= rate && frame <= size)?.[2] ?? 52;
  return `avc1.6400${level.toString(16).padStart(2, '0')},mp4a.40.2`;
}

/** Fragmented MP4 with one index at the front, fragments of about 4 s starting on keyframes. */
export const FRAGMENTED = [
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof+global_sidx',
  '-min_frag_duration',
  '4000000',
];

export interface LadderOutput {
  rung: VideoRung;
  path: string;
}

/**
 * ffmpeg arguments of one run that decodes `input` once and writes each of `outputs` (decision
 * 0128: the spike measured three rungs from a 4K source 2.6 times faster in one run with
 * `split` than one after the other). Sound is AAC-LC stereo at 48 kHz in every rung, the two
 * mono tracks of a camera merged.
 */
export function ladderArgs(
  input: string,
  outputs: LadderOutput[],
  info: VideoInfo,
  settings: ProxySettings,
  encoder: VideoEncoder = settings.encoder ?? SOFTWARE_ENCODER,
  container: string | null = null,
) {
  const n = outputs.length;
  const gpu = decodesOnGpu(encoder, info);
  const { pre, post, hdr } = frameFilters(info);
  const pipelines = outputs.map((o) => {
    const side = rungSide(info, settings, o.rung);
    return videoPipeline(encoder, {
      resolution: side,
      rate: rungRate(settings.quality, side, info.frameRate, peakCap(settings)),
      quality: settings.quality,
      fps: info.frameRate,
      gpu,
      ...(post ? { post } : {}),
      ...(hdr ? { hdr } : {}),
    });
  });
  const split = outputs.map((_, i) => `[s${i}]`).join('');
  const graph = [
    `[0:V:0]${pre ? `${pre},` : ''}split=${n}${split}`,
    ...pipelines.map((p, i) => `[s${i}]${p.filter}[v${i}]`),
  ];
  const sound = Boolean(info.audioCodec);
  const audioLabels = outputs.map((_, i) => `[a${i}]`).join('');
  if (sound)
    graph.push(
      mergesMono(info)
        ? `[0:a:0][0:a:1]amerge=inputs=2,asplit=${n}${audioLabels}`
        : `[0:a:0]asplit=${n}${audioLabels}`,
    );
  const fps = (info.frameRate ?? 0) > 60 ? ['-fpsmax', '60'] : ['-fps_mode', 'passthrough'];
  return [
    '-nostdin',
    '-v',
    'error',
    '-y',
    ...safeInput(container),
    ...(pipelines[0]?.input ?? []),
    '-i',
    input,
    '-filter_complex',
    graph.join(';'),
    '-progress',
    'pipe:1',
    '-nostats',
    ...outputs.flatMap((o, i) => [
      '-map',
      `[v${i}]`,
      ...(sound ? ['-map', `[a${i}]`] : []),
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      ...(pipelines[i]?.codec ?? []),
      ...fps,
      ...(sound ? ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2', '-ar', '48000'] : []),
      '-threads',
      String(settings.threads),
      ...(settings.maxDurationS > 0 ? ['-t', String(settings.maxDurationS)] : []),
      ...FRAGMENTED,
      '-f',
      'mp4',
      o.path,
    ]),
  ];
}

/** VIDEO_PROXY_BITRATE in bit/s. */
const peakCap = (settings: ProxySettings) => parseBitrate(settings.bitrate);

/** Seconds a run is planned for: the duration, else the limit of the instance or an hour. */
const plannedSeconds = (info: VideoInfo, settings: ProxySettings) => {
  const cap = settings.maxDurationS > 0 ? settings.maxDurationS : 3600;
  return info.durationMs ? Math.min(info.durationMs / 1000, cap) : cap;
};

/** Largest file one rung may be: half again what its peak gives over the planned length. */
export function rungMaxBytes(info: VideoInfo, settings: ProxySettings, rung: VideoRung) {
  const side = rungSide(info, settings, rung);
  const peak = rungRate(settings.quality, side, info.frameRate, peakCap(settings)).peak;
  return Math.ceil((plannedSeconds(info, settings) * (peak + 384_000) * 1.5) / 8) + 16 * 2 ** 20;
}

/**
 * Address space of a run: what one encode of `encoder` gets, plus a GiB per extra rung (each
 * encoder keeps its own frames and lookahead), never more than twice the base.
 */
export function ladderMemory(info: VideoInfo, encoder: VideoEncoder, rungs: number) {
  const base = encoderMemory(encoder, decodesOnGpu(encoder, info));
  return base === FFMPEG_MEMORY
    ? Math.min(2 * base, base + Math.max(0, rungs - 1) * 1024 ** 3)
    : base;
}
