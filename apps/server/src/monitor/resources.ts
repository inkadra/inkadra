import { readFile } from 'node:fs/promises';
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
