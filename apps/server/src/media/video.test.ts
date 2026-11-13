import { describe, expect, it } from 'vitest';
import {
  copiesVideo,
  DEFAULT_PROXY_SETTINGS,
  decodesOnGpu,
  liveDecodable,
  MAX_INT32,
  parseProbe,
  posterFilter,
  proxyArgs,
  proxyMaxBytes,
  proxyPlan,
  StallWatch,
  safeInput,
  shortCopy,
  sniffAudio,
  TONEMAP,
  type VideoInfo,
  webPlayable,
} from './video.ts';

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({
  durationMs: 10_000,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  audioCodec: 'aac',
  frameRate: 25,
  pixelFormat: 'yuv420p',
  ...over,
});

describe('parseProbe', () => {
  it('keeps the picture stream, not cover art, and turns portrait phone videos', () => {
    const parsed = parseProbe({
      format: { duration: '12.480000' },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        {
          codec_type: 'video',
          codec_name: 'hevc',
          pix_fmt: 'yuv420p10le',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
          side_data_list: [{ rotation: -90 }],
          disposition: { attached_pic: 0 },
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 2 },
      ],
    });
    expect(parsed).toEqual({
      durationMs: 12_480,
      width: 1080,
      height: 1920,
      videoCodec: 'hevc',
      audioCodec: 'aac',
      frameRate: 29.97,
      pixelFormat: 'yuv420p10le',
      hdr: null,
      bits: 10,
      interlaced: false,
      rotated: true,
      audioChannels: [2],
    });
  });

  it('reads HDR, interlacing and the mono tracks of camera files', () => {
    const parsed = parseProbe({
      format: { duration: '6' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'hevc',
          pix_fmt: 'p010le',
          color_transfer: 'arib-std-b67',
          field_order: 'progressive',
        },
        { codec_type: 'audio', codec_name: 'pcm_s24be', channels: 1 },
        { codec_type: 'audio', codec_name: 'pcm_s24be', channels: 1 },
      ],
    });
    expect(parsed).toMatchObject({ hdr: 'hlg', bits: 10, rotated: false, audioChannels: [1, 1] });
    const dv = parseProbe({
      streams: [
        { codec_type: 'video', codec_name: 'mpeg2video', pix_fmt: 'yuv420p', field_order: 'tb' },
      ],
    });
    expect(dv).toMatchObject({ interlaced: true, bits: 8, hdr: null });
    const pq = parseProbe({
      streams: [{ codec_type: 'video', pix_fmt: 'yuv422p12le', color_transfer: 'smpte2084' }],
    });
    expect(pq).toMatchObject({ hdr: 'pq', bits: 12 });
  });

  it('turns odd answers into nulls', () => {
    expect(
      parseProbe({
        format: { duration: 'N/A' },
        streams: [{ codec_type: 'video', codec_name: 'x; rm -rf', avg_frame_rate: '0/0' }],
      }),
    ).toEqual({
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      frameRate: null,
      pixelFormat: null,
      hdr: null,
      bits: 8,
      interlaced: false,
      rotated: false,
      audioChannels: [],
    });
    expect(parseProbe(null).videoCodec).toBeNull();
  });

  it('discards a duration the row could not hold', () => {
    const claim = (duration: string) => parseProbe({ format: { duration } }).durationMs;
    expect(claim(String(MAX_INT32 / 1000))).toBe(MAX_INT32);
    expect(claim('2147484')).toBeNull();
    expect(claim('1e300')).toBeNull();
    expect(claim('Infinity')).toBeNull();
  });
});

