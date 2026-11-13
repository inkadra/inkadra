// @vitest-environment happy-dom
import type { ServerLive, ServerRange, ServerStatus } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import { updatePreferences } from '../../lib/preferences.ts';
import { mergeLive, technicalSummary } from './common.ts';
import {
  FULL_MS,
  LIVE_MS,
  ServerSettings,
  ServerViewToggle,
  useServerStatus,
} from './ServerSettings.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && 'count' in values ? `${key}:${values.count}` : key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../../lib/api.ts')>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
// One session object, as the app's context gives: a new one each render would re-run the probes.
const session = vi.hoisted(() => ({
  instance: { publicUrl: window.location.origin, collabPath: '/collab', auth: { email: true } },
}));
vi.mock('../../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('../Diagnostics.tsx', () => ({ probeWebSocket: async () => true }));

const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
});
// happy-dom lays nothing out.
Element.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const now = new Date().toISOString();
const status = (patch: Partial<ServerStatus> = {}): ServerStatus => ({
  checkedAt: now,
  version: '0.9.0',
  image: 'standard',
  startedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  range: '1h',
  step: 20,
  history: [{ t: now, cpu: 34, memory: 1.9e9, in: 2e6, out: 5e5, p95: 120, errors: 0, people: 2 }],
  events: [],
  now: {
    cpu: { used: 1.36, cores: 4 },
    memory: { used: 1.9e9, limit: 4e9 },
    network: { in: 2e6, out: 5e5, todayIn: 2e10, todayOut: 6e9 },
    responses: { p95: 120, errors: 0.001 },
  },
  processes: [
    {
      role: 'web',
      host: 'a',
      startedAt: now,
      lastSeenAt: now,
      status: 'ok',
      cpu: 0.2,
      memory: 4e8,
    },
  ],
  services: [
    { id: 'web', status: 'ok', since: now, detail: null },
    { id: 'collab', status: 'ok', since: now, detail: null },
    { id: 'worker', status: 'ok', since: now, detail: null },
    { id: 'database', status: 'ok', since: null, detail: 'PostgreSQL 18.1' },
    { id: 'queue', status: 'ok', since: null, detail: 'Valkey 9.0' },
    { id: 'configuration', status: 'ok', since: null, detail: null },
  ],
  storage: {
    driver: 'local',
    location: '/data',
    total: 931e9,
    free: 519e9,
    used: 412e9,
    originals: 318e9,
    copies: 71e9,
    previews: 23e9,
    growthPerMonth: 30e9,
    monthsLeft: 17,
  },
  backup: { enabled: true, lastAt: now, lastStatus: 'ready', size: 2.4e9, nextAt: now },
  database: { version: 'PostgreSQL 18.1', size: 1.1e9, connections: 14 },
  encoder: { backend: 'vaapi', label: 'VAAPI (Intel)' },
  queues: [{ id: 'proxies', waiting: 3, active: 1, failed24h: 1 }],
  transcodes: {
    active: [
      {
        assetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
        name: null,
        progress: 62,
        secondsLeft: 38,
        speed: 2.4,
        source: 'prores 2160p',
        target: 'h264 1080p',
      },
    ],
    waiting: 3,
    readyToday: 41,
    failedToday: 1,
    averageSeconds: 160,
  },
  presence: {
    people: 2,
    peak: 2,
    boards: [
      {
        boardId: null,
        title: null,
        projectName: null,
        since: now,
        count: 1,
        people: [],
      },
    ],
  },
  checks: [{ id: 'database', status: 'ok', expected: null, actual: null }],
  problems: [
    {
      id: 'video_failed:x',
      kind: 'video_failed',
      severity: 'error',
      role: 'worker',
      firstAt: now,
      lastAt: now,
      count: 2,
      seen: false,
      retry: true,
      technical: 'worker · media-proxies · make\nError: ffmpeg exited 1',
      checkId: null,
      service: null,
      file: 'DJI_0412.MP4',
      board: 'Sopralluoghi',
    },
  ],
  alerts: { enabled: true, email: false },
  ...patch,
});

