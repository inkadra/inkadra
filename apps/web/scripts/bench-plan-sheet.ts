// Times the set plan's sheet in plain Node, without Vite or a DOM, as a server would make it
// (the server's PDF, step 1): reading the board, laying out the pages, writing the PDF.
//   pnpm --filter @inkadra/web bench:plan-sheet                (the fixture, then 300 icons)
//   pnpm --filter @inkadra/web bench:plan-sheet --icons 300 --runs 20
// Each size runs in a process of its own, so the first run is cold (fonts parsed, code not yet
// optimised) and the peak memory is that size's. Run it with the Node of the server's image
// (Dockerfile, the node base image).
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    icons: { type: 'string' },
    runs: { type: 'string', default: '20' },
  },
});

if (values.icons === undefined || !process.env.TSX_TSCONFIG_PATH) {
  // Each size in a fresh process, with a tsconfig that covers the packages' TSX too.
  for (const icons of values.icons === undefined ? ['0', '300'] : [values.icons])
    execFileSync(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        '--icons',
        icons,
        '--runs',
        values.runs,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
        },
      },
    );
  process.exit(0);
}

// What Vite gives the web and plain Node does not: `?url` imports (the font files, fetched by
// name) and stylesheets (nothing).
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?url'))
      return {
        url: `data:text/javascript,export default ${encodeURIComponent(JSON.stringify(specifier))}`,
        shortCircuit: true,
      };
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,', shortCircuit: true };
    return next(specifier, context);
  },
});

const started = performance.now();
const { bigPlanFixture, planSheetFixture } = await import(
  '@inkadra/canvas-core/fixtures/plan-sheet'
);
const { FLOOR_PLAN_JPEG, fileFetch, packageFile, sheetRequest } = await import(
  '../src/board/export/plan-sheet-node.fixture.ts'
);
const { buildPages } = await import('../src/board/export/engine.ts');
const { renderPdf } = await import('../src/board/export/render-pdf.ts');
const { BoardStore } = await import('../src/board/store.ts');
const { PDFDocument, PDFDict, PDFName, PDFRawStream } = await import('pdf-lib');
const Y = await import('yjs');
const importMs = performance.now() - started;
globalThis.fetch = fileFetch;

const icons = Number(values.icons);
const runs = Number(values.runs);
const fixture = icons > 0 ? bigPlanFixture(icons) : planSheetFixture();
const update = Y.encodeStateAsUpdate(fixture.doc);
const MB = 1024 * 1024;
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});

interface Sample {
  read: number;
  layout: number;
  pdf: number;
  heapLayout: number;
  heapPdf: number;
  bytes: number;
  ops: number;
}

const countOps = (ops: readonly { kind: string; ops?: unknown }[]): number =>
  ops.reduce((n, op) => n + 1 + (op.kind === 'clip' ? countOps(op.ops as typeof ops) : 0), 0);

async function once(): Promise<Sample> {
  gc();
  const heap0 = process.memoryUsage().heapUsed;
  let t = performance.now();
  // What the server would do first: the stored board decoded, then read as the web reads it.
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  new BoardStore(doc);
  const read = performance.now() - t;
  const { req, env } = await sheetRequest({ doc, planIds: fixture.planIds }, 'team', 'en');
  t = performance.now();
  const built = await buildPages(req, env);
  const layout = performance.now() - t;
  const heapLayout = process.memoryUsage().heapUsed - heap0;
  const images = new Map(built.images);
  images.set(fixture.backgroundId, { width: 48, height: 32, bytes: FLOOR_PLAN_JPEG, type: 'jpeg' });
  t = performance.now();
  const bytes = await renderPdf(built.pages, built.fonts.bytes, images, {
    title: env.boardTitle,
    author: env.projectName,
    subject: env.t('export.kindBoard'),
    language: env.language,
  });
  const pdf = performance.now() - t;
  const heapPdf = process.memoryUsage().heapUsed - heap0;
  const ops = built.pages.reduce((n, p) => n + countOps(p.ops), 0);
  return { read, layout, pdf, heapLayout, heapPdf, bytes: bytes.length, ops };
}

const ms = (v: number) => `${v.toFixed(1)} ms`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

const cold = await once();
const warm: Sample[] = [];
for (let n = 0; n < runs; n++) warm.push(await once());
const usage = process.memoryUsage();
const peak = process.resourceUsage().maxRSS / 1024;

console.log(
  `\n${icons > 0 ? `${icons} icons` : 'fixture'}, 3 setups, Node ${process.versions.node}, ${runs} warm runs`,
);
console.log(
  `  board: ${(update.length / 1024).toFixed(1)} KB of Yjs update; ${cold.ops} drawing operations on 3 pages`,
);
console.log(`  modules imported in ${ms(importMs)}`);
console.table({
  'read the board': { cold: ms(cold.read), 'warm (median)': ms(median(warm.map((s) => s.read))) },
  'lay out (buildPages)': {
    cold: ms(cold.layout),
    'warm (median)': ms(median(warm.map((s) => s.layout))),
  },
  'write the PDF (renderPdf)': {
    cold: ms(cold.pdf),
    'warm (median)': ms(median(warm.map((s) => s.pdf))),
  },
});
console.log(
  `  heap grown by layout ${(cold.heapLayout / MB).toFixed(1)} MB cold, ` +
    `${(median(warm.map((s) => s.heapLayout)) / MB).toFixed(1)} MB warm; by layout + PDF ` +
    `${(cold.heapPdf / MB).toFixed(1)} MB cold, ${(median(warm.map((s) => s.heapPdf)) / MB).toFixed(1)} MB warm`,
);
console.log(
  `  process: peak RSS ${peak.toFixed(0)} MB, RSS now ${(usage.rss / MB).toFixed(0)} MB, ` +
    `heap ${(usage.heapUsed / MB).toFixed(0)} of ${(usage.heapTotal / MB).toFixed(0)} MB`,
);
console.log(`  PDF: ${(cold.bytes / 1024).toFixed(1)} KB (background 48 × 32 px JPEG)`);

if (icons === 0) {
  // Fonts: the files the web fetches and what the sheet embeds of them.
  const { built, env } = await (async () => {
    const r = await sheetRequest(fixture, 'team', 'en');
    return { ...r, built: await buildPages(r.req, r.env) };
  })();
  const plain = await renderPdf(built.pages, built.fonts.bytes, new Map(), {
    title: env.boardTitle,
    author: '',
    subject: '',
    language: 'en',
  });
  const doc = await PDFDocument.load(plain);
  let embedded = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor'))
      continue;
    const program = obj.lookup(PDFName.of('FontFile2')) ?? obj.lookup(PDFName.of('FontFile3'));
    if (program instanceof PDFRawStream) embedded += program.getContentsSize();
  }
  const sizes = Object.fromEntries(
    ['400Regular', '500Medium', '600SemiBold', '700Bold'].map((name) => [
      name,
      {
        TTF: `${(packageFile(`@expo-google-fonts/inter/${name}/Inter_${name}.ttf`).length / 1024).toFixed(1)} KB`,
      },
    ]),
  );
  console.log('\nFonts (Inter, @expo-google-fonts/inter 0.4.2, OFL-1.1)');
  console.table(sizes);
  console.log(
    `  the fixture's PDF embeds ${(embedded / 1024).toFixed(1)} KB of Inter subsets (4 weights) in ${(plain.length / 1024).toFixed(1)} KB`,
  );
}