describe('webPlayable', () => {
  it('plays H.264 MP4 and VP9 WebM as uploaded', () => {
    expect(webPlayable('video/mp4', info())).toBe(true);
    expect(webPlayable('video/mp4', info({ audioCodec: null }))).toBe(true);
    expect(
      webPlayable('video/webm', info({ videoCodec: 'vp9', audioCodec: 'opus', pixelFormat: null })),
    ).toBe(true);
  });

  it('gives AV1 WebM a copy: Safari plays it only on recent hardware', () => {
    expect(webPlayable('video/webm', info({ videoCodec: 'av1', audioCodec: 'opus' }))).toBe(false);
  });

  it('does not trust camera formats', () => {
    expect(webPlayable('video/quicktime', info({ videoCodec: 'prores' }))).toBe(false);
    expect(webPlayable('video/quicktime', info())).toBe(false);
    expect(webPlayable('video/mp4', info({ videoCodec: 'hevc' }))).toBe(false);
    expect(webPlayable('video/mp4', info({ pixelFormat: 'yuv422p10le' }))).toBe(false);
    expect(webPlayable('video/mp4', info({ audioCodec: 'pcm_s16le' }))).toBe(false);
    expect(webPlayable('video/webm', info())).toBe(false);
    expect(webPlayable('application/mxf', info())).toBe(false);
    expect(webPlayable('video/x-msvideo', info())).toBe(false);
  });
});

describe('proxyPlan', () => {
  const prores = info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' });

  it('makes nothing for a video that already plays or has no picture', () => {
    expect(proxyPlan('video/mp4', info(), 1000, DEFAULT_PROXY_SETTINGS)).toBe('none');
    expect(
      proxyPlan('video/quicktime', info({ videoCodec: null }), 1000, DEFAULT_PROXY_SETTINGS),
    ).toBe('none');
  });

  it('makes a copy within the limits, skips it past them or when turned off', () => {
    expect(proxyPlan('video/quicktime', prores, 1000, DEFAULT_PROXY_SETTINGS)).toBe('make');
    const off = { ...DEFAULT_PROXY_SETTINGS, enabled: false };
    expect(proxyPlan('video/quicktime', prores, 1000, off)).toBe('skip');
    const short = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 5 };
    expect(proxyPlan('video/quicktime', prores, 1000, short)).toBe('skip');
    const small = { ...DEFAULT_PROXY_SETTINGS, maxSourceBytes: 999 };
    expect(proxyPlan('video/quicktime', prores, 1000, small)).toBe('skip');
    const unlimited = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0, maxSourceBytes: 0 };
    expect(proxyPlan('video/quicktime', prores, 10 ** 12, unlimited)).toBe('make');
  });
});

