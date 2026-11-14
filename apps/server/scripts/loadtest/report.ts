// Presets, thresholds and the report of the load test (#902). No I/O: run.ts does that.

export interface Limits {
  /** Edit round trip: from a local edit until the server acknowledged it. */
  editP95Ms: number;
  editP99Ms: number;
  /** From a local edit until a reader on the same board received it. */
  deliveryP95Ms: number;
  /** Board saves to the database (from /metrics). */
  storeP95Ms: number;
  /** Longest wait of a board save for a pooled database connection (from /metrics). */
  poolWaitMaxMs: number;
  /** Peak resident memory of the processes holding boards (from /metrics). */
  rssMiB: number;
  /** Memory growth per open board (from /metrics). */
  perBoardMiB: number;
  errors: number;
  reconnects: number;
}

export interface Preset {
  editors: number;
  readers: number;
  boards: number;
  durationS: number;
  limits: Limits;
}

// Limits are generous on purpose: a CI runner is a shared 4-core machine, and the job is there to
// catch a regression of several times, not a few percent (docs/self-hosting/capacity.md).
export const PRESETS: Record<'small' | 'medium' | 'large', Preset> = {
  small: {
    editors: 5,
    readers: 2,
    boards: 50,
    durationS: 60,
    limits: {
      editP95Ms: 500,
      editP99Ms: 1500,
      deliveryP95Ms: 1000,
      storeP95Ms: 1000,
      poolWaitMaxMs: 1000,
      rssMiB: 1024,
      perBoardMiB: 8,
      errors: 0,
      reconnects: 5,
    },
  },
  medium: {
    editors: 20,
    readers: 4,
    boards: 200,
    durationS: 180,
    limits: {
      editP95Ms: 750,
      editP99Ms: 2000,
      deliveryP95Ms: 1500,
      storeP95Ms: 1500,
      poolWaitMaxMs: 2000,
      rssMiB: 1536,
      perBoardMiB: 8,
      errors: 0,
      reconnects: 20,
    },
  },
  large: {
    editors: 50,
    readers: 10,
    boards: 1000,
    durationS: 300,
    limits: {
      editP95Ms: 1500,
      editP99Ms: 4000,
      deliveryP95Ms: 3000,
      storeP95Ms: 3000,
      poolWaitMaxMs: 5000,
      rssMiB: 3072,
      perBoardMiB: 8,
      errors: 0,
      reconnects: 50,
    },
  },
};

export type PresetName = keyof typeof PRESETS;

/** Nearest-rank percentile; null without samples. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]!;
}

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** The Prometheus text format, as /metrics writes it (no timestamps, no escapes in our labels). */
export function parseMetrics(text: string): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split('\n')) {
    const m = /^([a-z_:][a-z0-9_:]*)(?:\{(.*)\})? (\S+)$/i.exec(line.trim());
    if (!m) continue;
    const labels: Record<string, string> = {};
    for (const [, k, v] of (m[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g))
      labels[k!] = v!.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
    out.push({ name: m[1]!, labels, value: Number(m[3]) });
  }
  return out;
}

/** What one scrape says about the processes that hold boards (`collab` and `all`). */
export interface ServerReading {
  rssBytes: number;
  openBoards: number;
  storeP95Ms: number | null;
  storeMaxMs: number | null;
  poolWaitMaxMs: number | null;
  dbConnections: number | null;
}

const BOARD_ROLES = new Set(['collab', 'all']);

export function readServer(samples: readonly Sample[]): ServerReading {
  // Heartbeats of the last 7 days are listed: only processes alive now count.
  const alive = new Set(
    samples
      .filter((s) => s.name === 'inkadra_process_heartbeat_age_seconds' && s.value < 30)
      .filter((s) => BOARD_ROLES.has(s.labels.role ?? ''))
      .map((s) => `${s.labels.role}@${s.labels.host}`),
  );
  const of = (name: string, stat?: string) =>
    samples.filter(
      (s) =>
        s.name === name &&
        alive.has(`${s.labels.role}@${s.labels.host}`) &&
        (stat === undefined || s.labels.stat === stat),
    );
  const sum = (name: string) => of(name).reduce((n, s) => n + s.value, 0);
  const max = (list: Sample[], scale = 1) =>
    list.length ? Math.max(...list.map((s) => s.value * scale)) : null;
  const connections = samples.find((s) => s.name === 'inkadra_database_connections');
  return {
    rssBytes: sum('inkadra_process_resident_memory_bytes'),
    openBoards: sum('inkadra_collab_open_boards'),
    storeP95Ms: max(of('inkadra_board_store_seconds', 'p95'), 1000),
    storeMaxMs: max(of('inkadra_board_store_seconds', 'max'), 1000),
    poolWaitMaxMs: max(of('inkadra_board_store_pool_wait_seconds'), 1000),
    dbConnections: connections ? connections.value : null,
  };
}

export interface ServerSummary {
  baselineRssMiB: number;
  peakRssMiB: number;
  peakOpenBoards: number;
  perBoardMiB: number | null;
  storeP95Ms: number | null;
  storeMaxMs: number | null;
  poolWaitMaxMs: number | null;
  peakDbConnections: number | null;
}

const MiB = 1024 ** 2;
const maxOf = (values: Array<number | null>) => {
  const list = values.filter((v): v is number => v !== null);
  return list.length ? Math.max(...list) : null;
};

