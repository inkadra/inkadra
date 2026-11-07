import { describe, expect, it } from 'vitest';
import { beatStatus, repeating } from './health.ts';
import { jobProblem, technicalText } from './problems.ts';
import {
  parseCpuMax,
  parseCpuStat,
  parseInactiveFile,
  parseMemoryMax,
  parseNetDev,
} from './resources.ts';
import { average, LatencyRecorder, pointFrom } from './sampler.ts';
import { combine } from './status.ts';
import { memoryStore, type Point, type StoredProblem } from './store.ts';

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
    const container = { cores: 4, memory: 2e9, memoryLimit: 4e9 };
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
    expect(point).toMatchObject({ c: 2, cc: 4, rx: 1000, tx: 500, pc: 0.5, pm: 300 });
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
        { ...base, t: 0, p95: 80, req: 10, err: 0 },
        { ...base, t: 10, c: 3, p95: 120, req: 5, err: 1 },
      ],
      0,
    );
    expect(a).toMatchObject({ c: 2, p95: 120, req: 15, err: 1 });
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
    };
    expect(repeating(p, 20_000)).toBe(true);
    expect(repeating({ ...p, count: 4 }, 20_000)).toBe(false);
    expect(repeating({ ...p, alertedAt: 15_000 }, 20_000)).toBe(false);
    expect(repeating({ ...p, kind: 'disk_full' }, 20_000)).toBe(false);
  });

  it('calls a role late after 30 s and down after 90 s without a signal', () => {
    expect(beatStatus(0, 20_000)).toBe('ok');
    expect(beatStatus(0, 40_000)).toBe('late');
    expect(beatStatus(0, 100_000)).toBe('down');
  });
});
