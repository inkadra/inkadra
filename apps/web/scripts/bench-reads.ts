// Times the reads of a board on the reference boards (decision 0093, docs/testing/reference-board.md):
//   pnpm --filter @inkadra/doc-schema reference-board --size medium   (and --size large)
//   pnpm --filter @inkadra/web bench:reads [--sizes medium,large] [--zod-jitless]
// Without a JIT, as Hermes runs on iOS: node --jitless --import tsx scripts/bench-reads.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const { values } = parseArgs({
  options: {
    boards: { type: 'string', default: '../../packages/doc-schema/reference-boards' },
    sizes: { type: 'string', default: 'small,medium,large' },
    seed: { type: 'string', default: '1' },
    runs: { type: 'string', default: '40' },
    // Zod without `new Function`, as on an engine that forbids eval.
    'zod-jitless': { type: 'boolean', default: false },
    baseline: { type: 'boolean', default: false },
    hydrate: { type: 'boolean', default: false },
    // Only the first table (the open breakdown is the slow part without a JIT).
    'no-breakdown': { type: 'boolean', default: false },
  },
});
if (values.baseline && values.hydrate) throw new Error('--baseline and --hydrate are exclusive');
// Before the schemas are built: Zod decides on its compiled fast path when it builds them.
if (values['zod-jitless']) z.config({ jitless: true });
const { addStroke, createElement, deleteElements, removeStrokes, setTableCell } = await import(
  '@inkadra/canvas-core'
);
const { checkCard, readElement, roots } = await import('@inkadra/doc-schema');
const Y = await import('yjs');
// For comparisons, extract the base revision's store beside store.ts (do not commit it).
const { BoardStore, LOCAL } = await import(
  values.baseline ? '../src/board/store-baseline.ts' : '../src/board/store.ts'
);
const runs = Number(values.runs);
const jitless = process.execArgv.includes('--jitless');

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const time = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
/** Median of `n` timed calls after 3 untimed ones; `undo` runs untimed after each call. */
const repeat = (n: number, f: (i: number) => void, undo: () => void) => {
  const out: number[] = [];
  for (let i = 0; i < n + 3; i++) {
    const ms = time(() => f(i));
    undo();
    if (i >= 3) out.push(ms);
  }
  return median(out);
};
const ms = (x: number) => (x < 10 ? x.toFixed(2) : x.toFixed(0));
const breakdown: string[] = [];

/**
 * Measures how long the thread stays blocked, whatever schedules the work: an immediate that
 * queues itself again runs once per turn of the event loop, so the longest time between two
 * runs is the longest slice (scheduling included).
 */
function blockingProbe() {
  let longest = 0;
  let last = performance.now();
  let on = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (on) setImmediate(tick);
  };
  setImmediate(tick);
  return () => {
    on = false;
    tick();
    return longest;
  };
}