describe('proxyArgs', () => {
  // 5 MB for 10 s: 4 Mbit/s, light enough to remux.
  const args = (i: VideoInfo, settings = DEFAULT_PROXY_SETTINGS) =>
    proxyArgs('/in', '/out.mp4', i, settings, 5 * 1024 ** 2);
  const flagValue = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

  it('only changes the container of H.264 that fits, re-encoding sound that is not AAC', () => {
    const remux = args(info({ audioCodec: 'opus' }));
    expect(remux.join(' ')).toContain('-c:v copy');
    expect(remux.join(' ')).toContain('-c:a aac');
    expect(args(info()).join(' ')).toContain('-c:a copy');
  });

  it('encodes other video to H.264, at most 1080 on the shorter side, safely', () => {
    const encode = args(info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' }));
    const line = encode.join(' ');
    expect(line).toContain('-c:v libx264');
    // Balanced 1080p at 25 fps: 6 Mbit/s aimed at, 9 at peak, a two-second buffer.
    expect(line).toContain('-crf 21 -maxrate 9000000 -bufsize 18000000');
    expect(line).toContain('-force_key_frames expr:gte(t,n_forced*2)');
    expect(line).toContain('min(1080,');
    expect(line).toContain('-protocol_whitelist file');
    expect(line).toContain('+faststart');
    // 4K H.264 is scaled down rather than copied.
    expect(args(info({ width: 3840, height: 2160 })).join(' ')).toContain('libx264');
  });

  it('maps the first real video stream, never cover art', () => {
    const list = args(info());
    expect(list[list.indexOf('-map') + 1]).toBe('0:V:0');
    expect(list).not.toContain('0:v:0');
  });

  it('caps the length and the threads of the copy, and plans its size', () => {
    const list = args(info({ videoCodec: 'prores' }));
    expect(flagValue(list, '-t')).toBe('7200');
    expect(flagValue(list, '-threads')).toBe('2');
    // No -fs: a copy cut at a size would look finished. The size is the kernel's limit.
    expect(list).not.toContain('-fs');
    // 10 s at the 9 Mbit/s peak plus sound, half again, and a 16 MB margin.
    const planned = proxyMaxBytes(info({ videoCodec: 'prores' }), DEFAULT_PROXY_SETTINGS, 5e6);
    expect(planned).toBeLessThan(34 * 1024 ** 2);
    expect(args(info(), { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0 })).not.toContain('-t');
    // A remux is as large as its source, not as the bitrate says.
    expect(
      proxyMaxBytes(info({ audioCodec: 'opus' }), DEFAULT_PROXY_SETTINGS, 5e6),
    ).toBeGreaterThan(5.5e6);
  });

  it('keeps timestamps, and brings slow motion down to 60 fps', () => {
    const prores = info({ videoCodec: 'prores' });
    expect(args(prores).join(' ')).toContain('-fps_mode passthrough');
    const fast = args({ ...prores, frameRate: 120 }).join(' ');
    expect(fast).toContain('-fpsmax 60');
    expect(fast).not.toContain('-fps_mode');
    // A remux keeps the stream as it is.
    expect(args(info({ audioCodec: 'opus' }))).not.toContain('-fps_mode');
  });

  it('merges two mono tracks into stereo, at 48 kHz', () => {
    const camera = info({ videoCodec: 'prores', audioCodec: 'pcm_s24be', audioChannels: [1, 1] });
    const line = args(camera).join(' ');
    expect(line).toContain('-filter_complex [0:a:0][0:a:1]amerge=inputs=2[a]');
    expect(line).toContain('-map 0:V:0 -map [a]');
    expect(line).toContain('-c:a aac -b:a 128k -ac 2 -ar 48000');
    // AAC in two mono tracks is encoded again too.
    expect(args({ ...camera, audioCodec: 'aac' }).join(' ')).not.toContain('-c:a copy');
  });

  it('tone maps HDR and dithers 10 bit after scaling, deinterlaces before', () => {
    const hlg = args(
      info({ videoCodec: 'hevc', pixelFormat: 'yuv420p10le', hdr: 'hlg', bits: 10 }),
    );
    expect(flagValue(hlg, '-vf')).toMatch(
      /flags=lanczos,setsar=1,format=yuv420p10le,zscale=t=linear/,
    );
    expect(flagValue(hlg, '-vf')).not.toContain('out_color_matrix');
    expect(flagValue(hlg, '-vf')).toContain('tonemap=tonemap=hable');
    const log = args(info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le', bits: 10 }));
    expect(flagValue(log, '-vf')).toMatch(
      /out_range=tv,setsar=1,format=yuv420p10le,zscale=dither=error_diffusion,format=yuv420p$/,
    );
    const dv = args(info({ videoCodec: 'dvvideo', interlaced: true }));
    expect(flagValue(dv, '-vf')).toMatch(/^bwdif=mode=send_frame:deint=interlaced,scale=/);
    expect(flagValue(args(info({ videoCodec: 'prores' })), '-vf')).not.toContain('zscale');
  });

  it('plans a video of unknown length for the cap, not for nothing', () => {
    const unknown = info({ videoCodec: 'prores', durationMs: null });
    // 7200 s at 9.384 Mbit/s, half again: about 12 GB, never 0.
    expect(proxyMaxBytes(unknown, DEFAULT_PROXY_SETTINGS, 1000)).toBeGreaterThan(6e9);
    const noCap = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0, maxSourceBytes: 0 };
    // No limit of its own: the 4-hour run limit plans an hour of video.
    expect(proxyMaxBytes(unknown, noCap, 1000)).toBeGreaterThan(3e9);
    expect(proxyPlan('video/quicktime', unknown, 1000, DEFAULT_PROXY_SETTINGS)).toBe('make');
  });
});

describe('StallWatch', () => {
  it('stalls once ffmpeg reports no progress for the whole delay', () => {
    const watch = new StallWatch(1000, 0);
    expect(watch.stalled(999)).toBe(false);
    watch.progress(5, 900);
    // The same time again is no progress.
    watch.progress(5, 1500);
    expect(watch.stalled(1899)).toBe(false);
    expect(watch.stalled(1900)).toBe(true);
    // A device that never gives a first frame stalls too.
    expect(new StallWatch(1000, 0).stalled(1000)).toBe(true);
  });
});

describe('shortCopy', () => {
  it('refuses a copy that stops before the source, up to the limit', () => {
    const source = info({ durationMs: 100_000 });
    expect(shortCopy(source, info({ durationMs: 99_000 }), DEFAULT_PROXY_SETTINGS)).toBeNull();
    expect(shortCopy(source, info({ durationMs: 60_000 }), DEFAULT_PROXY_SETTINGS)).toBe(
      'the copy lasts 60.0 s of 100.0 s',
    );
    expect(shortCopy(source, info({ durationMs: null }), DEFAULT_PROXY_SETTINGS)).not.toBeNull();
    // Cut on purpose at the duration limit: kept.
    const capped = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 60 };
    expect(shortCopy(source, info({ durationMs: 60_000 }), capped)).toBeNull();
    // No duration to compare with: nothing to say.
    expect(shortCopy(info({ durationMs: null }), info(), DEFAULT_PROXY_SETTINGS)).toBeNull();
  });
});