const render = async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ServerViewToggle />
        <ServerSettings />
      </MemoryRouter>,
    ),
  );
  await act(async () => {});
};
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const reduceMotion = () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
  return () => {
    window.matchMedia = original;
  };
};

it('says that everything works, with the open problems, in the simple view', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  await render();
  expect(host.textContent).toContain('server.health.ok');
  expect(host.textContent).toContain('server.health.problems:1');
  expect(host.textContent).toContain('server.health.checks');
  expect(host.textContent).toContain('server.problems.kinds.video_failed.title');
  // People and videos are two numbers here; their lists are in Advanced.
  expect(host.textContent).toContain('server.simple.connected');
  expect(host.textContent).not.toContain('server.people.hidden');
  expect(api.get).toHaveBeenCalledWith('/instance/server?range=1h');

  const problems = host.querySelector('#server-problems') as HTMLElement;
  const scrollIntoView = vi.fn();
  problems.scrollIntoView = scrollIntoView;
  const restore = reduceMotion();
  try {
    await act(async () => button('server.health.seeProblem:1').click());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  } finally {
    restore();
  }
});

it('turns orange for a failed backup and puts it on top of the problems', async () => {
  const s = status();
  vi.mocked(api.get).mockResolvedValue({
    ...s,
    backup: { ...s.backup, lastStatus: 'failed', lastSuccessAt: s.checkedAt },
    problems: [
      ...s.problems,
      {
        ...(s.problems[0] as ServerStatus['problems'][number]),
        id: 'backup_failed:x',
        kind: 'backup_failed',
        lastAt: new Date(Date.now() - 3_600_000).toISOString(),
        retry: false,
      },
    ],
  });
  await render();
  expect(host.textContent).toContain('server.health.warn');
  expect(host.textContent).toContain('server.health.reasons.backup');
  expect(host.textContent).toContain('server.how.backup.lastSuccess');
  expect(host.querySelector('.settings-summary--warn')).not.toBeNull();
  const titles = [...host.querySelectorAll('.server-problem .settings-row__label')].map(
    (el) => el.firstChild?.textContent,
  );
  expect(titles).toEqual([
    'server.problems.kinds.backup_failed.title',
    'server.problems.kinds.video_failed.title',
  ]);
  // The verdict is in words too, never in the colour alone.
  expect(host.querySelector('.server-verdict--warn')?.textContent).toBe(
    'server.meters.backup.failed',
  );
});

it('leaves out the last successful backup when the server does not send it', async () => {
  const s = status();
  vi.mocked(api.get).mockResolvedValue({ ...s, backup: { ...s.backup, lastStatus: 'failed' } });
  await render();
  expect(host.textContent).not.toContain('server.how.backup.lastSuccess');
});

it('opens a problem in the error log of Advanced without saving the view', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  await render();
  const restore = reduceMotion();
  try {
    const link = host.querySelector(
      'button[aria-label="server.problems.technicalInNamed"]',
    ) as HTMLButtonElement;
    expect(link.textContent).toBe('server.problems.technicalIn');
    await act(async () => link.click());
    expect(host.textContent).toContain('server.advanced.log');
    const found = host.querySelector('.server-log__found') as HTMLElement;
    expect(found.textContent).toContain('ffmpeg exited 1');
    expect(document.activeElement).toBe(found);
    expect(found.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    // The toggle shows Advanced, but the account keeps Simple.
    expect(host.querySelector<HTMLInputElement>('input[value="advanced"]')?.checked).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
    // Back to Simple from the toggle.
    await act(async () => host.querySelector<HTMLInputElement>('input[value="simple"]')?.click());
    expect(host.querySelector('.server-log__found')).toBeNull();
  } finally {
    restore();
  }
});

