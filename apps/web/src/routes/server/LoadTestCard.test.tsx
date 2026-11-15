// @vitest-environment happy-dom
import type { LoadTestRun, LoadTests } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../../lib/api.ts';
import { LoadTestCard } from './LoadTestCard.tsx';

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));
vi.mock('../../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../../lib/api.ts')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
// The progress bar comes from SimpleView, whose session module starts the app's i18n.
vi.mock('../../lib/session.tsx', () => ({ useSession: () => ({}) }));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
  vi.useRealTimers();
});

const at = '2026-11-16T02:00:00.000Z';
const run = (patch: Partial<LoadTestRun>): LoadTestRun => ({
  id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
  preset: 'small',
  status: 'passed',
  reason: null,
  scheduledFor: null,
  startedAt: at,
  finishedAt: at,
  createdAt: at,
  progress: null,
  report: null,
  cleanedUp: true,
  ...patch,
});
const page = (items: LoadTestRun[], available = true, separateWorker = true): LoadTests => ({
  available,
  separateWorker,
  timeZone: 'Europe/Rome',
  presets: [
    { name: 'small', editors: 5, readers: 2, boards: 50, durationS: 60 },
    { name: 'medium', editors: 20, readers: 4, boards: 200, durationS: 180 },
    { name: 'large', editors: 50, readers: 10, boards: 1000, durationS: 300 },
  ],
  guard: { storeP95Ms: 2000, apiP95Ms: 2000, apiErrorRate: 0.05, editP95Ms: 3000 },
  items,
});
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const limits = {
  editP95Ms: 500,
  editP99Ms: 1500,
  deliveryP95Ms: 1000,
  storeP95Ms: 1000,
  poolWaitMaxMs: 1000,
  rssMiB: 1024,
  perBoardMiB: 8,
  errors: 0,
  reconnects: 5,
};

it('warns, and starts only once the administrator confirms', async () => {
  vi.mocked(api.get).mockResolvedValue(page([]));
  vi.mocked(api.post).mockResolvedValue(run({ status: 'scheduled' }));
  await act(async () => root.render(<LoadTestCard />));
  expect(host.textContent).toContain('server.loadTest.warningTitle');
  // The warning says how long and how many boards, for the preset chosen.
  expect(host.textContent).toContain('"boards":50');
  const start = button('server.loadTest.start');
  expect(start.disabled).toBe(true);
  const confirm = host.querySelector<HTMLInputElement>('.load-test__confirm input');
  await act(async () => confirm?.click());
  expect(start.disabled).toBe(false);
  await act(async () => start.click());
  expect(api.post).toHaveBeenCalledWith('/instance/load-tests', { preset: 'small' });
});

it('schedules at a date and time of the server time zone', async () => {
  vi.mocked(api.get).mockResolvedValue(page([]));
  vi.mocked(api.post).mockResolvedValue(run({ status: 'scheduled' }));
  await act(async () => root.render(<LoadTestCard />));
  const medium = host.querySelector<HTMLInputElement>('input[value="medium"]');
  const later = host.querySelector<HTMLInputElement>('input[value="later"]');
  await act(async () => medium?.click());
  await act(async () => later?.click());
  expect(host.textContent).toContain('"zone":"Europe/Rome"');
  await act(async () => host.querySelector<HTMLInputElement>('.load-test__confirm input')?.click());
  await act(async () => button('server.loadTest.schedule').click());
  const body = vi.mocked(api.post).mock.calls[0]?.[1] as { preset: string; at: object };
  expect(body.preset).toBe('medium');
  expect(body.at).toMatchObject({ time: '03:00' });
});

it('in all-in-one mode, says the test shares the server and keeps Large for a worker', async () => {
  vi.mocked(api.get).mockResolvedValue(page([], true, false));
  await act(async () => root.render(<LoadTestCard />));
  expect(host.textContent).toContain('server.loadTest.sharedProcess');
  const large = host.querySelector<HTMLInputElement>('input[value="large"]');
  expect(large?.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[value="medium"]')?.disabled).toBe(false);
  expect(host.textContent).toContain('server.loadTest.needsWorker');
});

it('offers Large and no note with a worker role of its own', async () => {
  vi.mocked(api.get).mockResolvedValue(page([]));
  await act(async () => root.render(<LoadTestCard />));
  expect(host.textContent).not.toContain('server.loadTest.sharedProcess');
  expect(host.querySelector<HTMLInputElement>('input[value="large"]')?.disabled).toBe(false);
});

it('says why a start is refused', async () => {
  vi.mocked(api.get).mockResolvedValue(page([]));
  vi.mocked(api.post).mockRejectedValue(
    new RequestError(409, 'conflict', 'busy', { reason: 'backup_running' }),
  );
  await act(async () => root.render(<LoadTestCard />));
  await act(async () => host.querySelector<HTMLInputElement>('.load-test__confirm input')?.click());
  await act(async () => button('server.loadTest.start').click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'server.loadTest.reasons.backup_running',
  );
});

it('shows a running test with its live numbers and stops it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const running = run({
    status: 'running',
    finishedAt: null,
    progress: {
      phase: 'running',
      seeded: 50,
      boards: 50,
      elapsedS: 30,
      durationS: 60,
      edits: 120,
      editP95Ms: 4,
      deliveryP95Ms: 6,
      errors: 0,
      reconnects: 0,
      storeP95Ms: 25,
      apiP95Ms: 80,
    },
  });
  vi.mocked(api.get).mockResolvedValue(page([running]));
  vi.mocked(api.post).mockResolvedValue(running);
  await act(async () => root.render(<LoadTestCard />));
  const bar = host.querySelector('[role="progressbar"]');
  expect(bar?.getAttribute('aria-valuenow')).toBe('55');
  expect(host.textContent).toContain('server.loadTest.live.storeP95');
  expect(host.querySelector('.load-test__confirm')).toBeNull();
  // Polled while it runs.
  await act(async () => vi.advanceTimersByTime(2100));
  expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1);
  await act(async () => button('server.loadTest.stop').click());
  expect(api.post).toHaveBeenCalledWith(`/instance/load-tests/${running.id}/stop`, {});
});

