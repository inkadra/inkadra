import { describe, expect, it } from 'vitest';
import { DENSE, type DenseResult, evaluateDense, formatDense, sameState } from './dense.ts';

const result = (over: Partial<DenseResult> = {}): DenseResult => ({
  preset: 'dense',
  url: 'https://test.example',
  durationS: 60,
  editors: 15,
  readers: 3,
  boards: 1,
  edits: 900,
  editMs: [5, 6, 7],
  deliveryMs: [8, 9],
  switches: 18,
  uploads: { ok: 0, failed: 0 },
  errors: [],
  reconnects: 0,
  server: null,
  board: { elements: 1000, frames: 20, strokes: 15000, bytes: 7_500_000 },
  cursors: 12000,
  strokes: 180,
  burst: { clients: 18, unloaded: true, syncMs: 2500, converged: true, detail: null },
  eventLoopP99MaxMs: 120,
  eventLoopShared: true,
  ...over,
});

describe('sameState', () => {
  it('compares the clock of every client id', () => {
    const a = new Map([
      [1, 5],
      [2, 9],
    ]);
    expect(sameState(a, new Map([...a].reverse()))).toBe(true);
    expect(sameState(a, new Map([[1, 5]]))).toBe(false);
    expect(
      sameState(
        a,
        new Map([
          [1, 5],
          [2, 8],
        ]),
      ),
    ).toBe(false);
  });
});

describe('evaluateDense', () => {
  it('passes a healthy run and keeps the verdict last in the report', () => {
    expect(evaluateDense(result(), DENSE.limits)).toEqual([]);
    const text = formatDense(result(), DENSE.limits, []);
    expect(text).toContain('18 clients (board reloaded) synced in 2500 ms, converged');
    expect(text.split('\n').at(-1)).toBe('PASSED');
  });

  it('fails a slow, missing or diverging burst', () => {
    const slow = DENSE.limits.burstSyncMs + 1;
    expect(
      evaluateDense(
        result({
          burst: { clients: 18, unloaded: true, syncMs: slow, converged: true, detail: null },
        }),
        DENSE.limits,
      ),
    ).toEqual([`reconnect burst ${slow} ms > ${DENSE.limits.burstSyncMs} ms`]);
    expect(evaluateDense(result({ burst: null }), DENSE.limits)).toEqual([
      'the reconnect burst did not run',
    ]);
    const split = {
      clients: 18,
      unloaded: true,
      syncMs: 900,
      converged: false,
      detail: '2 clients differ',
    };
    expect(evaluateDense(result({ burst: split }), DENSE.limits)).toEqual([
      'reconnect burst did not converge: 2 clients differ',
    ]);
  });

  it('judges the event loop only when that process holds the boards', () => {
    const slow = DENSE.limits.eventLoopP99Ms + 1;
    expect(evaluateDense(result({ eventLoopP99MaxMs: slow }), DENSE.limits)).toHaveLength(1);
    expect(
      evaluateDense(result({ eventLoopP99MaxMs: slow, eventLoopShared: false }), DENSE.limits),
    ).toEqual([]);
  });
});
