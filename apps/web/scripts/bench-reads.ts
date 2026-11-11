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
  },
});
if (values.baseline && values.hydrate) throw new Error('--baseline and --hydrate are exclusive');
// Before the schemas are built: Zod decides on its compiled fast path when it builds them.
if (values['zod-jitless']) z.config({ jitless: true });
const { addStroke, createElement, deleteElements, removeStrokes, setTableCell } = await import(
  '@inkadra/canvas-core'
);
const { roots } = await import('@inkadra/doc-schema');
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

console.log(
  `node ${process.version}${jitless ? ' --jitless' : ''}, zod fast path (allowsEval and not jitless): ${String(
    z.core.util.allowsEval.value && !values['zod-jitless'],
  )}`,
);
console.log(
  '| board | open: applyUpdate | open: first read | open: total | open: longest slice | hydrate: longest gap | add stroke | edit cell | createElement |',
);
console.log('|---|---|---|---|---|---|---|---|---|');
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

  let created = '';
  const create = repeat(
    runs,
    () => {
      created = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null, origin: LOCAL }).id;
    },
    () => deleteElements(doc, [created], LOCAL),
  );

  console.log(
    `| ${size} | ${ms(median(applies))} ms | ${ms(median(reads))} ms | ${ms(median(totals))} ms | ${ms(Math.max(...slices))} ms | ${values.hydrate ? `${ms(Math.max(...hydrationGaps))} ms` : '—'} | ${ms(addOne)} ms | ${ms(cell)} ms | ${ms(create)} ms |`,
  );
  store?.destroy();
}
