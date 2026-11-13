// @vitest-environment happy-dom
import { DEFAULT_VIDEO_SETTINGS, type VideoSettingsView } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
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
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
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
  const start = [...document.querySelectorAll('button')].find(
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
