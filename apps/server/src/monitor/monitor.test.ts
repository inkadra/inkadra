import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import IORedis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { beatStatus, repeating } from './health.ts';
import { jobProblem, technicalText } from './problems.ts';
import {
  type GpuReading,
  GpuWindow,
  gpuPercent,
  parseCpuMax,
  parseCpuStat,
  parseDrmFdinfo,
  parseInactiveFile,
  parseMemoryMax,
  parseNetDev,
  readGpu,
} from './resources.ts';
import {
  average,
  Bucket,
  LatencyRecorder,
  pointFrom,
  recordsLatency,
  SAMPLE_MS,
} from './sampler.ts';
import { capacity, combine, imageFlavour, liveNow, RANGES, serverLive } from './status.ts';
import {
  lastHour,
  type MonitorStore,
  memoryStore,
  type Point,
  type ProblemInput,
  redisStore,
  type StoredProblem,
  TIERS,
} from './store.ts';

describe('container readings', () => {
  it('reads cgroup v2 files', () => {
    expect(parseCpuStat('usage_usec 1500000\nuser_usec 1000000\n')).toBe(1_500_000);
    expect(parseCpuMax('max 100000\n')).toBeNull();
    expect(parseCpuMax('200000 100000\n')).toBe(2);
    expect(parseMemoryMax('max\n')).toBeNull();
    expect(parseMemoryMax('4294967296\n')).toBe(4294967296);
    expect(parseInactiveFile('anon 10\ninactive_file 4096\nactive_file 5\n')).toBe(4096);
  });

  it('adds the traffic of every interface but loopback', () => {
    const text = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo:  900 10 0 0 0 0 0 0  900 10 0 0 0 0 0 0',
      '  eth0: 1000 10 0 0 0 0 0 0  300 5 0 0 0 0 0 0',
      '  eth1:   50  1 0 0 0 0 0 0   20 1 0 0 0 0 0 0',
    ].join('\n');
    expect(parseNetDev(text)).toEqual({ rx: 1050, tx: 320 });
    expect(parseNetDev('header\nheader\n')).toBeNull();
  });
});

describe('samples', () => {
  it('turns two readings into cores and bytes per second', () => {
    const container = {
      cores: 4,
      memory: 2e9,
      memoryLimit: 4e9,
      machine: 'boot-1',
      hostCores: true,
      hostMemory: false,
    };
    const point = pointFrom(
      10_000,
      10_000,
      {
        container: { ...container, cpuUsec: 0, rx: 0, tx: 0 },
        cpu: { user: 0, system: 0 },
      },
      {
        container: { ...container, cpuUsec: 20_000_000, rx: 10_000, tx: 5_000 },
        cpu: { user: 5_000_000, system: 0 },
        rss: 300,
      },
    );
    expect(point).toMatchObject({
      c: 2,
      cc: 4,
      rx: 1000,
      tx: 500,
      pc: 0.5,
      pm: 300,
      box: 'boot-1',
      hc: true,
      hm: false,
    });
  });

  it('measures the 95th percentile and failed answers, then starts over', () => {
    const latency = new LatencyRecorder();
    for (let ms = 1; ms <= 100; ms++) latency.record(ms, ms === 100 ? 500 : 200);
    expect(latency.take()).toEqual({ p95: 95, req: 100, err: 1 });
    expect(latency.take()).toEqual({ p95: null, req: 0, err: 0 });
  });

  it('averages a slice and keeps the slowest p95', () => {
    const base = { c: 1, cc: 2, m: 100, ml: 200, rx: 10, tx: 4, pc: 0.5, pm: 50 };
    const a = average(
      [
        { ...base, g: 20, t: 0, p95: 80, req: 10, err: 0 },
        { ...base, g: 60, t: 10, c: 3, p95: 120, req: 5, err: 1 },
      ],
      0,
    );
    expect(a).toMatchObject({ c: 2, g: 40, p95: 120, req: 15, err: 1 });
  });
});