console.log(
  `node ${process.version}${jitless ? ' --jitless' : ''}, zod fast path (allowsEval and not jitless): ${String(
    z.core.util.allowsEval.value && !values['zod-jitless'],
  )}`,
);
console.log(
  '| board | open: applyUpdate | open: first read | open: total | open: longest slice | hydrate: longest gap | add stroke | edit cell | createElement | strict: every card | strict: frame after a stroke | strict: table after a cell |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const size of values.sizes.split(',')) {
  const base = resolve(values.boards, `reference-board-${size}-${values.seed}`);
  if (!existsSync(`${base}.ybin`))
    throw new Error(`${base}.ybin is missing: run the reference-board script first.`);
  const update = new Uint8Array(readFileSync(`${base}.ybin`));
  const { bench } = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as {
    bench: { frameId: string; tableId: string };
  };

  const opens = Math.max(3, Math.round(runs / 8));
  const applies: number[] = [];
  const reads: number[] = [];
  const totals: number[] = [];
  const slices: number[] = [];
  const hydrationGaps: number[] = [];
  const stricts: number[] = [];
  let doc = new Y.Doc();
  let store: InstanceType<typeof BoardStore> | undefined;
  for (let i = 0; i < opens; i++) {
    store?.destroy();
    doc.destroy();
    doc = new Y.Doc();
    const d = doc;
    applies.push(time(() => Y.applyUpdate(d, update)));
    let gap = 0;
    if (values.hydrate) {
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        gap = Math.max(gap, now - last);
        last = now;
      };
      const timer = setInterval(tick, 0);
      const start = performance.now();
      store = BoardStore.hydrate(d, { budgetMs: 8 });
      await store.whenHydrated;
      reads.push(performance.now() - start);
      tick();
      clearInterval(timer);
      hydrationGaps.push(gap);
      slices.push(Math.max(applies[i]!, gap));
    } else {
      reads.push(
        time(() => {
          store = new BoardStore(d);
        }),
      );
      slices.push(applies[i]! + reads[i]!);
    }
    totals.push(applies[i]! + reads[i]!);
    // The strict check of every card once, as a client that writes does on open (decision 0101).
    stricts.push(
      time(() => {
        for (const map of roots(d).elements.values()) checkCard(map);
      }),
    );
  }

  const stroke = {
    tool: 'pencil' as const,
    color: '#202020',
    width: 4,
    points: [10, 10, 400, 380, 900, 820],
  };
  let strokeId: string | null = null;
  const addOne = repeat(
    runs,
    () => {
      strokeId = addStroke(doc, bench.frameId, stroke, LOCAL);
    },
    () => strokeId && removeStrokes(doc, bench.frameId, [strokeId], LOCAL),
  );

  const rows = roots(doc).elements.get(bench.tableId)?.get('rows') as Y.Array<Y.Map<unknown>>;
  const row = rows.get(Math.floor(rows.length / 2)).get('id') as string;
  const columns = roots(doc).elements.get(bench.tableId)?.get('columns') as Y.Array<Y.Map<unknown>>;
  const column = columns.get(0).get('id') as string;
  const cell = repeat(
    runs,
    (i) => setTableCell(doc, bench.tableId, row, column, `Cella ${i}`, LOCAL),
    () => {},
  );

  // The strict check of the edited card: walked again after each change, then remembered.
  const frameMap = roots(doc).elements.get(bench.frameId)!;
  strokeId = addStroke(doc, bench.frameId, stroke, LOCAL);
  const strictStroke = repeat(
    runs,
    () => checkCard(frameMap),
    () => {
      if (strokeId) removeStrokes(doc, bench.frameId, [strokeId], LOCAL);
      strokeId = addStroke(doc, bench.frameId, stroke, LOCAL);
    },
  );
  if (strokeId) removeStrokes(doc, bench.frameId, [strokeId], LOCAL);
  const tableMap = roots(doc).elements.get(bench.tableId)!;
  let edits = 0;
  const strictCell = repeat(
    runs,
    () => checkCard(tableMap),
    () => setTableCell(doc, bench.tableId, row, column, `Cella ${edits++}`, LOCAL),
  );

  let created = '';
  const create = repeat(
    runs,
    () => {
      created = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null, origin: LOCAL }).id;
    },
    () => deleteElements(doc, [created], LOCAL),
  );

  console.log(
    `| ${size} | ${ms(median(applies))} ms | ${ms(median(reads))} ms | ${ms(median(totals))} ms | ${ms(Math.max(...slices))} ms | ${values.hydrate ? `${ms(Math.max(...hydrationGaps))} ms` : '—'} | ${ms(addOne)} ms | ${ms(cell)} ms | ${ms(create)} ms | ${ms(median(stricts))} ms | ${ms(strictStroke)} ms | ${ms(strictCell)} ms |`,
  );
  store?.destroy();
  if (!values['no-breakdown'] && !values.baseline)
    breakdown.push(await openBreakdown(size, update, bench));
}

if (breakdown.length) {
  console.log(
    '\n| board | applyUpdate | validation | index | sync read | hydrate: total / longest slice | first stroke after open |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const line of breakdown) console.log(line);
}

/**
 * Where an open goes (decision 0104), medians of fresh opens: applyUpdate; validation, every
 * card read once with readElement; the index alone; the synchronous store; the opt-in
 * hydration (total, longest blocking slice); the first stroke drawn after an open.
 */
async function openBreakdown(
  size: string,
  update: Uint8Array,
  bench: { frameId: string; tableId: string },
): Promise<string> {
  const opens = Math.max(3, Math.round(runs / 8));
  const fresh = () => {
    const d = new Y.Doc();
    const t = performance.now();
    Y.applyUpdate(d, update);
    return [d, performance.now() - t] as const;
  };
  const stroke = { tool: 'pencil' as const, color: '#202020', width: 4, points: [1, 2, 3, 4] };
  const r: Record<string, number[]> = {};
  const add = (k: string, v: number) => {
    r[k] ??= [];
    r[k].push(v);
  };
  for (let i = 0; i < opens; i++) {
    let [d, apply] = fresh();
    add('apply', apply);
    add(
      'validate',
      time(() => {
        for (const map of roots(d).elements.values()) readElement(map);
      }),
    );
    d.destroy();
    let s: InstanceType<typeof BoardStore> | undefined;
    [d] = fresh();
    const stop = blockingProbe();
    const t = performance.now();
    s = BoardStore.hydrate(d, { budgetMs: 8 });
    await s.whenHydrated;
    add('hydrateTotal', performance.now() - t);
    add('hydrateSlice', stop());
    s.destroy();
    d.destroy();
    [d] = fresh();
    add(
      'sync',
      time(() => {
        s = new BoardStore(d);
      }),
    );
    const byId = new Map(s!.getSnapshot().byId);
    const priv = s as unknown as { snapshot: unknown; index(b: Map<string, unknown>): void };
    const kept = priv.snapshot;
    priv.snapshot = { byId: new Map(), canvas: [], columns: new Map(), unsorted: [] };
    add(
      'index',
      time(() => priv.index(byId)),
    );
    priv.snapshot = kept;
    add(
      'stroke',
      time(() => addStroke(d, bench.frameId, stroke, LOCAL)),
    );
    s!.destroy();
    d.destroy();
  }
  const med = (k: string) => (r[k] ? `${ms(median(r[k]))} ms` : '—');
  const max = (k: string) => (r[k] ? `${ms(Math.max(...r[k]))} ms` : '—');
  return `| ${size} | ${med('apply')} | ${med('validate')} | ${med('index')} | ${med('sync')} | ${med('hydrateTotal')} / ${max('hydrateSlice')} | ${med('stroke')} |`;
}
