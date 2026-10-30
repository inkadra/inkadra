// @vitest-environment happy-dom
import type { InstanceBackups } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../lib/api.ts';
import { chooseSelect } from '../test/select.ts';
import { BackupSettings } from './BackupSettings.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
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
  expect(host.querySelector<HTMLInputElement>('input[type=time]')?.value).toBe('03:00');
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
