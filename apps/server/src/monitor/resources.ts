import { readdir, readFile } from 'node:fs/promises';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';

/**
 * What the container this process runs in uses (#514): CPU and memory from cgroup v2, traffic
 * from /proc/net/dev (the container's own network namespace, not the host). Outside a container
 * (development, a plain `node` on a server) the host's figures stand in.
 */

const CGROUP = '/sys/fs/cgroup';

export interface ContainerReading {
  /** Microseconds of CPU used since the cgroup (or, outside one, the host) started. */
  cpuUsec: number;
  gpu?: GpuReading | null;
  cores: number;
  memory: number;
  memoryLimit: number | null;
  /** Bytes received and sent since the namespace started, loopback left out. */
  rx: number | null;
  tx: number | null;
  /** The machine: every container on it reads the same boot id. */
  machine: string | null;
  /** No limit of the container's own: `cores` and `memoryLimit` are the whole machine's. */
  hostCores: boolean;
  hostMemory: boolean;
}

/** `usage_usec 1234` from cpu.stat. */
export function parseCpuStat(text: string): number | null {
  const match = /^usage_usec (\d+)$/m.exec(text);
  return match ? Number(match[1]) : null;
}

/** `max 100000` (no limit) or `200000 100000` (two cores) from cpu.max. */
export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  if (!quota || quota === 'max' || !period) return null;
  const cores = Number(quota) / Number(period);
  return Number.isFinite(cores) && cores > 0 ? cores : null;
}

/** memory.max is `max` without a limit. */
export function parseMemoryMax(text: string): number | null {
  const value = text.trim();
  if (value === 'max') return null;
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/** Page cache the kernel drops first (`inactive_file`), left out of memory in use as `docker stats` does. */
export function parseInactiveFile(text: string): number {
  const match = /^inactive_file (\d+)$/m.exec(text);
  return match ? Number(match[1]) : 0;
}

/** Sums every interface but loopback: `eth0: rxBytes … (8 fields) txBytes …`. */
export function parseNetDev(text: string): { rx: number; tx: number } | null {
  let rx = 0;
  let tx = 0;
  let found = false;
  for (const line of text.split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!name || rest === undefined || name.trim() === 'lo') continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    if (fields.length < 9) continue;
    rx += fields[0] ?? 0;
    tx += fields[8] ?? 0;
    found = true;
  }
  return found ? { rx, tx } : null;
}

/** Busy time of every core of the host, when there is no cgroup to ask. */
function hostCpuUsec(): number {
  return cpus().reduce((sum, c) => sum + (c.times.user + c.times.nice + c.times.sys) * 1000, 0);
}

const read = (path: string) => readFile(path, 'utf8').catch(() => null);

export async function readContainer(): Promise<ContainerReading> {
  const [stat, max, current, memStat, memMax, net, boot] = await Promise.all([
    read(`${CGROUP}/cpu.stat`),
    read(`${CGROUP}/cpu.max`),
    read(`${CGROUP}/memory.current`),
    read(`${CGROUP}/memory.stat`),
    read(`${CGROUP}/memory.max`),
    read('/proc/net/dev'),
    read('/proc/sys/kernel/random/boot_id'),
  ]);
  const host = availableParallelism();
  const cgroupCores = max ? parseCpuMax(max) : null;
  const cgroupMemory = memMax ? parseMemoryMax(memMax) : null;
  const traffic = net ? parseNetDev(net) : null;
  const memory = current
    ? Number(current.trim()) - (memStat ? parseInactiveFile(memStat) : 0)
    : Number.NaN;
  return {
    cpuUsec: (stat ? parseCpuStat(stat) : null) ?? hostCpuUsec(),
    cores: cgroupCores ? Math.min(cgroupCores, host) : host,
    memory: Number.isFinite(memory) ? memory : totalmem() - freemem(),
    memoryLimit: cgroupMemory ? Math.min(cgroupMemory, totalmem()) : totalmem(),
    rx: traffic?.rx ?? null,
    tx: traffic?.tx ?? null,
    machine: boot?.trim().slice(0, 36) || null,
    hostCores: !cgroupCores || cgroupCores >= host,
    hostMemory: !cgroupMemory || cgroupMemory >= totalmem(),
  };
}

export interface DrmClient {
  id: string;
  device: string;
  engines: Record<string, { busy: number; total: number | null; capacity: number }>;
}
export type GpuReading = Map<string, DrmClient>;

