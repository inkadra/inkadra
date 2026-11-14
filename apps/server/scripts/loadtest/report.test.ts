import { describe, expect, it } from 'vitest';
import {
  evaluate,
  formatReport,
  PRESETS,
  parseMetrics,
  percentile,
  type Result,
  readServer,
  summarizeServer,
} from './report.ts';

const metrics = (rss: number, boards: number, store?: [number, number, number]) =>
  [
    '# TYPE inkadra_process_heartbeat_age_seconds gauge',
    'inkadra_process_heartbeat_age_seconds{role="collab",host="c1"} 2',
    'inkadra_process_heartbeat_age_seconds{role="web",host="w1"} 1',
    // A process of last week: listed, but not alive.
    'inkadra_process_heartbeat_age_seconds{role="all",host="old"} 86400',
    `inkadra_process_resident_memory_bytes{role="collab",host="c1"} ${rss}`,
    'inkadra_process_resident_memory_bytes{role="web",host="w1"} 999999999',
    'inkadra_process_resident_memory_bytes{role="all",host="old"} 999999999',
    `inkadra_collab_open_boards{role="collab",host="c1"} ${boards}`,
    ...(store
      ? [
          `inkadra_board_store_seconds{role="collab",host="c1",stat="p95"} ${store[0]}`,
          `inkadra_board_store_seconds{role="collab",host="c1",stat="max"} ${store[1]}`,
          `inkadra_board_store_pool_wait_seconds{role="collab",host="c1"} ${store[2]}`,
        ]
      : []),
    'inkadra_database_connections 7',
  ].join('\n');

const MiB = 1024 ** 2;

const result = (over: Partial<Result> = {}): Result => ({
  preset: 'small',
  url: 'https://test.example',
  durationS: 60,
  editors: 5,
  readers: 2,
  boards: 50,
  edits: 300,
  editMs: Array.from({ length: 100 }, (_, i) => i + 1),
  deliveryMs: [10, 20, 30],
  switches: 12,
  uploads: { ok: 3, failed: 0 },
  errors: [],
  reconnects: 0,
  server: null,
  ...over,
});

describe('load test report (#902)', () => {
  it('takes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it('reads only the board roles alive now from /metrics', () => {
    const reading = readServer(parseMetrics(metrics(200 * MiB, 10, [0.04, 0.2, 0.003])));
    expect(reading).toEqual({
      rssBytes: 200 * MiB,
      openBoards: 10,
      storeP95Ms: 40,
      storeMaxMs: 200,
      poolWaitMaxMs: 3,
      dbConnections: 7,
    });
    expect(readServer(parseMetrics(metrics(1, 0))).storeP95Ms).toBeNull();
  });

  it('gives memory per open board as growth over the baseline at the peak', () => {
    const baseline = readServer(parseMetrics(metrics(100 * MiB, 0)));
    const summary = summarizeServer(baseline, [
      readServer(parseMetrics(metrics(150 * MiB, 20, [0.05, 0.1, 0.001]))),
      readServer(parseMetrics(metrics(140 * MiB, 25, [0.03, 0.3, 0.02]))),
    ]);
    expect(summary).toMatchObject({
      baselineRssMiB: 100,
      peakRssMiB: 150,
      peakOpenBoards: 25,
      perBoardMiB: 2.5,
      storeP95Ms: 50,
      storeMaxMs: 300,
      poolWaitMaxMs: 20,
      peakDbConnections: 7,
    });
  });

  it('gives no memory per board without a baseline', () => {
    const empty = readServer(parseMetrics('inkadra_database_connections 3'));
    const peak = readServer(parseMetrics(metrics(150 * MiB, 20)));
    expect(summarizeServer(empty, [peak]).perBoardMiB).toBeNull();
  });

  it('passes within the limits of the preset', () => {
    expect(evaluate(result(), PRESETS.small.limits)).toEqual([]);
  });

  it('lists every limit exceeded', () => {
    const failures = evaluate(
      result({
        editMs: [100, 2000],
        errors: ['board b1: permission denied'],
        reconnects: 9,
        server: {
          baselineRssMiB: 100,
          peakRssMiB: 2000,
          peakOpenBoards: 10,
          perBoardMiB: 12,
          storeP95Ms: 1200,
          storeMaxMs: 3000,
          poolWaitMaxMs: 50,
          peakDbConnections: 9,
        },
      }),
      PRESETS.small.limits,
    );
    expect(failures).toEqual([
      'edit round trip p95 2000 ms > 500 ms',
      'edit round trip p99 2000 ms > 1500 ms',
      'errors 1 > 0',
      'reconnects 9 > 5',
      'board save p95 1200 ms > 1000 ms',
      'peak memory 2000 MiB > 1024 MiB',
      'memory per open board 12 MiB > 8 MiB',
    ]);
  });

  it('fails a run where no edit was acknowledged', () => {
    expect(evaluate(result({ editMs: [] }), PRESETS.small.limits)).toEqual([
      'no edit was acknowledged',
    ]);
  });

  it('prints the numbers, the limits and the verdict', () => {
    const text = formatReport(result(), PRESETS.small.limits, []);
    expect(text).toContain('preset small');
    expect(text).toContain('p50 50 ms · p95 95 ms · p99 99 ms (100 samples)');
    expect(text).toContain('set METRICS_TOKEN');
    expect(text.endsWith('PASSED')).toBe(true);
    expect(formatReport(result(), PRESETS.small.limits, ['errors 1 > 0'])).toContain(
      'FAILED\n  errors 1 > 0',
    );
  });
});
