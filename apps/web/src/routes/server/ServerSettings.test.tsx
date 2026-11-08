// @vitest-environment happy-dom
import type { ServerRange, ServerStatus } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import { updatePreferences } from '../../lib/preferences.ts';
import { technicalSummary } from './common.ts';
import { ServerSettings, useServerStatus } from './ServerSettings.tsx';

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
beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});

const now = new Date().toISOString();
const status = (patch: Partial<ServerStatus> = {}): ServerStatus => ({
  checkedAt: now,
  version: '0.9.0',
  image: 'media',
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
        <ServerSettings />
      </MemoryRouter>,
    ),
  );
  await act(async () => {});
};

it('says that everything works, with the open problems, in the simple view', async () => {
  vi.mocked(api.get).mockResolvedValue(status());
  await render();
  expect(host.textContent).toContain('server.health.ok');
  expect(host.textContent).toContain('server.health.problems:1');
  expect(host.textContent).toContain('server.problems.kinds.video_failed.title');
  // A board of a project the administrator is not in has no name, a video neither.
  expect(host.textContent).toContain('server.people.hidden');
  expect(host.textContent).toContain('server.videos.hidden');
  expect(api.get).toHaveBeenCalledWith('/instance/server?range=1h');
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
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
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
    await act(async () => vi.advanceTimersByTime(10_000));
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
