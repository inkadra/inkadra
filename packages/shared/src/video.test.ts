import { describe, expect, it } from 'vitest';
import {
  AssetPlayback,
  DEFAULT_VIDEO_SETTINGS,
  ladderFor,
  rungMbPerMinute,
  UpdateVideoSettings,
  VIDEO_LIVE_CAPABILITY,
  VIDEO_RENDITIONS_CAPABILITY,
  VideoSettings,
} from './video.ts';

describe('ladderFor', () => {
  const chosen = ['480', '720', '1080'] as const;

  it('never upscales: the top rung stands for the size of the source', () => {
    expect(ladderFor(chosen, 2160)).toEqual(['480', '720', '1080']);
    expect(ladderFor(chosen, 1080)).toEqual(['480', '720', '1080']);
    // 900p: 480, 720 and the 1080 rung made at 900.
    expect(ladderFor(chosen, 900)).toEqual(['480', '720', '1080']);
    expect(ladderFor(chosen, 720)).toEqual(['480', '720']);
    expect(ladderFor(chosen, 360)).toEqual(['480']);
  });

  it('drops rungs within 80 % of the top one', () => {
    // 540p gets 540 only, not 480 and 540.
    expect(ladderFor(chosen, 540)).toEqual(['720']);
    expect(ladderFor(['720', '1080', '480'], 1000)).toEqual(['480', '720', '1080']);
    expect(ladderFor([], 1080)).toEqual([]);
    expect(ladderFor(chosen, 0)).toEqual([]);
  });

  it('keeps 2160 for 4K sources only', () => {
    const all = ['480', '720', '1080', '2160'] as const;
    expect(ladderFor(all, 2160)).toEqual(['480', '720', '1080', '2160']);
    expect(ladderFor(all, 1080)).toEqual(['480', '720', '1080']);
  });
});

describe('video settings', () => {
  it('estimates megabytes a minute as the Video page shows them', () => {
    expect(rungMbPerMinute('balanced', '1080')).toBeCloseTo(45.96, 2);
    expect(rungMbPerMinute('light', '480')).toBeCloseTo(7.71, 2);
  });

  it('defaults to Bilanciata, 480 + 720 + 1080 stored, 2160 off', () => {
    expect(VideoSettings.parse(DEFAULT_VIDEO_SETTINGS)).toEqual(DEFAULT_VIDEO_SETTINGS);
    expect(UpdateVideoSettings.safeParse({ quality: 'ultra' }).success).toBe(false);
    expect(UpdateVideoSettings.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('names its capabilities', () => {
    expect(VIDEO_RENDITIONS_CAPABILITY).toBe('video-renditions');
    expect(VIDEO_LIVE_CAPABILITY).toBe('video-live');
  });

  it('reads a playback without the live flags of older servers', () => {
    const playback = {
      hls: '/api/v1/assets/a/hls/master.m3u8?v=abc',
      original: false,
      renditions: [
        {
          name: '480',
          status: 'ready',
          progress: 100,
          width: 854,
          height: 480,
          bitrate: 1_200_000,
          size: 1000,
          url: '/api/v1/assets/a/hls/480.mp4?v=abc',
        },
      ],
    };
    expect(AssetPlayback.parse(playback)).toEqual(playback);
  });
});