/** DRM's common fdinfo keys; a client can be shared by several fds and processes. */
export function parseDrmFdinfo(text: string): DrmClient | null {
  const fields = new Map(
    text.split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  const driver = fields.get('drm-driver');
  const id = fields.get('drm-client-id');
  if (!driver || !id || !/^\d+$/.test(id)) return null;
  const device = fields.get('drm-pdev') ?? driver;
  const engines: DrmClient['engines'] = {};
  const uint = (key: string, ns = false) => {
    const value = fields.get(key);
    if (!value || !(ns ? /^\d+ ns$/ : /^\d+$/).test(value)) return null;
    const n = Number(value.split(' ')[0]);
    return Number.isFinite(n) ? n : null;
  };
  for (const key of fields.keys()) {
    const match = /^drm-(?:engine|cycles)-(.+)$/.exec(key);
    if (!match || key.startsWith('drm-engine-capacity-')) continue;
    const name = match[1];
    if (!name) continue;
    const ns = uint(`drm-engine-${name}`, true);
    const cycles = uint(`drm-cycles-${name}`);
    const total = uint(`drm-total-cycles-${name}`);
    const capacity = uint(`drm-engine-capacity-${name}`) ?? 1;
    if (capacity <= 0) continue;
    if (ns !== null) engines[name] = { busy: ns, total: null, capacity };
    else if (cycles !== null && total !== null) engines[name] = { busy: cycles, total, capacity };
  }
  return Object.keys(engines).length ? { id, device, engines } : null;
}

/** Only processes visible in this PID namespace, without additional privileges. */
export async function readGpu(proc = '/proc'): Promise<GpuReading | null> {
  const pids = await readdir(proc).catch(() => null);
  if (!pids) return null;
  // No process holding the GPU open is a reading too: an idle GPU, 0 %.
  const clients: GpuReading = new Map();
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    const dir = `${proc}/${pid}/fdinfo`;
    for (const fd of await readdir(dir).catch(() => [])) {
      const text = await read(`${dir}/${fd}`);
      const client = text ? parseDrmFdinfo(text) : null;
      if (client) clients.set(`${client.device}/${client.id}`, client);
    }
  }
  // shortcut: proprietary NVIDIA drivers usually have no DRM fdinfo; add a driver API only
  // when container-scoped counters are available without extra privileges (never nvidia-smi).
  return clients;
}

/**
 * The busiest engine. A client that exited between the readings is lost; one that opened in
 * between counts its whole time counter, which starts at zero when its file is opened.
 */
function gpuLoads(
  before: GpuReading | null | undefined,
  after: GpuReading | null | undefined,
  ms: number,
): Map<string, number> | null {
  if (!before || !after || ms <= 0) return null;
  const engines = new Map<string, number>();
  for (const [id, client] of after) {
    const old = before.get(id);
    for (const [name, counter] of Object.entries(client.engines)) {
      const prev = old?.engines[name];
      // xe cycle totals are a GPU clock, not zero at open: a new client has no baseline.
      if (!prev && counter.total !== null) continue;
      if (prev && (prev.total === null) !== (counter.total === null)) continue;
      const elapsed = counter.total === null ? ms * 1e6 : counter.total - (prev?.total ?? 0);
      if (elapsed <= 0) continue;
      // Drivers may briefly report a smaller busy counter: keep the previous high-water mark.
      const delta = Math.max(0, counter.busy - (prev?.busy ?? 0));
      counter.busy = Math.max(counter.busy, prev?.busy ?? 0);
      const key = `${client.device}/${name}`;
      engines.set(key, (engines.get(key) ?? 0) + delta / elapsed / counter.capacity);
    }
  }
  return engines;
}

/** The busiest engine between two readings; new time counters count from zero. */
export function gpuPercent(
  before: GpuReading | null | undefined,
  after: GpuReading | null | undefined,
  ms: number,
): number | null {
  const loads = gpuLoads(before, after, ms);
  return loads ? Math.min(100, Math.max(0, ...loads.values()) * 100) : null;
}

/** Keep measured engine time after a client closes, until its interval leaves the window. */
export class GpuWindow {
  private previous: { gpu: GpuReading | null | undefined; at: number } | null = null;
  private intervals: { from: number; to: number; loads: Map<string, number> }[] = [];
  constructor(private readonly windowMs: number) {}

  sample(gpu: GpuReading | null | undefined, at: number): number | null {
    const previous = this.previous;
    this.previous = { gpu, at };
    if (!previous) return null;
    const loads = gpuLoads(previous.gpu, gpu, at - previous.at);
    if (!loads) {
      this.intervals = [];
      return null;
    }
    this.intervals.push({ from: previous.at, to: at, loads });
    const from = Math.max(at - this.windowMs, this.intervals[0]?.from ?? at);
    this.intervals = this.intervals.filter((i) => i.to > from);
    const engines = new Map<string, number>();
    for (const interval of this.intervals) {
      const ms = interval.to - Math.max(from, interval.from);
      for (const [engine, load] of interval.loads)
        engines.set(engine, (engines.get(engine) ?? 0) + load * ms);
    }
    return Math.min(100, (Math.max(0, ...engines.values()) / (at - from)) * 100);
  }
}