describe('liveDecodable (decision 0128)', () => {
  it('needs a hardware encoder and a source the card decodes, upright, progressive, SDR', () => {
    const qsv = { backend: 'qsv' as const, label: '' };
    const hevc = info({ videoCodec: 'hevc' });
    expect(liveDecodable(qsv, hevc)).toBe(true);
    expect(liveDecodable(undefined, hevc)).toBe(false);
    expect(liveDecodable({ backend: 'software', label: '' }, hevc)).toBe(false);
    expect(liveDecodable(qsv, { ...hevc, hdr: 'pq' })).toBe(false);
    expect(liveDecodable(qsv, { ...hevc, rotated: true })).toBe(false);
    expect(liveDecodable(qsv, info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' }))).toBe(
      false,
    );
  });
});

describe('decodesOnGpu', () => {
  it('keeps rotated and interlaced sources off the card', () => {
    const nvenc = { backend: 'nvenc' as const, label: '' };
    const hevc = info({ videoCodec: 'hevc' });
    expect(decodesOnGpu(nvenc, hevc)).toBe(true);
    expect(decodesOnGpu(nvenc, { ...hevc, rotated: true })).toBe(false);
    expect(decodesOnGpu(nvenc, { ...hevc, interlaced: true })).toBe(false);
  });
});

describe('audio files (#327)', () => {
  const bytes = (...parts: Array<string | number[]>) =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  const sound = (audioCodec: string) =>
    info({ videoCodec: null, width: null, height: null, frameRate: null, audioCodec });

  it('tells audio containers apart from their first bytes', () => {
    expect(sniffAudio(bytes('ID3', [4, 0]))).toBe('audio/mpeg');
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90]))).toBe('audio/mpeg');
    expect(sniffAudio(bytes([0xff, 0xf1, 0x50]))).toBe('audio/aac');
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toBe('audio/wav');
    expect(sniffAudio(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffAudio(bytes('fLaC'))).toBe('audio/flac');
    expect(sniffAudio(bytes([0, 0, 0, 32], 'ftypM4A '))).toBe('audio/mp4');
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffAudio(bytes('FORM', [0, 0, 0, 0], 'AIFF'))).toBe('audio/aiff');
    expect(sniffAudio(bytes('#EXTM3U\n'))).toBeNull();
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBeNull();
  });

  it('opens audio with the audio demuxers only, never playlists', () => {
    const list = safeInput('audio/ogg');
    expect(list[list.indexOf('-format_whitelist') + 1]).toContain('ogg');
    expect(list.join(' ')).not.toMatch(/hls|concat|m3u/);
    expect(safeInput('audio/mp4')).toContain('-enable_drefs');
  });

  it('copies only what not every browser plays', () => {
    const plan = (container: string, codec: string) =>
      proxyPlan(container, sound(codec), 1000, DEFAULT_PROXY_SETTINGS);
    expect(plan('audio/mpeg', 'mp3')).toBe('none');
    expect(plan('audio/mp4', 'aac')).toBe('none');
    expect(plan('audio/wav', 'pcm_s16le')).toBe('none');
    expect(plan('audio/flac', 'flac')).toBe('none');
    expect(plan('audio/ogg', 'opus')).toBe('make');
    expect(plan('audio/webm', 'opus')).toBe('make');
    expect(plan('audio/mp4', 'alac')).toBe('make');
    expect(plan('audio/aiff', 'pcm_s16be')).toBe('make');
    expect(
      proxyPlan('audio/ogg', sound('opus'), 1000, { ...DEFAULT_PROXY_SETTINGS, enabled: false }),
    ).toBe('skip');
    expect(
      proxyPlan(
        'audio/ogg',
        info({ videoCodec: null, audioCodec: null }),
        1,
        DEFAULT_PROXY_SETTINGS,
      ),
    ).toBe('none');
  });

  it('encodes the sound alone to AAC, with the same caps as a video', () => {
    const args = proxyArgs(
      '/in',
      '/out.mp4',
      sound('opus'),
      DEFAULT_PROXY_SETTINGS,
      1e6,
      undefined,
      'audio/ogg',
    );
    const line = args.join(' ');
    expect(line).toContain('-map 0:a:0 -vn');
    expect(line).toContain('-c:a aac');
    expect(line).not.toContain('-c:v');
    expect(line).toContain('-t 7200');
    // Sized for sound, not for a 5 Mbit/s picture.
    expect(proxyMaxBytes(sound('opus'), DEFAULT_PROXY_SETTINGS, 1e6)).toBeLessThan(
      proxyMaxBytes(info({ videoCodec: 'prores' }), DEFAULT_PROXY_SETTINGS, 1e6),
    );
  });
});

