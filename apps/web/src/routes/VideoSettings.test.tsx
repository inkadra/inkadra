// @vitest-environment happy-dom
import { DEFAULT_VIDEO_SETTINGS, type VideoSettingsView } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { chooseSelect } from '../test/select.ts';
import { copiesMbPerMinute, libraryMb, VideoSettings } from './VideoSettings.tsx';

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});

const rungValues = (quality: number) => ({
  '480': { target: 1_200_000, peak: 1_800_000, quality },
  '720': { target: 2_500_000, peak: 3_750_000, quality },
  '1080': { target: 4_500_000, peak: 6_750_000, quality },
  '2160': { target: 14_000_000, peak: 21_000_000, quality },
});

const view = (patch: Partial<VideoSettingsView> = {}): VideoSettingsView => ({
  settings: DEFAULT_VIDEO_SETTINGS,
  locked: { quality: false, rungs: false, live: false },
  enabled: true,
  encoder: {
    label: 'Intel Quick Sync (Intel, /dev/dri/renderD128, low power)',
    backend: 'qsv',
    tuning: 'full',
    av1: false,
    requested: 'auto',
    concurrency: 2,
  },
  queue: { queued: 0, processing: 0 },
  library: [
    { side: '480', minutes: 0, fastMinutes: 0, videos: 0 },
    { side: '720', minutes: 0, fastMinutes: 0, videos: 0 },
    { side: '1080', minutes: 60, fastMinutes: 0, videos: 3 },
    { side: '2160', minutes: 60, fastMinutes: 0, videos: 2 },
  ],
  copiesBytes: 0,
  freeBytes: null,
  outdated: 0,
  speed: null,
  backfill: null,
  liveStatus: {
    available: true,
    reason: null,
    sessions: 3,
    measured: 3,
    speed: 5.35,
    measuredAt: '2026-11-13T12:00:00.000Z',
    locked: false,
  },
  benchmark: { running: false, startedAt: null },
  qualityParam: 'global_quality',
  presetValues: {
    light: rungValues(24),
    balanced: rungValues(28),
    high: rungValues(21),
  },
  ...patch,
});

async function show(data: VideoSettingsView) {
  vi.mocked(api.get).mockResolvedValue(data);
  await act(async () => root.render(<VideoSettings />));
}

it('estimates the copies as the mockup does: 81 MB a minute for the default ladder', () => {
  expect(Math.round(copiesMbPerMinute('balanced', ['480', '720', '1080']))).toBe(81);
  expect(Math.round(copiesMbPerMinute('light', ['480', '720', '1080']))).toBe(49);
  // Never upscaled: a 720p source gets 480 and 720 only.
  expect(Math.round(copiesMbPerMinute('balanced', ['480', '720', '1080'], 720))).toBe(35);
  // An hour of 1080p and an hour of 4K, all three rungs each.
  expect(Math.round(libraryMb(view(), 'balanced', ['480', '720', '1080']))).toBe(
    Math.round(2 * 60 * copiesMbPerMinute('balanced', ['480', '720', '1080'])),
  );
});

it('shows the encoder, the presets and saves a new preset', async () => {
  await show(view());
  expect(host.textContent).toContain('Intel Quick Sync');
  expect(host.textContent).toContain('videoSettings.encoder.hardware');
  const high = host.querySelector<HTMLInputElement>('input[name="video-quality"][value="high"]');
  vi.mocked(api.patch).mockResolvedValue(view());
  await act(async () => high?.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', { quality: 'high' });
});

it('keeps at least one resolution', async () => {
  const one = view({
    settings: {
      ...DEFAULT_VIDEO_SETTINGS,
      rungs: { '480': 'off', '720': 'stored', '1080': 'off', '2160': 'off' },
    },
  });
  await show(one);
  const boxes = [
    ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([role="switch"])'),
  ];
  expect(boxes.map((b) => b.checked)).toEqual([false, true, false, false]);
  await act(async () => boxes[1]?.click());
  expect(api.patch).not.toHaveBeenCalled();
  vi.mocked(api.patch).mockResolvedValue(one);
  await act(async () => boxes[3]?.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', {
    rungs: { '480': 'off', '720': 'stored', '1080': 'off', '2160': 'stored' },
  });
});

it('locks what the environment sets, and says when copies are off', async () => {
  await show(view({ locked: { quality: true, rungs: true, live: false } }));
  expect(host.textContent).toContain('VIDEO_QUALITY');
  expect(host.textContent).toContain('VIDEO_RENDITIONS');
  expect(host.querySelector<HTMLInputElement>('input[name="video-quality"]')?.disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await show(view({ enabled: false, encoder: null }));
  expect(host.textContent).toContain('videoSettings.encoder.off');
});

it('regenerates existing videos after asking, then shows the progress and stops', async () => {
  await show(view({ outdated: 3, copiesBytes: 2e9, freeBytes: 400e9 }));
  expect(host.textContent).toContain('videoSettings.existing.outdated:{"count":3}');
  const open = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.existing.regenerate',
  );
  await act(async () => open?.click());
  const start = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.existing.start',
  );
  const running = view({
    outdated: 3,
    queue: { queued: 0, processing: 1 },
    backfill: {
      scope: 'outdated',
      status: 'running',
      total: 3,
      done: 1,
      startedAt: '2026-11-13T12:00:00.000Z',
    },
  });
  vi.mocked(api.post).mockResolvedValue(running);
  await act(async () => start?.click());
  expect(api.post).toHaveBeenCalledWith('/instance/video-settings/reprocess', {
    scope: 'outdated',
  });
  expect(host.textContent).toContain('videoSettings.existing.progress:{"done":"1","total":"3"}');
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
  vi.mocked(api.delete).mockResolvedValue(view({ outdated: 2 }));
  const stop = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.existing.stop',
  );
  await act(async () => stop?.click());
  expect(api.delete).toHaveBeenCalledWith('/instance/video-settings/reprocess');
});