it('says what is wrong when a service stopped', async () => {
  const s = status();
  vi.mocked(api.get).mockResolvedValue({
    ...s,
    services: s.services.map((x) =>
      x.id === 'worker'
        ? { ...x, status: 'down' as const, since: new Date(Date.now() - 720_000).toISOString() }
        : x,
    ),
  });
  await render();
  expect(host.textContent).toContain('server.health.bad');
  expect(host.textContent).toContain('server.health.effects.worker');
});

it('retries a problem and marks it seen', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  vi.mocked(api.post).mockResolvedValue(undefined);
  await render();
  await act(async () => button('server.problems.retry').click());
  expect(api.post).toHaveBeenCalledWith('/instance/server/problems/video_failed%3Ax/retry', {});
  await act(async () => button('server.problems.seen').click());
  expect(api.post).toHaveBeenCalledWith('/instance/server/problems/video_failed%3Ax/seen', {});
});

it('turns alerts off as soon as the switch changes', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  vi.mocked(api.patch).mockResolvedValue({ enabled: false, email: false });
  await render();
  const toggle = host.querySelector<HTMLInputElement>(
    'input[aria-label="server.alerts.enabled"]',
  ) as HTMLInputElement;
  await act(async () => toggle.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/server/alerts', { enabled: false });
});

it('sends no names in the summary for the developers', () => {
  const text = technicalSummary(status(), []);
  expect(text).toContain('video_failed');
  expect(text).not.toContain('DJI_0412');
  expect(text).not.toContain('Sopralluoghi');
});

const probed: { status: ServerStatus | null } = { status: null };
function Probe({ range }: { range: ServerRange }) {
  probed.status = useServerStatus(range).status;
  return null;
}

it('keeps the range just chosen when the answer for the one before comes late', async () => {
  vi.useFakeTimers();
  try {
    const answers: Array<(s: ServerStatus) => void> = [];
    vi.mocked(api.get).mockImplementation(
      () => new Promise((resolve) => answers.push(resolve as (s: ServerStatus) => void)),
    );
    await act(async () => root.render(<Probe range="1h" />));
    // A tick while the first answer is on its way asks nothing more.
    await act(async () => vi.advanceTimersByTime(4 * LIVE_MS));
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Probe range="24h" />));
    expect(api.get).toHaveBeenLastCalledWith('/instance/server?range=24h');
    await act(async () => answers[1]?.(status({ range: '24h' })));
    await act(async () => answers[0]?.(status({ range: '1h' })));
    expect(probed.status?.range).toBe('24h');
  } finally {
    vi.useRealTimers();
  }
});

it('goes back to the hour when the advanced view leaves the simple one on 15 minutes', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  vi.mocked(api.patch).mockImplementation(async (_path, body) => body);
  await act(async () => updatePreferences({ serverView: 'advanced' }));
  await render();
  const quarter = host.querySelector<HTMLInputElement>('input[type="radio"][value="15m"]');
  await act(async () => quarter?.click());
  expect(api.get).toHaveBeenLastCalledWith('/instance/server?range=15m');
  await act(async () => updatePreferences({ serverView: 'simple' }));
  await act(async () => {});
  expect(api.get).toHaveBeenLastCalledWith('/instance/server?range=1h');
});

it('says the disk compresses the files only when they add up to more than the space used', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  await render();
  expect(host.textContent).toContain('server.meters.storage.split');
  expect(host.textContent).not.toContain('server.meters.storage.compressed');

  const s = status();
  vi.mocked(api.get).mockResolvedValue({ ...s, storage: { ...s.storage, used: 360e9 } });
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.textContent).toContain('server.meters.storage.compressed');

  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => updatePreferences({ serverView: 'advanced' }));
  await render();
  expect(host.textContent).toContain('server.advanced.space.originals');
  expect(host.textContent).toContain('server.meters.storage.compressed');
});

