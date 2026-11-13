import { DEFAULT_VIDEO_SETTINGS, UpdateVideoSettings, type VideoSettings } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROXY_SETTINGS } from './media/video.ts';
import {
  applyVideoSettings,
  envRungs,
  invalidCustom,
  invalidVideoSettings,
  readBenchmark,
  readVideoSettings,
  runBenchmark,
  startBenchmark,
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
      live: { ...DEFAULT_VIDEO_SETTINGS.live, enabled: false, maxSessions: 0 },
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

  it('uses the sessions measured at start; the admin may lower or raise them (Advanced)', async () => {
    const measured = await readVideoSettings(db(gpu), env);
    expect(measured.live).toMatchObject({ available: true, sessions: 3, measured: 3, speed: 5.35 });
    expect(measured.settings.live).toMatchObject({ enabled: true, maxSessions: 3 });
    expect(
      (await readVideoSettings(db({ ...gpu, live: { maxSessions: 2 } }), env)).settings.live
        .maxSessions,
    ).toBe(2);
    // More than measured is allowed: the page warns.
    const higher = await readVideoSettings(db({ ...gpu, live: { maxSessions: 6 } }), env);
    expect(higher.live).toMatchObject({ sessions: 6, measured: 3, available: true });
    // 0 turns it off.
    const off = await readVideoSettings(db({ ...gpu, live: { maxSessions: 0 } }), env);
    expect(off.live).toMatchObject({ available: false, reason: 'set-off' });
    // The environment wins over both.
    const env5 = await readVideoSettings(db({ ...gpu, live: { maxSessions: 6 } }), {
      ...env,
      VIDEO_LIVE_MAX_SESSIONS: 5,
    });
    expect(env5.live).toMatchObject({ sessions: 5, locked: true });
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

describe('custom values of the rungs (Advanced)', () => {
  it('needs the peak at least the target, with the preset filling what is not given', () => {
    expect(
      invalidCustom('balanced', { '1080': { target: 8_000_000, peak: 12_000_000 } }),
    ).toBeNull();
    expect(invalidCustom('balanced', { '1080': { target: 8_000_000, peak: 6_000_000 } })).toMatch(
      /1080p .* must be at least its target/,
    );
    // Balanced 1080p peaks at 9 Mbit/s: a target of 10 without a peak is refused.
    expect(invalidCustom('balanced', { '1080': { target: 10_000_000 } })).toMatch(/at least/);
    expect(invalidCustom('balanced', { '480': { quality: 18 } })).toBeNull();
  });

  it('checks the bounds at the boundary: 200k to 80M, quality 0 to 51', () => {
    const ok = UpdateVideoSettings.safeParse({
      custom: { '720': { target: 200_000, quality: 0 } },
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { target: 199_999 },
      { peak: 80_000_001 },
      { quality: 52 },
      { quality: -1 },
      { crf: 20 },
    ])
      expect(UpdateVideoSettings.safeParse({ custom: { '720': bad } }).success).toBe(false);
    expect(UpdateVideoSettings.safeParse({ live: { maxSessions: 17 } }).success).toBe(false);
    expect(UpdateVideoSettings.safeParse({ live: { maxSessions: null } }).success).toBe(true);
  });

  it('gives the worker the custom values', () => {
    const custom = { '720': { target: 4_000_000 } };
    expect(
      applyVideoSettings(DEFAULT_PROXY_SETTINGS, { ...DEFAULT_VIDEO_SETTINGS, custom }).custom,
    ).toEqual(custom);
  });
});

describe('performance test from the page', () => {
  /** A database of one table of settings, by key. */
  const memory = () => {
    const rows = new Map<string, unknown>();
    let key = '';
    const fake = {
      select: () => ({
        from: () => ({
          where: async () => (rows.has(key) ? [{ value: rows.get(key) }] : []),
        }),
      }),
      insert: () => ({
        values: (v: { key: string; value: unknown }) => ({
          onConflictDoUpdate: async () => void rows.set(v.key, v.value),
        }),
      }),
    };
    return { fake: fake as never, use: (k: string) => {
        key = k;
      },
    };
  };

  it('runs one at a time: a second request while one runs is refused with 409', async () => {
    const { fake, use } = memory();
    use('video-benchmark');
    let queued = 0;
    const jobs = {
      processAsset: async () => {},
      deleteFiles: async () => {},
      runVideoBenchmark: async () => void queued++,
    };
    await startBenchmark(fake, jobs);
    expect(queued).toBe(1);
    expect((await readBenchmark(fake)).running).toBe(true);
    await expect(startBenchmark(fake, jobs)).rejects.toMatchObject({ code: 'conflict' });
    // Done: another may start.
    await runBenchmark(fake, async () => {});
    expect((await readBenchmark(fake)).running).toBe(false);
    await startBenchmark(fake, jobs);
    expect(queued).toBe(2);
    // One left running by a worker that died is stale after ten minutes.
    expect((await readBenchmark(fake, Date.now() + 11 * 60_000)).running).toBe(false);
  });
});
