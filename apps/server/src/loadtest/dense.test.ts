import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DENSE,
  type DenseResult,
  evaluateDense,
  formatDense,
  sameDocument,
  seeded,
} from './dense.ts';

const result = (over: Partial<DenseResult> = {}): DenseResult => ({
  preset: 'dense',
  seed: 7,
  url: 'https://test.example',
  durationS: 60,
  editors: 15,
  readers: 3,
  boards: 1,
  edits: 900,
  editMs: Array.from({ length: 600 }, (_, i) => 5 + (i % 7)),
  deliveryMs: [8, 9],
  switches: 18,
  uploads: { ok: 0, failed: 0 },
  errors: [],
  reconnects: 0,
  server: null,
  board: { elements: 1000, frames: 20, strokes: 15000, bytes: 7_500_000 },
  cursors: 12000,
  pendingEdits: 0,
  strokes: 180,
  burst: { clients: 18, unloaded: true, syncMs: 2500, converged: true, detail: null },
  eventLoopP99MaxMs: 120,
  eventLoopShared: true,
  ...over,
});

describe('seeded', () => {
  it('repeats its numbers for a seed', () => {
    const a = seeded(42);
    const b = seeded(42);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seeded(43)()).not.toBe(first[0]);
  });
});

describe('sameDocument', () => {
  const pair = () => {
    const a = new Y.Doc();
    a.getArray<number>('list').insert(0, [1, 2, 3]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    return [a, b] as const;
  };

  it('holds for replicas with the same items and deletions', () => {
    const [a, b] = pair();
    a.getArray('list').delete(1, 1);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(sameDocument(a, b)).toBe(true);
  });

  it('tells a deletion that reached one replica only, with equal state vectors', () => {
    const [a, b] = pair();
    a.getArray('list').delete(1, 1);
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    expect(sameDocument(a, b)).toBe(false);
  });

  it('tells a missing insertion', () => {
    const [a, b] = pair();
    a.getArray<number>('list').push([4]);
    expect(sameDocument(a, b)).toBe(false);
  });
});

describe('evaluateDense', () => {
  it('passes a healthy run and keeps the verdict last in the report', () => {
    expect(evaluateDense(result(), DENSE.limits)).toEqual([]);
    const text = formatDense(result(), DENSE.limits, []);
    expect(text).toContain('18 clients (board reloaded) synced in 2500 ms, converged');
    expect(text.split('\n').at(-1)).toBe('PASSED');
    expect(text).toContain('Seed                  7');
    expect(text).toContain('18 openings of the board');
    expect(text).not.toContain('board switches');
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

  it('fails a run with too few timed edits or edits never acknowledged', () => {
    // 15 editors for 60 s: at least 450 of about 900 edits must come back timed.
    expect(evaluateDense(result({ editMs: [5, 6, 7] }), DENSE.limits)).toEqual([
      'only 3 edit round trips measured, at least 450 needed',
    ]);
    expect(evaluateDense(result({ pendingEdits: 2 }), DENSE.limits)).toEqual([
      '2 edits not acknowledged 30 s after the end of the run',
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