/**
 * The baseline is read before any board opens. Memory per board is the growth at the peak over
 * the boards open then; it includes the sockets and presence of the people on them.
 * shortcut: each scrape sees the last 5 s of saves only; scrapes every 5 s may miss a window.
 */
export function summarizeServer(baseline: ServerReading, readings: ServerReading[]): ServerSummary {
  const peak = readings.reduce((a, b) => (b.rssBytes > a.rssBytes ? b : a), baseline);
  const peakOpenBoards = Math.max(0, ...readings.map((r) => r.openBoards));
  return {
    baselineRssMiB: baseline.rssBytes / MiB,
    peakRssMiB: peak.rssBytes / MiB,
    peakOpenBoards,
    perBoardMiB:
      peak.openBoards > 0
        ? Math.max(0, peak.rssBytes - baseline.rssBytes) / MiB / peak.openBoards
        : null,
    storeP95Ms: maxOf(readings.map((r) => r.storeP95Ms)),
    storeMaxMs: maxOf(readings.map((r) => r.storeMaxMs)),
    poolWaitMaxMs: maxOf(readings.map((r) => r.poolWaitMaxMs)),
    peakDbConnections: maxOf(readings.map((r) => r.dbConnections)),
  };
}

export interface Result {
  preset: PresetName;
  url: string;
  durationS: number;
  editors: number;
  readers: number;
  boards: number;
  edits: number;
  editMs: number[];
  deliveryMs: number[];
  switches: number;
  uploads: { ok: number; failed: number };
  errors: string[];
  reconnects: number;
  /** Null without METRICS_TOKEN. */
  server: ServerSummary | null;
}

/** Every limit the run exceeded, as one line each; empty when it passed. */
export function evaluate(r: Result, limits: Limits): string[] {
  const out: string[] = [];
  const over = (what: string, value: number | null, limit: number, unit: string) => {
    if (value !== null && value > limit)
      out.push(`${what} ${round(value)}${unit} > ${limit}${unit}`);
  };
  if (!r.editMs.length) out.push('no edit was acknowledged');
  over('edit round trip p95', percentile(r.editMs, 95), limits.editP95Ms, ' ms');
  over('edit round trip p99', percentile(r.editMs, 99), limits.editP99Ms, ' ms');
  over('delivery to readers p95', percentile(r.deliveryMs, 95), limits.deliveryP95Ms, ' ms');
  over('errors', r.errors.length, limits.errors, '');
  over('reconnects', r.reconnects, limits.reconnects, '');
  if (r.server) {
    over('board save p95', r.server.storeP95Ms, limits.storeP95Ms, ' ms');
    over('pool wait of a board save', r.server.poolWaitMaxMs, limits.poolWaitMaxMs, ' ms');
    over('peak memory', r.server.peakRssMiB, limits.rssMiB, ' MiB');
    over('memory per open board', r.server.perBoardMiB, limits.perBoardMiB, ' MiB');
  }
  return out;
}

const round = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
const show = (v: number | null, unit = '') => (v === null ? '–' : `${round(v)}${unit}`);

/** The short report printed at the end and kept by CI. */
export function formatReport(r: Result, limits: Limits, failures: string[]): string {
  const ms = (values: number[]) =>
    `p50 ${show(percentile(values, 50), ' ms')} · p95 ${show(percentile(values, 95), ' ms')} · p99 ${show(percentile(values, 99), ' ms')} (${values.length} samples)`;
  const lines = [
    `Inkadra load test · preset ${r.preset} · ${r.url}`,
    `${r.editors} editors, ${r.readers} readers, ${r.boards} boards, ${r.durationS} s`,
    '',
    `Edits                 ${r.edits} (${r.switches} board switches, ${r.uploads.ok} uploads, ${r.uploads.failed} failed)`,
    `Edit round trip       ${ms(r.editMs)}   limit p95 ${limits.editP95Ms} ms, p99 ${limits.editP99Ms} ms`,
    `Delivery to readers   ${ms(r.deliveryMs)}   limit p95 ${limits.deliveryP95Ms} ms`,
    `Errors                ${r.errors.length}   limit ${limits.errors}`,
    `Reconnects            ${r.reconnects}   limit ${limits.reconnects}`,
  ];
  if (r.server) {
    const s = r.server;
    lines.push(
      `Board saves           p95 ${show(s.storeP95Ms, ' ms')} · slowest ${show(s.storeMaxMs, ' ms')}   limit p95 ${limits.storeP95Ms} ms`,
      `Pool wait (saves)     slowest ${show(s.poolWaitMaxMs, ' ms')}   limit ${limits.poolWaitMaxMs} ms`,
      `Database connections  peak ${show(s.peakDbConnections)}`,
      `Memory (board roles)  ${show(s.baselineRssMiB, ' MiB')} before → peak ${show(s.peakRssMiB, ' MiB')}   limit ${limits.rssMiB} MiB`,
      `Per open board        ${show(s.perBoardMiB, ' MiB')} over ${s.peakOpenBoards} boards   limit ${limits.perBoardMiB} MiB`,
    );
  } else lines.push('Server                not measured: set METRICS_TOKEN to read /metrics');
  for (const e of r.errors.slice(0, 10)) lines.push(`  error: ${e}`);
  lines.push(
    '',
    failures.length ? `FAILED\n${failures.map((f) => `  ${f}`).join('\n')}` : 'PASSED',
  );
  return lines.join('\n');
}