it('refuses to regenerate when the copies would not fit', async () => {
  await show(view({ outdated: 3, freeBytes: 1e6 }));
  const open = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.existing.regenerate',
  );
  expect(open?.disabled).toBe(true);
  expect(host.textContent).toContain('videoSettings.existing.noRoom');
});

it('turns live playback off, keeping the live-only resolutions on disk', async () => {
  const live = view({
    settings: {
      ...DEFAULT_VIDEO_SETTINGS,
      rungs: { '480': 'stored', '720': 'stored', '1080': 'stored', '2160': 'live' },
      live: { enabled: true, maxSessions: 3, perViewer: 1 },
    },
  });
  await show(live);
  expect(host.textContent).toContain('videoSettings.live.noSpace');
  const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]');
  vi.mocked(api.patch).mockResolvedValue(view());
  await act(async () => toggle?.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', {
    live: { enabled: false },
    rungs: { '480': 'stored', '720': 'stored', '1080': 'stored', '2160': 'stored' },
  });
});

it('shows live playback as unavailable without a GPU, with the reason and no switch', async () => {
  await show(
    view({
      settings: {
        ...DEFAULT_VIDEO_SETTINGS,
        live: { enabled: false, maxSessions: 1, perViewer: 1 },
      },
      liveStatus: {
        available: false,
        reason: 'no-gpu',
        sessions: 0,
        speed: null,
        measuredAt: null,
        locked: false,
      },
    }),
  );
  expect(host.textContent).toContain('videoSettings.live.reasons.no-gpu');
  expect(host.querySelector('input[role="switch"]')).toBeNull();
});

async function openAdvanced() {
  const toggle = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.advanced.show',
  );
  await act(async () => toggle?.click());
}

it('keeps Advanced collapsed, then lets the admin raise live sessions over the measurement', async () => {
  await show(view());
  expect(host.textContent).toContain('videoSettings.advanced.collapsed');
  expect(host.textContent).not.toContain('videoSettings.advanced.rerun');
  await openAdvanced();
  expect(host.textContent).toContain('videoSettings.advanced.measuredAt');
  vi.mocked(api.patch).mockResolvedValue(
    view({
      settings: {
        ...DEFAULT_VIDEO_SETTINGS,
        live: { enabled: true, maxSessions: 6, perViewer: 1 },
      },
    }),
  );
  chooseSelect(host.querySelector('[data-tour="video-advanced"] [role="combobox"]'), '6');
  await act(async () => {});
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', { live: { maxSessions: 6 } });
  expect(host.textContent).toContain('videoSettings.advanced.overMeasured:{"measured":3}');
  // Ripristina goes back to the measured value.
  vi.mocked(api.patch).mockResolvedValue(view());
  const reset = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.advanced.reset',
  );
  await act(async () => reset?.click());
  expect(api.patch).toHaveBeenLastCalledWith('/instance/video-settings', {
    live: { maxSessions: null },
  });
});

it('marks a custom rung value as personalizzato, with Ripristina and a Personalizzata preset', async () => {
  await show(view());
  await openAdvanced();
  expect(host.textContent).toContain('global_quality');
  const target = host.querySelector<HTMLInputElement>('input[type="number"]');
  expect(target?.value).toBe('1.2');
  const custom = view({
    settings: { ...DEFAULT_VIDEO_SETTINGS, custom: { '480': { target: 1_500_000 } } },
  });
  vi.mocked(api.patch).mockResolvedValue(custom);
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(target, '1.5');
    target?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => target?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', {
    custom: { '480': { target: 1_500_000 } },
  });
  expect(host.textContent).toContain('videoSettings.advanced.custom');
  expect(host.textContent).toContain('videoSettings.advanced.customPreset');
  vi.mocked(api.patch).mockResolvedValue(view());
  const reset = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.advanced.reset',
  );
  await act(async () => reset?.click());
  expect(api.patch).toHaveBeenLastCalledWith('/instance/video-settings', {
    custom: { '480': null },
  });
});

it('runs the performance test again from Advanced', async () => {
  await show(view());
  await openAdvanced();
  vi.mocked(api.post).mockResolvedValue(
    view({ benchmark: { running: true, startedAt: '2026-11-13T12:05:00.000Z' } }),
  );
  const rerun = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'videoSettings.advanced.rerun',
  );
  await act(async () => rerun?.click());
  expect(api.post).toHaveBeenCalledWith('/instance/video-settings/benchmark', {});
  expect(host.textContent).toContain('videoSettings.advanced.benchmarkRunning');
  expect(host.querySelector('.video-meter.is-indeterminate')).not.toBeNull();
});
