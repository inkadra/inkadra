import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROXY_SETTINGS } from './media/video.ts';
import {
  applyVideoSettings,
  envRungs,
  invalidVideoSettings,
  readVideoSettings,
} from './video-settings.ts';

/** A database whose instance_setting row holds `value`. */
const db = (value: unknown) =>
  ({
    select: () => ({ from: () => ({ where: async () => (value ? [{ value }] : []) }) }),
  }) as unknown as Parameters<typeof readVideoSettings>[0];
const env = { VIDEO_PROXIES: true } as const;

describe('video settings', () => {
  it('reads the defaults, then the stored choices', async () => {
    // Without a GPU found, one live session at a time (three with one, from the spike).
    expect((await readVideoSettings(db(null), env)).settings).toEqual({
      ...DEFAULT_VIDEO_SETTINGS,
      live: { ...DEFAULT_VIDEO_SETTINGS.live, maxSessions: 1 },
    });
    const stored = await readVideoSettings(
      db({ quality: 'high', rungs: { '2160': 'stored' } }),
      env,
    );
    expect(stored.settings.quality).toBe('high');
    expect(stored.settings.rungs).toEqual({
      '480': 'stored',
      '720': 'stored',
      '1080': 'stored',
      '2160': 'stored',
    });
    expect(stored.locked).toEqual({ quality: false, rungs: false, live: false });
  });

  it('lets the environment win and lock the control', async () => {
    const read = await readVideoSettings(db({ quality: 'high' }), {
      ...env,
      VIDEO_QUALITY: 'light',
      VIDEO_RENDITIONS: ['720', '1080'],
      VIDEO_LIVE: false,
    });
    expect(read.settings.quality).toBe('light');
    expect(read.settings.rungs).toEqual(envRungs(['720', '1080']));
    expect(read.settings.live.enabled).toBe(false);
    expect(read.locked).toEqual({ quality: true, rungs: true, live: true });
  });

  it('keeps one resolution and needs live playback for live-only ones', () => {
    const base = DEFAULT_VIDEO_SETTINGS;
    const off = { '480': 'off', '720': 'off', '1080': 'off', '2160': 'off' } as const;
    expect(invalidVideoSettings(base)).toBeNull();
    expect(invalidVideoSettings({ ...base, rungs: off })).toMatch(/at least one/);
    const liveOnly: VideoSettings = { ...base, rungs: { ...off, '2160': 'live', '480': 'stored' } };
    expect(invalidVideoSettings(liveOnly)).toBeNull();
    expect(invalidVideoSettings({ ...liveOnly, live: { ...base.live, enabled: false } })).toMatch(
      /live playback/,
    );
  });

  it('gives the worker the stored rungs and the preset', () => {
    const settings: VideoSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      quality: 'light',
      rungs: { '480': 'live', '720': 'stored', '1080': 'stored', '2160': 'off' },
    };
    expect(applyVideoSettings(DEFAULT_PROXY_SETTINGS, settings)).toMatchObject({
      quality: 'light',
      rungs: ['720', '1080'],
      playable: 'heavy',
    });
  });
});
