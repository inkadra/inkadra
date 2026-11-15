import { describe, expect, it } from 'vitest';
import {
  evaluate,
  formatReport,
  PRESETS,
  parseMetrics,
  percentile,
  type Result,
  RSS_MIN_BOARDS,
  readServer,
  summarizeServer,
} from './report.ts';

const metrics = (
  rss: number,
  boards: number,
  store?: [number, number, number],
  { role = 'collab', boardBytes }: { role?: string; boardBytes?: number } = {},
) =>
  [
    '# TYPE inkadra_process_heartbeat_age_seconds gauge',
    `inkadra_process_heartbeat_age_seconds{role="${role}",host="c1"} 2`,
    'inkadra_process_heartbeat_age_seconds{role="web",host="w1"} 1',
    // A process of last week: listed, but not alive.
    'inkadra_process_heartbeat_age_seconds{role="all",host="old"} 86400',
    `inkadra_process_resident_memory_bytes{role="${role}",host="c1"} ${rss}`,
    'inkadra_process_resident_memory_bytes{role="web",host="w1"} 999999999',
    'inkadra_process_resident_memory_bytes{role="all",host="old"} 999999999',
    `inkadra_collab_open_boards{role="${role}",host="c1"} ${boards}`,
    ...(boardBytes === undefined
      ? []
      : [`inkadra_collab_open_board_bytes{role="${role}",host="c1"} ${boardBytes}`]),
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
      boardBytes: null,
      shared: false,
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
      perBoardInfo: null,
      docPerBoardKiB: null,
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

  const server = (over: Partial<NonNullable<Result['server']>> = {}) => ({
    baselineRssMiB: 184,
    peakRssMiB: 271,
    peakOpenBoards: 6,
    perBoardMiB: 14.5,
    perBoardInfo: null,
    docPerBoardKiB: 20,
    storeP95Ms: 49,
    storeMaxMs: 60,
    poolWaitMaxMs: 3,
    peakDbConnections: 9,
    ...over,
  });

  it('reads the size of the open board documents (#911)', () => {
    const baseline = readServer(parseMetrics(metrics(100 * MiB, 0, undefined, { boardBytes: 0 })));
    const summary = summarizeServer(baseline, [
      readServer(parseMetrics(metrics(150 * MiB, 20, undefined, { boardBytes: 20 * 30_720 }))),
      readServer(parseMetrics(metrics(160 * MiB, 25, undefined, { boardBytes: 25 * 40_960 }))),
    ]);
    expect(summary.docPerBoardKiB).toBe(40);
    expect(summary.perBoardInfo).toBeNull();
  });

  it('keeps memory growth per board as information with an all-in-one process (#911)', () => {
    const all = (rss: number, boards: number) =>
      readServer(parseMetrics(metrics(rss, boards, undefined, { role: 'all' })));
    expect(all(1, 0).shared).toBe(true);
    const summary = summarizeServer(all(100 * MiB, 0), [all(400 * MiB, 30)]);
    expect(summary).toMatchObject({ perBoardMiB: 10, perBoardInfo: 'shared_process' });
    const r = result({ server: server({ perBoardMiB: 14.5, perBoardInfo: 'shared_process' }) });
    expect(evaluate(r, PRESETS.small.limits)).toEqual([]);
    expect(formatReport(r, PRESETS.small.limits, [])).toContain(
      'Per open board        14.5 MiB over 6 boards   (info) memory growth of a process shared',
    );
  });

  it('keeps memory growth per board as information with few boards open (#911)', () => {
    const baseline = readServer(parseMetrics(metrics(100 * MiB, 0)));
    const few = summarizeServer(baseline, [
      readServer(parseMetrics(metrics(190 * MiB, RSS_MIN_BOARDS - 1))),
    ]);
    expect(few.perBoardInfo).toBe('few_boards');
    const enough = summarizeServer(baseline, [
      readServer(parseMetrics(metrics(400 * MiB, RSS_MIN_BOARDS))),
    ]);
    expect(enough.perBoardInfo).toBeNull();
    expect(
      evaluate(result({ server: server({ perBoardInfo: 'few_boards' }) }), PRESETS.small.limits),
    ).toEqual([]);
    // With enough boards on a process of their own, it decides again.
    expect(evaluate(result({ server: server() }), PRESETS.small.limits)).toEqual([
      'memory per open board 14.5 MiB > 8 MiB',
    ]);
  });

  it('fails on board documents larger than the limit (#911)', () => {
    const r = result({
      server: server({ perBoardInfo: 'shared_process', docPerBoardKiB: 3000 }),
    });
    expect(evaluate(r, PRESETS.small.limits)).toEqual(['board document size 3000 KiB > 256 KiB']);
    expect(formatReport(r, PRESETS.small.limits, [])).toContain(
      'Board documents       3000 KiB per open board (Yjs, encoded)   limit 256 KiB',
    );
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
          peakOpenBoards: 30,
          perBoardMiB: 12,
          perBoardInfo: null,
          docPerBoardKiB: 2048,
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
      'board document size 2048 KiB > 256 KiB',
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