it.each(['ac3', 'eac3', 'dts', 'flac', 'opus', 'aac'])(
  'remuxes H.264 MKV and preserves %s audio as AAC',
  (audioCodec) => {
    const source = info({ width: 1280, height: 720, audioCodec });
    expect(webPlayable('video/webm', source)).toBe(false);
    expect(copiesVideo(source, DEFAULT_PROXY_SETTINGS, 5e6)).toBe(true);
    const args = proxyArgs('/in.mkv', '/out.mp4', source, DEFAULT_PROXY_SETTINGS, 5e6);
    expect(args.join(' ')).toContain('-map 0:V:0 -map 0:a:0?');
    expect(args.join(' ')).toContain('-c:v copy');
    expect(args.join(' ')).toContain(audioCodec === 'aac' ? '-c:a copy' : '-c:a aac');
  },
);

describe('copiesVideo (decision 0128)', () => {
  it('re-encodes H.264 that is too heavy or too fast to stream as it is', () => {
    const phone = info({ width: 1920, height: 1080, frameRate: 30 });
    // 10 s: 10 MB is 8 Mbit/s, under the 15 Mbit/s peak of High at 1080p.
    expect(copiesVideo(phone, DEFAULT_PROXY_SETTINGS, 10e6)).toBe(true);
    // A 100 Mbit/s camera file, slow motion at 120 fps, a source without a duration.
    expect(copiesVideo(phone, DEFAULT_PROXY_SETTINGS, 125e6)).toBe(false);
    expect(copiesVideo({ ...phone, frameRate: 120 }, DEFAULT_PROXY_SETTINGS, 5e6)).toBe(false);
    expect(copiesVideo({ ...phone, durationMs: null }, DEFAULT_PROXY_SETTINGS, 5e6)).toBe(false);
  });
});

describe('posterFilter', () => {
  it('tone maps an HDR frame to SDR, as the copies, and leaves SDR as it is', () => {
    expect(posterFilter(false)).toBe("scale='min(2048,iw)':-2");
    expect(posterFilter(true)).toBe(`scale='min(2048,iw)':-2,format=yuv420p10le,${TONEMAP}`);
  });
});
