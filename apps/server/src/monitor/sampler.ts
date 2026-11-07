import { hostname } from 'node:os';
import type { ServerRole } from '@inkadra/shared';
import type { Logger } from 'pino';
import { type ContainerReading, readContainer } from './resources.ts';
import {
  type MonitorStore,
  type Point,
  type PresenceBoard,
  processKey,
  TIERS,
  type Tier,
} from './store.ts';

export const SAMPLE_MS = TIERS.raw.step * 1000;

/**
 * Response times of the web role between two samples. Only JSON answers of the API count:
 * uploads, downloads and video streams take as long as the file, not as the server.
 */
export class LatencyRecorder {
  private times: number[] = [];
  private requests = 0;
  private errors = 0;

  record(ms: number, status: number) {
    this.requests += 1;
    if (status >= 500) this.errors += 1;
    // shortcut: past 10 000 answers in 10 s the rest only count; a reservoir would keep them fair.
    if (this.times.length < 10_000) this.times.push(ms);
  }

  take(): { p95: number | null; req: number; err: number } {
    const sorted = this.times.sort((a, b) => a - b);
    const p95 = sorted.length ? (sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null) : null;
    const out = { p95, req: this.requests, err: this.errors };
    this.times = [];
    this.requests = 0;
    this.errors = 0;
    return out;
  }
}

/** Averages of the raw samples for the coarser tiers; the slowest p95, the sum of requests. */
class Bucket {
  private points: Point[] = [];
  constructor(
    readonly tier: Tier,
    private start = 0,
  ) {}

  /** Adds a point; returns the average of the previous slice when this one starts a new one. */
  add(point: Point): Point | null {
    const step = TIERS[this.tier].step * 1000;
    const start = Math.floor(point.t / step) * step;
    let done: Point | null = null;
    if (start !== this.start && this.points.length) done = average(this.points, this.start);
    if (start !== this.start) {
      this.points = [];
      this.start = start;
    }
    this.points.push(point);
    return done;
  }
}

const mean = (values: Array<number | null | undefined>) => {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

export function average(points: Point[], t: number): Point {
  const p95s = points.map((p) => p.p95).filter((v): v is number => typeof v === 'number');
  const people = points.map((p) => p.people).filter((v): v is number => typeof v === 'number');
  return {
    t,
    c: mean(points.map((p) => p.c)) ?? 0,
    cc: mean(points.map((p) => p.cc)) ?? 0,
    m: Math.round(mean(points.map((p) => p.m)) ?? 0),
    ml: points.at(-1)?.ml ?? null,
    rx: mean(points.map((p) => p.rx)),
    tx: mean(points.map((p) => p.tx)),
    pc: mean(points.map((p) => p.pc)) ?? 0,
    pm: Math.round(mean(points.map((p) => p.pm)) ?? 0),
    ...(points.some((p) => p.req !== undefined)
      ? {
          // shortcut: the slowest p95 of the slice, not a true p95 over it; good enough for a chart.
          p95: p95s.length ? Math.max(...p95s) : null,
          req: points.reduce((s, p) => s + (p.req ?? 0), 0),
          err: points.reduce((s, p) => s + (p.err ?? 0), 0),
        }
      : {}),
    ...(people.length ? { people: Math.max(...people) } : {}),
  };
}

/** A sample from two readings `ms` apart. */
export function pointFrom(
  t: number,
  ms: number,
  before: { container: ContainerReading; cpu: NodeJS.CpuUsage },
  after: { container: ContainerReading; cpu: NodeJS.CpuUsage; rss: number },
): Point {
  const seconds = ms / 1000;
  const rate = (a: number | null, b: number | null) =>
    a === null || b === null || b < a ? null : (b - a) / seconds;
  const cpuUsec = after.container.cpuUsec - before.container.cpuUsec;
  const processUsec = after.cpu.user + after.cpu.system - (before.cpu.user + before.cpu.system);
  return {
    t,
    c: Math.max(0, cpuUsec / 1e6 / seconds),
    cc: after.container.cores,
    m: after.container.memory,
    ml: after.container.memoryLimit,
    rx: rate(before.container.rx, after.container.rx),
    tx: rate(before.container.tx, after.container.tx),
    pc: Math.max(0, processUsec / 1e6 / seconds),
    pm: after.rss,
  };
}

/**
 * Every 10 s: a sample of this process and its container, pushed to the three tiers, and a
 * heartbeat that tells the web role this role is alive (#514).
 */
export function startSampler(opts: {
  role: ServerRole;
  store: MonitorStore;
  log: Pick<Logger, 'warn'>;
  latency?: LatencyRecorder;
  presence?: () => PresenceBoard[];
  intervalMs?: number;
}) {
  const host = hostname();
  const startedAt = Date.now();
  const key = processKey({ role: opts.role, host });
  const buckets = [new Bucket('m1'), new Bucket('m10')];
  let previous: { container: ContainerReading; cpu: NodeJS.CpuUsage; at: number } | null = null;
  let failing = false;

  async function sample() {
    const at = Date.now();
    const container = await readContainer();
    const cpu = process.cpuUsage();
    const rss = process.memoryUsage.rss();
    const presence = opts.presence?.();
    if (previous) {
      const point = pointFrom(at, at - previous.at, previous, { container, cpu, rss });
      if (opts.latency) Object.assign(point, opts.latency.take());
      if (presence) point.people = new Set(presence.flatMap((b) => b.users)).size;
      await opts.store.push('raw', key, point);
      for (const bucket of buckets) {
        const done = bucket.add(point);
        if (done) await opts.store.push(bucket.tier, key, done);
      }
      await opts.store.beat({
        role: opts.role,
        host,
        startedAt,
        at,
        cpu: point.pc,
        memory: rss,
        ...(presence ? { presence } : {}),
      });
    } else {
      await opts.store.beat({ role: opts.role, host, startedAt, at, cpu: 0, memory: rss });
    }
    previous = { container, cpu, at };
  }

  const tick = () =>
    sample().then(
      () => {
        failing = false;
      },
      (err) => {
        // Once per outage: Valkey down is already a problem of its own.
        if (!failing) opts.log.warn({ err }, 'server sample not saved');
        failing = true;
      },
    );
  void tick();
  const timer = setInterval(tick, opts.intervalMs ?? SAMPLE_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), sample: tick };
}