describe('the whole instance', () => {
  const point = (t: number, extra: Partial<Point> = {}): Point => ({
    t,
    c: 1,
    cc: 4,
    m: 1e9,
    ml: 4e9,
    rx: 100,
    tx: 50,
    pc: 0.2,
    pm: 1e8,
    ...extra,
  });

  it('counts a container once whatever runs in it, and adds containers', () => {
    const series = combine(
      new Map([
        ['web@a', [point(0, { p95: 100, req: 10, err: 1 })]],
        ['collab@a', [point(0, { people: 3 })]],
        ['worker@b', [point(0, { c: 3 })]],
      ]),
      0,
      10,
    );
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      cpu: 50,
      memory: 2e9,
      in: 200,
      out: 100,
      p95: 100,
      errors: 0.1,
      people: 3,
    });
  });

  it('counts the cores and memory of a machine once for containers without limits', () => {
    const host = { box: 'm1', cc: 8, ml: 32e9, hc: true, hm: true };
    // Three containers of a split setup on one machine, none limited: one machine's worth.
    expect(
      capacity([point(0, host), point(0, host), point(0, { ...host, cc: 8, hm: false, ml: 2e9 })]),
    ).toEqual({ cores: 8, memory: 32e9 });
    // Limited containers add their limits; another machine adds its own.
    expect(
      capacity([
        point(0, { box: 'm1', cc: 2, ml: 4e9, hc: false, hm: false }),
        point(0, { box: 'm1', cc: 1, ml: 2e9, hc: false, hm: false }),
        point(0, { box: 'm2', cc: 4, ml: 16e9, hc: true, hm: true }),
      ]),
    ).toEqual({ cores: 7, memory: 22e9 });
    const series = combine(
      new Map([
        ['web@a', [point(0, { ...host, c: 2 })]],
        ['worker@b', [point(0, { ...host, c: 2 })]],
      ]),
      0,
      10,
    );
    expect(series[0]?.cpu).toBe(50);
  });

  it('keeps a process in the sums when its sample falls in the next slice', () => {
    // Samples 10 s apart but off the clock: slice 10–20 s gets none of worker@b.
    const series = combine(
      new Map([
        ['web@a', [point(1_000), point(11_000), point(21_000)]],
        ['worker@b', [point(9_500), point(20_500)]],
      ]),
      0,
      10,
    );
    expect(series.map((s) => s.memory)).toEqual([2e9, 2e9, 2e9]);
    expect(series.map((s) => s.t)).toEqual([
      new Date(0).toISOString(),
      new Date(10_000).toISOString(),
      new Date(20_000).toISOString(),
    ]);
  });
});

describe('sampling every 5 s', () => {
  const point = (t: number, extra: Partial<Point> = {}): Point => ({
    t,
    c: 1,
    cc: 4,
    m: 1e9,
    ml: 4e9,
    rx: 100,
    tx: 50,
    pc: 0.2,
    pm: 1e8,
    ...extra,
  });

  it('samples every 5 s and keeps an hour of them', () => {
    expect(SAMPLE_MS).toBe(5_000);
    expect(TIERS.raw.step * TIERS.raw.keep).toBe(3600);
    expect(TIERS.m1.step * TIERS.m1.keep).toBe(86_400);
    expect(TIERS.m10.step * TIERS.m10.keep).toBe(7 * 86_400);
  });

  it('reads every range from a tier that covers it, at a step of whole samples', () => {
    for (const { tier, window, step } of Object.values(RANGES)) {
      expect(TIERS[tier].step * TIERS[tier].keep).toBeGreaterThanOrEqual(window);
      expect(step % TIERS[tier].step).toBe(0);
      expect(window / step).toBeLessThanOrEqual(180);
    }
    expect(RANGES['15m'].step).toBe(5);
  });

  it('rolls twelve samples into a minute and 120 into ten minutes', () => {
    const m1 = new Bucket('m1');
    const m10 = new Bucket('m10');
    const minutes: Point[] = [];
    const tens: Point[] = [];
    for (let t = 0; t <= 600_000; t += 5_000) {
      const p = point(t, { c: t < 60_000 ? (t / 5_000) % 2 : 2, req: 1, p95: t / 1000 });
      const a = m1.add(p);
      const b = m10.add(p);
      if (a) minutes.push(a);
      if (b) tens.push(b);
    }
    expect(minutes).toHaveLength(10);
    // The first minute: twelve samples, half at 0 and half at 1 core.
    expect(minutes[0]).toMatchObject({ t: 0, c: 0.5, req: 12, p95: 55 });
    expect(minutes[1]).toMatchObject({ t: 60_000, c: 2, req: 12 });
    expect(tens).toHaveLength(1);
    expect(tens[0]).toMatchObject({ t: 0, req: 120, p95: 595 });
  });
});

