// @vitest-environment happy-dom
import type { InstanceBackups } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../lib/api.ts';
import { chooseSelect } from '../test/select.ts';
import { BackupSettings } from './BackupSettings.tsx';

// The key, and the values of texts with a count: the space estimate is checked by them.
const t = (key: string, values?: { count?: number }) =>
  values?.count === undefined ? key : `${key} ${JSON.stringify(values)}`;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});

const at = '2026-11-02T03:00:00.000Z';
const overview = (items: InstanceBackups['items']): InstanceBackups => ({
  settings: { enabled: true, time: '03:00', retention: 7 },
  timeZone: 'Europe/Rome',
  bucket: false,
  nextRunAt: at,
  items,
});
const backup = (patch: Partial<InstanceBackups['items'][number]>) => ({
  id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
  trigger: 'scheduled' as const,
  status: 'ready' as const,
  fileName: 'inkadra-backup-20261102-030000-0193f0a4.zip',
  size: 2048,
  copiedToBucket: false,
  files: { count: 12, bytes: 4096 },
  failure: null,
  startedAt: at,
  finishedAt: at,
  ...patch,
});

it('shows the last result, the schedule and the history', async () => {
  vi.mocked(api.get).mockResolvedValue(
    overview([
      backup({}),
      backup({ id: 'old', status: 'failed', fileName: null, size: null, failure: 'stalled' }),
    ]),
  );
  await act(async () => root.render(<BackupSettings />));
  expect(host.textContent).toContain('backups.status.ready');
  expect(host.textContent).toContain('backups.status.failed');
  // The reason is said, never an endless "running".
  expect(host.textContent).toContain('backups.failure.stalled');
  expect(host.textContent).not.toContain('backups.notInBucket');
  expect(host.textContent).toContain('inkadra-backup-20261102-030000-0193f0a4.zip');
  const time = [
    ...host.querySelectorAll<HTMLInputElement>('.backup-settings__time .ink-time__seg'),
  ];
  expect(time.map((s) => s.value).join(':')).toBe('03:00');
  expect(host.querySelector<HTMLButtonElement>('.ink-select')?.dataset.value).toBe('7');
  // Backups are never offered as a download from the browser.
  expect(host.querySelector('a[download]')).toBeNull();
});

it('saves the time and retention as they change', async () => {
  vi.mocked(api.get).mockResolvedValue(overview([]));
  vi.mocked(api.patch).mockResolvedValue({});
  await act(async () => root.render(<BackupSettings />));
  expect(host.textContent).toContain('backups.none');
  const select = host.querySelector<HTMLButtonElement>('.ink-select') as HTMLButtonElement;
  await act(async () => {
    chooseSelect(select, '30');
  });
  expect(api.patch).toHaveBeenCalledWith('/instance/backups/settings', { retention: 30 });
});

it('backs up now and says so when one is already running', async () => {
  vi.mocked(api.get).mockResolvedValue(overview([]));
  vi.mocked(api.post).mockRejectedValue(new RequestError(409, 'conflict', 'running'));
  await act(async () => root.render(<BackupSettings />));
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'backups.now',
  ) as HTMLButtonElement;
  await act(async () => button.click());
  expect(api.post).toHaveBeenCalledWith('/instance/backups', {});
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('backups.busy');
});

it('offers files in the backups with their size, and saves the choice (#899)', async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...overview([backup({ size: 10_000, media: { count: 12, bytes: 4096 } })]),
    settings: { enabled: true, time: '03:00', retention: 7, includeMedia: false },
    directory: '/backups',
    remote: 's3://archives/backups/',
    mediaBytes: 5_000_000,
  });
  vi.mocked(api.patch).mockResolvedValue({});
  await act(async () => root.render(<BackupSettings />));
  expect(host.textContent).toContain('backups.mediaHelp');
  // Retention multiplies the space: 7 kept × (5904 bytes of tables in the last one + 5 MB of
  // files now), while the kept backup takes its 10 000 bytes today.
  expect(host.textContent).toContain(
    'backups.mediaKept {"count":7,"total":"35.04 MB","used":"10 KB"}',
  );
  expect(host.textContent).toContain('backups.withMedia');
  expect(host.textContent).toContain('backups.whereIn');
  const toggle = host.querySelector<HTMLInputElement>('[data-tour="backups-media"]');
  await act(async () => toggle?.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/backups/settings', { includeMedia: true });
});

it('hides the files choice from servers that do not know it', async () => {
  vi.mocked(api.get).mockResolvedValue(overview([]));
  await act(async () => root.render(<BackupSettings />));
  expect(host.querySelector('[data-tour="backups-media"]')).toBeNull();
  expect(host.textContent).toContain('backups.where');
});
