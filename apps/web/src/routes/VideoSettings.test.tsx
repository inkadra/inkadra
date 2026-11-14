// @vitest-environment happy-dom
import { DEFAULT_VIDEO_SETTINGS, type VideoRung, type VideoSettingsView } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { copiesMbPerMinute, libraryMb, rungProblems, VideoSettings } from './VideoSettings.tsx';

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
    { side: '480', minutes: 0, fastMinutes: 0, noLiveMinutes: 0, noLiveFastMinutes: 0, videos: 0 },
    { side: '720', minutes: 0, fastMinutes: 0, noLiveMinutes: 0, noLiveFastMinutes: 0, videos: 0 },
    { side: '1080', minutes: 60, fastMinutes: 0, noLiveMinutes: 0, noLiveFastMinutes: 0, videos: 3 },
    { side: '2160', minutes: 60, fastMinutes: 0, noLiveMinutes: 0, noLiveFastMinutes: 0, videos: 2 },
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

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);

const software = (patch: Partial<VideoSettingsView> = {}) =>
  view({
    encoder: {
      label: 'Software (libx264)',
      backend: 'software',
      tuning: 'full',
      av1: false,
      requested: 'auto',
      concurrency: 1,
    },
    settings: { ...DEFAULT_VIDEO_SETTINGS, live: { enabled: false, maxSessions: 0, perViewer: 1 } },
    qualityParam: 'crf',
    liveStatus: {
      available: false,
      reason: 'no-gpu',
      sessions: 0,
      measured: null,
      speed: null,
      measuredAt: null,
      locked: false,
    },
    ...patch,
  });

it('shows live playback as unavailable with the software encoder: switch off and disabled', async () => {
  await show(software());
  expect(host.textContent).toContain('videoSettings.live.unavailable');
  expect(host.textContent).toContain('videoSettings.live.reasons.no-gpu');
  const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]');
  expect(toggle?.checked).toBe(false);
  expect(toggle?.disabled).toBe(true);
  // Avanzate: no test and no sessions without a GPU, the table labelled CRF.
  expect(host.textContent).toContain('videoSettings.advanced.noGpu');
  expect(button('videoSettings.advanced.rerun')?.disabled).toBe(true);
  expect(host.querySelector('#video-sessions')).toBeNull();
  expect(host.querySelector('.video-rtable thead')?.textContent).toContain('CRF');
});

it('says live is off when the sessions are 0, and offers each chosen resolution live when on', async () => {
  await show(
    view({
      settings: {
        ...DEFAULT_VIDEO_SETTINGS,
        live: { enabled: true, maxSessions: 0, perViewer: 1 },
      },
    }),
  );
  expect(host.textContent).toContain('videoSettings.live.zero');
  expect(host.textContent).toContain('videoSettings.live.off');
  await act(async () => root.unmount());
  root = createRoot(host);
  await show(view());
  expect(host.textContent).toContain('videoSettings.live.on');
  expect(host.textContent).toContain('videoSettings.live.upTo:{"count":3}');
  // 480, 720 and 1080 are chosen by default: one Su disco | Solo al volo each.
  expect(host.querySelectorAll('input[name^="video-rung-mode-"][value="live"]')).toHaveLength(3);
  vi.mocked(api.patch).mockResolvedValue(view());
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('input[name="video-rung-mode-1080"][value="live"]')
      ?.click(),
  );
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', {
    rungs: { ...DEFAULT_VIDEO_SETTINGS.rungs, '1080': 'live' },
  });
});

it('counts a live-only resolution for the videos this server cannot encode live', () => {
  const library = [
    { side: '1080' as const, minutes: 60, fastMinutes: 0, noLiveMinutes: 30, noLiveFastMinutes: 0, videos: 2 },
  ];
  const data = view({ library });
  const per = (rungs: VideoRung[]) => copiesMbPerMinute('balanced', rungs, 1080);
  // Half the hour is stored whatever the setting says: 1080 stays live-only for the rest.
  expect(libraryMb(data, 'balanced', ['480', '720'], undefined, ['1080'])).toBeCloseTo(
    30 * per(['480', '720']) + 30 * per(['480', '720', '1080']),
  );
});

it('tags a live-only resolution and counts it in the space estimates of a source that needs it', async () => {
  const rungs = { ...DEFAULT_VIDEO_SETTINGS.rungs, '1080': 'live' as const };
  await show(view({ settings: { ...DEFAULT_VIDEO_SETTINGS, rungs } }));
  expect(host.textContent).toContain('videoSettings.live.onlyLive');
  const minute = host.querySelector('.video-totals dd')?.textContent ?? '';
  expect(minute).toContain(
    String(Math.round(copiesMbPerMinute('balanced', ['480', '720', '1080']))),
  );
  expect(host.textContent).toContain('videoSettings.totals.liveNote');
});