it('keeps the reports of the last runs, with the lines past their limit', async () => {
  vi.mocked(api.get).mockResolvedValue(
    page([
      run({
        status: 'aborted',
        reason: 'api_slow',
        report: {
          preset: 'small',
          durationS: 60,
          editors: 5,
          readers: 2,
          boards: 50,
          edits: 300,
          switches: 12,
          uploads: { ok: 6, failed: 0 },
          editMs: { p50: 1, p95: 900, p99: 1000, n: 280 },
          deliveryMs: { p50: 1, p95: 2, p99: 3, n: 100 },
          errors: 0,
          reconnects: 0,
          server: null,
          limits,
          failures: ['edit round trip p95 900 ms > 500 ms'],
          text: 'Inkadra load test · preset small',
        },
      }),
      run({ id: 'other', status: 'refused', reason: 'under_load' }),
    ]),
  );
  await act(async () => root.render(<LoadTestCard />));
  expect(host.textContent).toContain('server.loadTest.status.aborted');
  expect(host.textContent).toContain('server.loadTest.reasons.api_slow');
  expect(host.textContent).toContain('server.loadTest.status.refused');
  const over = [...host.querySelectorAll('.load-test__over th')].map((th) => th.textContent);
  expect(over).toEqual(['server.loadTest.report.rows.editMs']);
  expect(host.textContent).toContain('Inkadra load test · preset small');
});

const memoryReport = (perBoardInfo: string | null) => ({
  preset: 'small' as const,
  durationS: 60,
  editors: 5,
  readers: 2,
  boards: 50,
  edits: 300,
  switches: 12,
  uploads: { ok: 6, failed: 0 },
  editMs: { p50: 1, p95: 6, p99: 9, n: 280 },
  deliveryMs: { p50: 1, p95: 2, p99: 3, n: 100 },
  errors: 0,
  reconnects: 0,
  server: {
    baselineRssMiB: 184,
    peakRssMiB: 271,
    peakOpenBoards: 6,
    perBoardMiB: 14.5,
    perBoardInfo,
    docPerBoardKiB: 3000,
    storeP95Ms: 49,
    storeMaxMs: 60,
    poolWaitMaxMs: 3,
    peakDbConnections: 9,
  },
  limits: { ...limits, docPerBoardKiB: 256 },
  failures: [],
  text: 'Inkadra load test · preset small',
});
const rowsOf = (selector: string) =>
  [...host.querySelectorAll(`${selector} th`)].map((th) => th.textContent);

it('shows memory growth per board as information when it does not decide (#911)', async () => {
  vi.mocked(api.get).mockResolvedValue(
    page([run({ status: 'failed', report: memoryReport('shared_process') })]),
  );
  await act(async () => root.render(<LoadTestCard />));
  expect(rowsOf('.load-test__over')).toEqual(['server.loadTest.report.rows.docs']);
  expect(rowsOf('.load-test__info')).toEqual(['server.loadTest.report.rows.perBoard']);
  expect(host.textContent).toContain('server.loadTest.report.infoOnly');
  expect(host.textContent).toContain('server.loadTest.report.perBoardInfo.shared_process');
});

it('keeps memory growth per board as a limit when it decides (#911)', async () => {
  vi.mocked(api.get).mockResolvedValue(
    page([run({ status: 'failed', report: memoryReport(null) })]),
  );
  await act(async () => root.render(<LoadTestCard />));
  expect(rowsOf('.load-test__over')).toEqual([
    'server.loadTest.report.rows.docs',
    'server.loadTest.report.rows.perBoard',
  ]);
  expect(host.textContent).not.toContain('server.loadTest.report.perBoardInfo');
});

it('says when there is no worker to run it', async () => {
  vi.mocked(api.get).mockResolvedValue(page([], false));
  await act(async () => root.render(<LoadTestCard />));
  expect(host.textContent).toContain('server.loadTest.unavailable');
  expect(button('server.loadTest.start')).toBeUndefined();
});