describe('the live values', () => {
  const point = (t: number, extra: Partial<Point> = {}): Point => ({
    t,
    c: 1,
    cc: 4,
    m: 1e9,
    ml: 4e9,
    rx: 100,
    tx: 50,
    pc: 0.2,
    pm: 1e8,
    ...extra,
  });
  const now = 1_700_000_003_000;
  const filled = async () => {
    const store = memoryStore(() => now);
    for (const process of ['web@a', 'worker@b']) {
      const [role, host] = process.split('@') as ['web', string];
      await store.beat({ role, host, startedAt: 0, at: now, cpu: 0, memory: 0 });
      for (let t = now - 10 * 60_000; t <= now; t += 5_000)
        await store.push(
          'raw',
          process,
          point(t, role === 'web' ? { c: 2, p95: 80, req: 3, err: 0 } : { c: 1 }),
        );
    }
    return store;
  };

  it('gives the values of now and the newest whole slices of the range', async () => {
    const live = await serverLive(await filled(), '1h', now);
    expect(live.step).toBe(20);
    expect(live.now).toEqual({
      gpu: null,
      cpu: { used: 3, cores: 8 },
      memory: { used: 2e9, limit: 8e9 },
      network: { in: 200, out: 100 },
      p95: 80,
    });
    // Two whole 20 s slices and the one of now, on the clock, all four processes' worth.
    const times = live.history.map((p) => Date.parse(p.t));
    expect(times).toEqual([now - 43_000, now - 23_000, now - 3_000]);
    expect(live.history.map((p) => p.memory)).toEqual([2e9, 2e9, 2e9]);
  });

  it('reads the monitor store only, never anything else', async () => {
    const store = await filled();
    const used = new Set<string>();
    const spy = new Proxy(store, {
      get(target, key: string) {
        used.add(key);
        return target[key as keyof MonitorStore];
      },
    });
    await serverLive(spy, '15m', now);
    await serverLive(spy, '24h', now);
    expect([...used].sort()).toEqual(['beats', 'points']);
  });
});