it('keeps Avanzate collapsed, and lets the admin raise live sessions over the measurement', async () => {
  await show(view());
  const fold = host.querySelector<HTMLDetailsElement>('[data-tour="video-advanced"] details');
  expect(fold?.open).toBe(false);
  expect(host.textContent).toContain('videoSettings.advanced.measuredAtStart:{"count":3}');
  const field = host.querySelector<HTMLInputElement>('#video-sessions');
  vi.mocked(api.patch).mockResolvedValue(
    view({
      settings: {
        ...DEFAULT_VIDEO_SETTINGS,
        live: { enabled: true, maxSessions: 6, perViewer: 1 },
      },
    }),
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '6');
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => field?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', { live: { maxSessions: 6 } });
  expect(host.textContent).toContain('videoSettings.advanced.overMeasured');
  expect(host.textContent).toContain('videoSettings.advanced.customised');
  vi.mocked(api.patch).mockResolvedValue(view());
  await act(async () => button('videoSettings.advanced.reset')?.click());
  expect(api.patch).toHaveBeenLastCalledWith('/instance/video-settings', {
    live: { maxSessions: null },
  });
});

async function type(input: HTMLInputElement | null | undefined, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

it('saves a custom rung value in kbit/s, marks it personalizzato and resets it', async () => {
  await show(view());
  const target = host.querySelector<HTMLInputElement>('.video-rtable tbody input');
  expect(target?.value).toBe('1200');
  const custom = view({
    settings: { ...DEFAULT_VIDEO_SETTINGS, custom: { '480': { target: 1_500_000 } } },
  });
  vi.mocked(api.patch).mockResolvedValue(custom);
  await type(target, '1500');
  expect(api.patch).toHaveBeenCalledWith('/instance/video-settings', {
    custom: { '480': { target: 1_500_000 } },
  });
  expect(host.textContent).toContain('videoSettings.advanced.custom');
  // Under the presets: Personalizzata, and a way back to the preset values.
  expect(host.textContent).toContain('videoSettings.advanced.customNote');
  vi.mocked(api.patch).mockResolvedValue(view());
  await act(async () => button('videoSettings.advanced.reset')?.click());
  expect(api.patch).toHaveBeenLastCalledWith('/instance/video-settings', {
    custom: { '480': null },
  });
  vi.mocked(api.patch).mockResolvedValue(custom);
  await act(async () => root.unmount());
  root = createRoot(host);
  await show(custom);
  await act(async () => button('videoSettings.advanced.resetAll')?.click());
  expect(api.patch).toHaveBeenLastCalledWith('/instance/video-settings', {
    custom: { '480': null, '720': null, '1080': null, '2160': null },
  });
});

it('shows inline errors and saves nothing out of range', async () => {
  await show(view());
  const [target, peak, quality] = [
    ...host.querySelectorAll<HTMLInputElement>('.video-rtable tbody tr:first-child input'),
  ];
  await type(target, '100');
  expect(host.textContent).toContain('videoSettings.advanced.errors.range');
  expect(target?.getAttribute('aria-invalid')).toBe('true');
  await type(target, '2000');
  await type(peak, '1900');
  expect(host.textContent).toContain('videoSettings.advanced.errors.belowTarget');
  await type(quality, '60');
  expect(host.textContent).toContain('videoSettings.advanced.errors.quality');
  expect(api.patch).not.toHaveBeenCalled();
  expect(rungProblems(1200, 1800, 24)).toEqual({});
});

it('marks the resolutions that are not chosen', async () => {
  await show(view());
  expect(host.querySelectorAll('.video-rtable tr.is-off')).toHaveLength(1);
  expect(host.textContent).toContain('videoSettings.advanced.notChosen');
});

it('runs the performance test again, shows its progress, then the new measurement', async () => {
  await show(view());
  vi.mocked(api.post).mockResolvedValue(
    view({ benchmark: { running: true, startedAt: new Date().toISOString() } }),
  );
  await act(async () => button('videoSettings.advanced.rerun')?.click());
  expect(api.post).toHaveBeenCalledWith('/instance/video-settings/benchmark', {});
  expect(host.textContent).toContain('videoSettings.advanced.benchmarkRunning');
  expect(button('videoSettings.advanced.benchmarkBusy')?.disabled).toBe(true);
  expect(host.querySelector('.video-bench [role="progressbar"]')).not.toBeNull();
});
