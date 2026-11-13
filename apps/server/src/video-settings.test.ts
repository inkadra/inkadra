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
    // Without a GPU found, no live playback (decision of 13 Nov).
    const plain = await readVideoSettings(db(null), env);
    expect(plain.settings).toEqual({
      ...DEFAULT_VIDEO_SETTINGS,
      live: { ...DEFAULT_VIDEO_SETTINGS.live, enabled: false, maxSessions: 1 },
    });
    expect(plain.live).toMatchObject({ available: false, reason: 'no-gpu', sessions: 0 });
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

describe('live playback limits (decision 0128)', () => {
  // The fake database answers every key with this row: the encoder fields and the settings.
  const gpu = { label: 'Intel Quick Sync', backend: 'qsv', liveSessions: 3, liveSpeed: 5.35 };

  it('uses the sessions measured at start, and lets the admin only lower them', async () => {
    const measured = await readVideoSettings(db(gpu), env);
    expect(measured.live).toMatchObject({
      available: true,
      sessions: 3,
      speed: 5.35,
      reason: null,
    });
    expect(measured.settings.live).toMatchObject({ enabled: true, maxSessions: 3 });
    const lower = await readVideoSettings(db({ ...gpu, live: { maxSessions: 2 } }), env);
    expect(lower.settings.live.maxSessions).toBe(2);
    // An older, higher choice is clamped to what was measured.
    const higher = await readVideoSettings(db({ ...gpu, live: { maxSessions: 6 } }), env);
    expect(higher.settings.live.maxSessions).toBe(3);
  });

  it('turns live off when the GPU was too slow, and lets the environment set the cap', async () => {
    const slow = await readVideoSettings(db({ ...gpu, liveSessions: 0, liveSpeed: 1.2 }), env);
    expect(slow.live).toMatchObject({ available: false, reason: 'too-slow' });
    expect(slow.settings.live.enabled).toBe(false);
    const failed = await readVideoSettings(db({ ...gpu, liveSessions: 0, liveSpeed: null }), env);
    expect(failed.live.reason).toBe('failed');
    const set = await readVideoSettings(db(gpu), { ...env, VIDEO_LIVE_MAX_SESSIONS: 5 });
    expect(set.live).toMatchObject({ sessions: 5, locked: true });
    const zero = await readVideoSettings(db(gpu), { ...env, VIDEO_LIVE_MAX_SESSIONS: 0 });
    expect(zero.live).toMatchObject({ available: false, reason: 'set-off' });
  });

  it('keeps live-only resolutions on disk when live playback cannot run', async () => {
    const read = await readVideoSettings(db({ rungs: { '2160': 'live' } }), env);
    expect(read.settings.rungs['2160']).toBe('stored');
  });
});