describe('problems', () => {
  it('leaves names, paths, addresses and quoted values out of the technical line', () => {
    const text = technicalText(
      'Error: ffmpeg failed on /data/tmp/job-1/DJI_0412.MP4 "Sopralluoghi" for anna@example.com ' +
        'at postgres://inkadra:secret@db/inkadra Key (email)=(anna@example.com) already exists',
    );
    expect(text).not.toMatch(/DJI|Sopralluoghi|anna|secret|example/);
    expect(text).toContain('ffmpeg failed');
  });

  it('leaves out file names of any kind, and paths with spaces', () => {
    const text = technicalText(
      'Error: /srv/inkadra/My Project/Notte bianca final.braw: Invalid data; ' +
        'also C:\\Users\\anna\\Desktop\\Budget 2026.ods and Copione.odt, Mix.flac, Logo.svg ' +
        'at main.js',
    );
    expect(text).not.toMatch(/Project|Notte|bianca|anna|Budget|Copione|Mix|Logo/);
    expect(text).toContain('Invalid data');
    expect(text).toContain('main.js');
  });

  it('groups failures of one file, and names the queue of the others', () => {
    const err = new Error('ffmpeg exited with code 1: Invalid data found when processing input');
    const video = jobProblem(
      'worker',
      'media-proxies',
      {
        id: 'proxy-1',
        name: 'make',
        data: { assetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10' },
      },
      err,
    );
    expect(video).toMatchObject({
      id: 'video_failed:0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
      kind: 'video_failed',
      job: { queue: 'media-proxies', id: 'proxy-1' },
    });
    const mail = jobProblem('worker', 'email', { id: '7', name: 'notifications', data: {} }, err);
    expect(mail).toMatchObject({ kind: 'email_failed', severity: 'warning' });
    expect(jobProblem('worker', 'collab', { name: 'add-card', data: {} }, err)).toBeNull();
    expect(jobProblem('worker', 'maintenance', { name: 'backup', data: {} }, err)).toBeNull();
  });

  it('counts occurrences and shows a problem seen again when it happens again', async () => {
    let now = 1000;
    const store = memoryStore(() => now);
    const input = {
      id: 'x',
      kind: 'job_failed' as const,
      severity: 'error' as const,
      role: 'worker' as const,
      technical: 'worker · maintenance',
      assetId: null,
      service: null,
      job: null,
    };
    await store.record({ ...input, at: now });
    await store.update('x', { seenAt: now });
    now += 1000;
    await store.record({ ...input, at: now });
    const [p] = await store.problems();
    expect(p).toMatchObject({ count: 2, firstAt: 1000, lastAt: 2000, seenAt: null });
    now += 8 * 86_400_000;
    expect(await store.problems()).toEqual([]);
  });

  it('alerts about an error repeated within the hour, once an hour', () => {
    const recent = [1000, 2000, 3000, 4000, 10_000];
    const p: StoredProblem = {
      id: 'x',
      kind: 'server_error',
      severity: 'error',
      role: 'web',
      firstAt: 0,
      lastAt: 10_000,
      count: 5,
      seenAt: null,
      technical: '',
      assetId: null,
      service: null,
      job: null,
      alertedAt: null,
      recent,
    };
    expect(repeating(p, 20_000)).toBe(true);
    expect(repeating({ ...p, recent: recent.slice(1) }, 20_000)).toBe(false);
    // Five times this week, but not within the hour.
    expect(repeating({ ...p, count: 50 }, 3_605_000)).toBe(false);
    expect(repeating({ ...p, alertedAt: 15_000 }, 20_000)).toBe(false);
    expect(repeating({ ...p, kind: 'disk_full' }, 20_000)).toBe(false);
  });

  it('counts the occurrences of the last hour apart from the whole week', async () => {
    let now = 0;
    const store = memoryStore(() => now);
    const input: ProblemInput = {
      id: 'x',
      kind: 'server_error',
      severity: 'error',
      role: 'web',
      technical: '',
      assetId: null,
      service: null,
      job: null,
      at: 0,
    };
    for (const at of [0, 60_000, 4_000_000, 4_100_000]) await store.record({ ...input, at });
    now = 4_200_000;
    const [p] = await store.problems();
    expect(p?.count).toBe(4);
    expect(lastHour(p as StoredProblem, now)).toBe(2);
  });

  it.skipIf(!process.env.REDIS_URL)(
    'keeps an occurrence and a "seen" that land at the same moment (needs REDIS_URL)',
    async () => {
      const redis = new IORedis(process.env.REDIS_URL ?? '');
      const store = redisStore(redis);
      const id = `race-${Date.now()}`;
      const input: ProblemInput = {
        id,
        kind: 'job_failed',
        severity: 'error',
        role: 'worker',
        technical: '',
        assetId: null,
        service: null,
        job: null,
        at: Date.now(),
      };
      try {
        await store.record(input);
        await Promise.all([
          store.update(id, { seenAt: Date.now(), alertedAt: 5 }),
          store.record({ ...input, at: Date.now() + 1000 }),
        ]);
        const p = (await store.problems()).find((x) => x.id === id);
        expect(p).toMatchObject({ count: 2, alertedAt: 5 });
        expect(p?.seenAt).toEqual(expect.any(Number));
      } finally {
        for (const key of ['problems', 'problems:seenAt', 'problems:alertedAt'])
          await redis.hdel(`inkadra:monitor:${key}`, id);
        redis.disconnect();
      }
    },
  );

  it('calls a role late after 30 s and down after 90 s without a signal', () => {
    expect(beatStatus(0, 20_000)).toBe('ok');
    expect(beatStatus(0, 40_000)).toBe('late');
    expect(beatStatus(0, 100_000)).toBe('down');
  });
});

describe('image flavour', () => {
  it('reports standard with media tools, office, or a development run', () => {
    try {
      vi.stubEnv('INKADRA_OFFICE', 'false');
      expect(imageFlavour()).toBe('standard');
      vi.stubEnv('INKADRA_OFFICE', 'true');
      expect(imageFlavour()).toBe('office');
      vi.stubEnv('INKADRA_OFFICE', undefined);
      expect(imageFlavour()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('DRM GPU readings', () => {
  const i915 = (id: number, busy: number, device = '0000:00:02.0') => `pos: 0
flags: 0100002
drm-driver: i915
drm-client-id: ${id}
drm-pdev: ${device}
drm-engine-render: 0 ns
drm-engine-video: ${busy} ns
drm-engine-capacity-video: 2
`;
  const reading = (...texts: string[]) =>
    new Map(
      texts.map((text) => {
        const client = parseDrmFdinfo(text);
        if (!client) throw new Error('Invalid fixture');
        return [`${client.device}/${client.id}`, client];
      }),
    );
  it('parses i915 and amdgpu time counters and rejects non-DRM or malformed counters', () => {
    expect(parseDrmFdinfo(i915(1, 100))?.engines.video).toEqual({
      busy: 100,
      total: null,
      capacity: 2,
    });
    expect(parseDrmFdinfo(i915(1, 100).replace('i915', 'amdgpu'))).not.toBeNull();
    expect(parseDrmFdinfo('pos: 0\nflags: 0100002')).toBeNull();
    expect(
      parseDrmFdinfo('drm-driver: xe\ndrm-client-id: 1\ndrm-cycles-video: invalid'),
    ).toBeNull();
  });
  it('sums clients per engine, divides capacity, drops exited clients and counts new ones from zero', () => {
    const before = reading(i915(1, 100e6), i915(2, 800e6));
    const after = reading(i915(1, 900e6), i915(3, 200e6));
    expect(gpuPercent(before, after, 1000)).toBe(50);
    expect(gpuPercent(before, reading(i915(1, 50e6)), 1000)).toBe(0);
    expect(gpuPercent(null, after, 1000)).toBeNull();
    // Only a new client, or none at all: the GPU was idle, not unknown.
    expect(gpuPercent(before, reading(i915(4, 0)), 1000)).toBe(0);
    expect(gpuPercent(new Map(), new Map(), 5000)).toBe(0);
    expect(
      gpuPercent(reading(i915(1, 0), i915(2, 0)), reading(i915(1, 400e6), i915(2, 600e6)), 1000),
    ).toBe(50);
  });
  it('uses xe total cycles and capacity rather than wall time', () => {
    const xe = (busy: number, total: number) => `drm-driver: xe
 dr m: ignored
drm-client-id: 7
drm-pdev: 0000:03:00.0
drm-cycles-vcs: ${busy}
drm-total-cycles-vcs: ${total}
drm-engine-capacity-vcs: 2`;
    expect(gpuPercent(reading(xe(100, 1000)), reading(xe(500, 2000)), 5)).toBe(20);
  });
  it('retains measured work of closed clients until it ages out of the window', () => {
    const window = new GpuWindow(20_000);
    expect(window.sample(reading(i915(1, 0)), 0)).toBeNull();
    for (let t = 5000; t <= 20_000; t += 5000)
      expect(window.sample(reading(i915(1, t * 1e6)), t)).toBe(50);
    expect(window.sample(new Map(), 25_000)).toBe(37.5);
    expect(window.sample(new Map(), 30_000)).toBe(25);
    expect(window.sample(new Map(), 35_000)).toBe(12.5);
    expect(window.sample(new Map(), 40_000)).toBe(0);
    expect(window.sample(reading(i915(2, 1e9)), 45_000)).toBe(2.5);
  });
  it('reads visible processes once per device/client and tolerates missing files', async () => {
    const proc = await mkdtemp(join(tmpdir(), 'inkadra-gpu-'));
    await mkdir(join(proc, '123/fdinfo'), { recursive: true });
    await mkdir(join(proc, '456/fdinfo'), { recursive: true });
    await writeFile(join(proc, '123/fdinfo/1'), i915(1, 100));
    await writeFile(join(proc, '456/fdinfo/2'), i915(1, 100));
    await writeFile(join(proc, '456/fdinfo/3'), i915(1, 200, '0000:03:00.0'));
    expect((await readGpu(proc))?.size).toBe(2);
    expect(await readGpu(join(proc, 'missing'))).toBeNull();
    const idle = await mkdtemp(join(tmpdir(), 'inkadra-gpu-idle-'));
    expect((await readGpu(idle))?.size).toBe(0);
    await rename(proc, `${proc}_to_delete`);
  });
  it('preserves worker GPU values and counts each container once, including live values', () => {
    const base: Point = {
      t: 1000,
      c: 0,
      cc: 4,
      m: 0,
      ml: 100,
      rx: 0,
      tx: 0,
      pc: 0,
      pm: 0,
      box: 'same-machine',
    };
    const raw = new Map([
      ['web@a', [base]],
      ['worker@a', [{ ...base, g: 40 }]],
      ['collab@a', [{ ...base, g: 40 }]],
      ['worker@b', [{ ...base, g: 20 }]],
    ]);
    expect(combine(raw, 0, 5)[0]?.gpu).toBe(60);
    expect(liveNow(raw, 2000).gpu).toBe(60);
    const point = pointFrom(
      2000,
      1000,
      {
        container: {
          cpuUsec: 0,
          cores: 4,
          memory: 0,
          memoryLimit: 100,
          rx: 0,
          tx: 0,
          machine: null,
          hostCores: false,
          hostMemory: false,
          gpu: reading(i915(1, 0)),
        },
        cpu: { user: 0, system: 0 },
      },
      {
        container: {
          cpuUsec: 0,
          cores: 4,
          memory: 0,
          memoryLimit: 100,
          rx: 0,
          tx: 0,
          machine: null,
          hostCores: false,
          hostMemory: false,
          gpu: reading(i915(1, 800e6)),
        },
        cpu: { user: 0, system: 0 },
        rss: 0,
      },
    );
    expect(point.g).toBe(40);
    // A saturated i915 engine with GuC: the counter stood still, then jumped. Over the window it
    // reads the true average, not 0 % now and 100 % next time.
    const window = new GpuWindow(20_000);
    window.sample(reading(i915(1, 0)), 1000);
    window.sample(reading(i915(1, 4e9)), 16_000);
    expect(window.sample(reading(i915(1, 24e9)), 21_000)).toBeCloseTo(60);
  });
});

it('counts response times of JSON requests only, never of file transfers', () => {
  for (const status of [200, 204, 500])
    expect(recordsLatency('application/offset+octet-stream', 'application/json', status)).toBe(
      false,
    );
  expect(recordsLatency('multipart/form-data; boundary=x', 'application/json', 200)).toBe(false);
  expect(recordsLatency('application/zip', 'application/json', 202)).toBe(false);
  expect(recordsLatency('', 'application/json; charset=utf-8', 200)).toBe(true);
  expect(recordsLatency('application/json', '', 204)).toBe(true);
  expect(recordsLatency('', '', 500)).toBe(true);
  expect(recordsLatency('', 'video/mp4', 206)).toBe(false);
});