it('asks the live values every 2.5 s and the full status every 30 s, only while visible', async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = 'visible';
  const own = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  try {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.startsWith('/instance/server/live')
        ? ({
            checkedAt: new Date(Date.now() + 1000).toISOString(),
            range: '1h',
            step: 20,
            history: [],
            now: { ...status().now, network: null, p95: 300 },
          } satisfies ServerLive)
        : status(),
    );
    await act(async () => root.render(<Probe range="1h" />));
    const calls = () => vi.mocked(api.get).mock.calls.map(([path]) => path);
    expect(calls()).toEqual(['/instance/server?range=1h']);
    await act(async () => vi.advanceTimersByTimeAsync(LIVE_MS));
    expect(calls().at(-1)).toBe('/instance/server/live?range=1h');
    expect(probed.status?.now.responses.p95).toBe(300);
    await act(async () => vi.advanceTimersByTimeAsync(FULL_MS - LIVE_MS));
    expect(calls().filter((p) => p.startsWith('/instance/server?'))).toHaveLength(2);
    expect(calls().filter((p) => p.startsWith('/instance/server/live'))).toHaveLength(
      FULL_MS / LIVE_MS - 1,
    );
    // A hidden tab asks nothing.
    visibility = 'hidden';
    const before = calls().length;
    await act(async () => vi.advanceTimersByTimeAsync(2 * FULL_MS));
    expect(calls()).toHaveLength(before);
  } finally {
    if (own) Object.defineProperty(document, 'visibilityState', own);
    else Reflect.deleteProperty(document, 'visibilityState');
    vi.useRealTimers();
  }
});

it('merges the live values: newer points replace those of the same time, the window moves on', () => {
  const t = (s: number) => new Date(Date.parse(now) + s * 1000).toISOString();
  const sample = (at: string, cpu: number) => ({
    t: at,
    cpu,
    memory: 1,
    in: null,
    out: null,
    p95: null,
    errors: null,
    people: null,
  });
  const before = status({
    history: [sample(t(-3600), 1), sample(t(-20), 2), sample(t(0), 3)],
  });
  const live: ServerLive = {
    checkedAt: t(30),
    range: '1h',
    step: 20,
    history: [sample(t(0), 4), sample(t(20), 5)],
    now: {
      cpu: { used: 2, cores: 4 },
      memory: { used: 5, limit: 10 },
      network: { in: 1, out: 2 },
      p95: 90,
    },
  };
  const merged = mergeLive(before, live);
  expect(merged.history.map((s) => s.cpu)).toEqual([2, 4, 5]);
  expect(merged.checkedAt).toBe(t(30));
  // Today's traffic and the share of errors stay those of the full reading.
  expect(merged.now.network).toEqual({ in: 1, out: 2, todayIn: 2e10, todayOut: 6e9 });
  expect(merged.now.responses).toEqual({ p95: 90, errors: 0.001 });
  // An answer for another range changes nothing.
  expect(mergeLive(before, { ...live, range: '24h' })).toBe(before);
  // Nor does one older than the full reading.
  expect(mergeLive(before, { ...live, checkedAt: t(-5) })).toBe(before);
});

it.each(['vaapi', 'software', null] as const)(
  'shows GPU only with hardware encoding and a reading (%s)',
  async (backend) => {
    const s = status();
    vi.mocked(api.get).mockResolvedValue({
      ...s,
      encoder: backend ? { backend, label: backend } : null,
      now: { ...s.now, gpu: 40 },
      history: s.history.map((p) => ({ ...p, gpu: 60 })),
    });
    await act(async () => updatePreferences({ serverView: 'advanced' }));
    await render();
    expect(host.textContent?.includes('server.advanced.gpu 40 %')).toBe(backend === 'vaapi');
    expect(host.querySelectorAll('.server-cell--trend')).toHaveLength(4);
    expect(
      host
        .querySelectorAll('.server-cell--trend')[0]
        ?.querySelectorAll('.server-chart__line--memory').length,
    ).toBe(backend === 'vaapi' ? 1 : 0);
  },
);

it('keeps the CPU card unchanged when GPU readings are absent', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  await act(async () => updatePreferences({ serverView: 'advanced' }));
  await render();
  expect(host.querySelectorAll('.server-cell--trend')[0]?.textContent).not.toContain(
    'server.advanced.gpu',
  );
});
