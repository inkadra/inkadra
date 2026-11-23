import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { seedPerfBoard, startPeers } from './seed.ts';

/**
 * Gate 0.2: a board with 1000 elements, 500 of them images, opens fast (the bar below is set
 * for shared CI runners) and stays smooth while panning and zooming.
 *
 * The dense measurement after it: the same board with a storyboard of frames drawn with several
 * hundred strokes each, and three other people moving their cursors while frames are timed. It
 * has bars of its own (DENSE_*), so the gate above keeps judging what it always judged. The numbers land in e2e/perf-results.json and in the job log.
 *
 * The perf project blocks service workers (playwright.config.ts). The worker's first install
 * downloads the whole build while the board opens, which would make the timings depend on
 * when it happens to run; and controlled or not, the API, the image variants and /collab
 * never pass through it (static routes, decision 0015), so the numbers are the app's own.
 */

// The best of three warm opens, after one cold open that is recorded but not judged. Across 55
// green and red CI runs (2026-11-01/02) the best warm open ranged from about 900 ms on fast
// runners to 2021 ms on the slowest; the median warm open was about 1400 ms. 2500 ms leaves
// headroom for slow runners and still fails if opening gets twice as slow on a typical runner.
const OPEN_LIMIT_MS = Number(process.env.PERF_OPEN_LIMIT_MS ?? 2500);
// Frames are timed in headless Chromium on a CI runner, without a GPU: rasterising is done on
// the CPU, so the bar is a floor that catches regressions, not the 60 fps of a real browser.
// On average at least 25 fps, and 95% of frames under 70 ms (no visible stall).
const FRAME_AVG_LIMIT_MS = Number(process.env.PERF_FRAME_AVG_LIMIT_MS ?? 40);
const FRAME_P95_LIMIT_MS = Number(process.env.PERF_FRAME_P95_LIMIT_MS ?? 70);
// The frame limits judge the canvas with the floating glass's blur off, on purpose. Without a GPU
// the blur is the frame time; with one it hardly counts, so judging it here fails at random and
// says nothing about real browsers. Same workstation, 2026-11-04, three runs each, pan:
//   software (as in CI)  21.94 ms average, p95 up to 49.9 ms with blur; 16.67 and 16.80 ms without
//   RTX 3090, no vsync   12.73 ms average, p95 14.93 ms with blur; 12.55 and 14.67 ms without
// and zoom on the RTX 3090, the worst case: 16.28 and 20.60 ms with blur, 16.09 and 20.07 without,
// about 0.5 ms a frame at most. The series with glass is still recorded in perf-results.json,
// not judged. This loosens the check: nothing here measures glass on a weak GPU.
const NO_BLUR = 'none';
// The dense board: 8 frames of 300 to 600 strokes (about 3600 in all) and 3 remote peers moving
// their cursors every 50 ms through the collaboration server. Bars from runs on CI runners
// (docs/testing/canvas-performance.md), with the headroom of the gate's.
// It only reports for now: its bars come from a handful of runs, so passing one writes a warning
// and the job summary, and fails nothing. PERF_DENSE_GATE=1 judges it. Turn it on in CI once
// about ten runs of main in a row (the nightly CI run and merges) stay within the bars.
const DENSE_GATE = process.env.PERF_DENSE_GATE === '1';
/** A round lasts several seconds; a peer moving every 50 ms makes far more moves than this. */
const MIN_PEER_MOVES = 20;
const DENSE_FRAMES = 8;
const DENSE_PEERS = Number(process.env.PERF_DENSE_PEERS ?? 3);
const DENSE_OPEN_LIMIT_MS = Number(process.env.PERF_DENSE_OPEN_LIMIT_MS ?? 4000);
const DENSE_FRAME_AVG_LIMIT_MS = Number(process.env.PERF_DENSE_FRAME_AVG_LIMIT_MS ?? 60);
const DENSE_FRAME_P95_LIMIT_MS = Number(process.env.PERF_DENSE_FRAME_P95_LIMIT_MS ?? 120);

const resultsPath = fileURLToPath(new URL('../../perf-results.json', import.meta.url));

interface FrameStats {
  frames: number;
  avg: number;
  p95: number;
  max: number;
}

type Metrics = Record<string, number>;
type Timed = FrameStats & { mainThreadMs: Record<string, number> };
type Series = { pan: Timed; zoom: Timed; panAt100: Timed };
const TRACKED = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration'];

/** Main-thread time spent per kind of work between two snapshots, in ms. */
function spent(before: Metrics, after: Metrics) {
  return Object.fromEntries(
    TRACKED.map((k) => [k, Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000)]),
  );
}

/** Sets the token behind the glass (null: back to the stylesheet) and counts what still blurs. */
function setFloatBlur(page: Page, value: string | null): Promise<number> {
  return page.evaluate((value) => {
    const root = document.documentElement;
    if (value === null) root.style.removeProperty('--ink-float-blur');
    else root.style.setProperty('--ink-float-blur', value);
    let blurred = 0;
    for (const el of document.querySelectorAll('*'))
      for (const pseudo of [undefined, '::before', '::after'])
        if (!['', 'none'].includes(getComputedStyle(el, pseudo).backdropFilter)) blurred += 1;
    return blurred;
  }, value);
}

/** Sends one wheel event per animation frame and times the frames in between. */
function wheelFrames(page: Page, frames: number, zoom: boolean): Promise<FrameStats> {
  return page.evaluate(
    ({ frames, zoom }) =>
      new Promise<FrameStats>((resolve) => {
        const canvas = document.querySelector('[data-testid="canvas"]') as HTMLElement;
        const box = canvas.getBoundingClientRect();
        const times: number[] = [];
        let last = 0;
        let n = 0;
        const step = (now: number) => {
          if (last) times.push(now - last);
          last = now;
          if (n++ >= frames) {
            const sorted = [...times].sort((a, b) => a - b);
            const pick = (q: number) =>
              sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
            resolve({
              frames: times.length,
              avg: times.reduce((s, t) => s + t, 0) / Math.max(times.length, 1),
              p95: pick(0.95),
              max: sorted[sorted.length - 1] ?? 0,
            });
            return;
          }
          const phase = Math.floor(n / (frames / 4)) % 2 === 0 ? 1 : -1;
          canvas.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
              deltaX: zoom ? 0 : 24 * phase,
              deltaY: zoom ? 6 * phase : 18 * phase,
              ctrlKey: zoom,
            }),
          );
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { frames, zoom },
  );
}

/**
 * Seeds a board, opens it four times and times frames while panning and zooming. With `glass`,
 * the series runs again with the floating glass's blur on (recorded, not judged).
 */
async function measure(
  page: Page,
  base: string,
  options: { drawnFrames: number; peers: number; glass: boolean; alternate?: boolean },
) {
  const seeded = await seedPerfBoard(base, { drawnFrames: options.drawnFrames });

  const url = new URL(base);
  await page.context().addCookies(
    seeded.cookie.split('; ').map((pair) => {
      const at = pair.indexOf('=');
      return {
        name: pair.slice(0, at),
        value: pair.slice(at + 1),
        domain: url.hostname,
        path: '/',
      };
    }),
  );

  // Shared CI runners vary by a second from run to run, and the first open also pays for the
  // cold HTTP and JS caches. The first open is a warm-up; the best of the next three is judged,
  // since runner noise only ever adds time. Every sample is kept in the results.
  const openSamples: number[] = [];
  for (let i = 0; i < 4; i++) {
    // Same path every time: no saved viewport, so each open fits the board like a first visit.
    if (i > 0) await page.evaluate(() => localStorage.clear());
    const started = Date.now();
    await page.goto(`/p/${seeded.projectId}`);
    await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-el]').first()).toBeVisible();
    openSamples.push(Date.now() - started);
  }
  const [coldOpenMs = Number.POSITIVE_INFINITY, ...warmOpens] = openSamples;
  const openMs = Math.min(...warmOpens);
  const rendered = await page.locator('[data-el]').count();

  // Let images and measurements settle before timing frames.
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async (): Promise<Metrics> => {
    const { metrics: list } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(list.map((m) => [m.name, m.value]));
  };
  const timed = async (frames: number, zoom: boolean) => {
    const before = await metrics();
    const stats = await wheelFrames(page, frames, zoom);
    return { ...stats, mainThreadMs: spent(before, await metrics()) };
  };

  // First the whole board in view (the first visit fits it), then at 100% over dense content.
  const series = async () => {
    const pan = await timed(120, false);
    const zoom = await timed(60, true);
    await page.keyboard.press('Shift+Digit0');
    await page.waitForTimeout(500);
    return { pan, zoom, panAt100: await timed(120, false) };
  };

  // One series with `peers` others on the board; with `alternate`, four on the same page and
  // board: without them, with them, without, with, so their cost is read on one runner. The
  // peers join after the opens are timed and leave after each series.
  const rounds = options.alternate ? [0, options.peers, 0, options.peers] : [options.peers];
  // Fails if the token stops driving the blur, rather than measuring glass by accident.
  expect(await setFloatBlur(page, NO_BLUR)).toBe(0);
  const measured: Array<{ peers: number; peerCursorMoves: number } & Series> = [];
  for (const [i, count] of rounds.entries()) {
    if (i > 0) {
      // Back to the whole board, as the first series starts.
      await page.keyboard.press('Shift+Digit1');
      await page.waitForTimeout(500);
    }
    const peers = count ? await startPeers(base, seeded.cookie, seeded.boardId, count) : null;
    try {
      // Their cursors are drawn (or gone) before anything is timed.
      if (count || i > 0) await expect(page.locator('.peer-cursor')).toHaveCount(count);
      const before = peers?.state() ?? [];
      const timed = await series();
      const after = peers?.state() ?? [];
      // Every peer stayed connected and synced and kept moving through the whole round, or the
      // round measured nothing: this fails the test even while the dense bars only report.
      const moved = after.map((p, n) => p.moves - (before[n]?.moves ?? 0));
      const dropped = after.map((p, n) => p.drops - (before[n]?.drops ?? 0));
      expect(
        after.every((p, n) => p.live && dropped[n] === 0 && (moved[n] ?? 0) >= MIN_PEER_MOVES),
        `could not measure: per peer, moves ${moved.join(', ')}, connections lost ${dropped.join(', ')}, connected at the end ${after.map((p) => p.live).join(', ')}`,
      ).toBe(true);
      measured.push({ peers: count, ...timed, peerCursorMoves: moved.reduce((a, b) => a + b, 0) });
    } finally {
      peers?.stop();
    }
  }
  const [{ peers: _p, peerCursorMoves: _m, ...judged }] = measured as [(typeof measured)[number]];

  let withGlass: ({ judged: false; blurredSurfaces: number } & Series) | undefined;
  if (options.glass) {
    const blurredSurfaces = await setFloatBlur(page, null);
    await page.keyboard.press('Shift+Digit1');
    await page.waitForTimeout(500);
    withGlass = { judged: false, blurredSurfaces, ...(await series()) };
  }
  return {
    measuredAt: new Date().toISOString(),
    elements: Object.values(seeded.counts).reduce((s, n) => s + n, 0),
    counts: seeded.counts,
    images: seeded.images,
    ...(options.drawnFrames ? { strokes: seeded.strokes } : {}),
    renderedOnOpen: rendered,
    openMs,
    coldOpenMs,
    openSamples,
    floatBlur: NO_BLUR,
    ...judged,
    ...(options.alternate ? { rounds: measured } : {}),
    ...(withGlass ? { withGlass } : {}),
  };
}

test('a board with 1000 elements opens fast and pans smoothly', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const measured = await measure(page, baseURL ?? 'http://localhost:3100', {
    drawnFrames: 0,
    peers: 0,
    glass: true,
  });
  const results = {
    ...measured,
    limits: {
      openMs: OPEN_LIMIT_MS,
      frameAvgMs: FRAME_AVG_LIMIT_MS,
      frameP95Ms: FRAME_P95_LIMIT_MS,
    },
  };
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));

  expect(results.elements).toBeGreaterThanOrEqual(1000);
  expect(results.openMs).toBeLessThan(OPEN_LIMIT_MS);
  for (const run of [results.pan, results.zoom, results.panAt100]) {
    expect(run.avg).toBeLessThan(FRAME_AVG_LIMIT_MS);
    expect(run.p95).toBeLessThan(FRAME_P95_LIMIT_MS);
  }
});

test('a storyboard drawn by hand, with people on it, stays usable', async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const measured = await measure(page, baseURL ?? 'http://localhost:3100', {
    drawnFrames: DENSE_FRAMES,
    peers: DENSE_PEERS,
    glass: false,
    alternate: true,
  });
  const rounds = measured.rounds ?? [];
  // Judged on the series with the peers on the board, the worst of the two.
  const withPeers = rounds.filter((r) => r.peers > 0);
  const worst = (pick: (r: Series) => Timed) => ({
    avg: Math.max(...withPeers.map((r) => pick(r).avg)),
    p95: Math.max(...withPeers.map((r) => pick(r).p95)),
  });
  const judgedWithPeers = {
    pan: worst((r) => r.pan),
    zoom: worst((r) => r.zoom),
    panAt100: worst((r) => r.panAt100),
  };
  const dense = {
    ...measured,
    judgedWithPeers,
    gate: DENSE_GATE,
    limits: {
      openMs: DENSE_OPEN_LIMIT_MS,
      frameAvgMs: DENSE_FRAME_AVG_LIMIT_MS,
      frameP95Ms: DENSE_FRAME_P95_LIMIT_MS,
    },
  };
  // Next to the gate's numbers, in the same file the CI job keeps.
  const gate = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : {};
  writeFileSync(resultsPath, `${JSON.stringify({ ...gate, dense }, null, 2)}\n`);
  console.log(JSON.stringify({ dense }, null, 2));

  // What the test needs to measure anything: these always fail it.
  expect(dense.counts.frame).toBe(DENSE_FRAMES);
  expect(withPeers.length).toBe(DENSE_PEERS > 0 ? 2 : 0);

  const over: string[] = [];
  if (dense.openMs >= DENSE_OPEN_LIMIT_MS)
    over.push(`open ${dense.openMs} ms ≥ ${DENSE_OPEN_LIMIT_MS} ms`);
  for (const [name, run] of Object.entries(judgedWithPeers)) {
    if (run.avg >= DENSE_FRAME_AVG_LIMIT_MS)
      over.push(`${name} frame average ${run.avg.toFixed(1)} ms ≥ ${DENSE_FRAME_AVG_LIMIT_MS} ms`);
    if (run.p95 >= DENSE_FRAME_P95_LIMIT_MS)
      over.push(`${name} frame p95 ${run.p95.toFixed(1)} ms ≥ ${DENSE_FRAME_P95_LIMIT_MS} ms`);
  }
  report(dense.openMs, rounds, over);
  if (DENSE_GATE) expect(over).toEqual([]);
  else if (over.length)
    test.info().annotations.push({ type: 'warning', description: over.join('; ') });
});

/**
 * The dense numbers in the job summary on CI, and a warning annotation for each bar passed while
 * the measurement only reports.
 */
function report(openMs: number, rounds: Array<{ peers: number } & Series>, over: string[]) {
  const ms = (t: Timed) => `${t.avg.toFixed(1)} / ${t.p95.toFixed(1)}`;
  const lines = [
    `### Canvas performance, dense board (${DENSE_GATE ? 'judged' : 'reported only'})`,
    '',
    `Best warm open ${openMs} ms. Frame average / p95 in ms, rounds in the order they ran:`,
    '',
    '| Peers | Pan | Zoom | Pan at 100 % |',
    '| ----- | --- | ---- | ------------ |',
    ...rounds.map((r) => `| ${r.peers} | ${ms(r.pan)} | ${ms(r.zoom)} | ${ms(r.panAt100)} |`),
    '',
    over.length ? `Over the bars: ${over.join('; ')}` : 'Within the bars.',
    '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (!DENSE_GATE && process.env.GITHUB_ACTIONS)
    for (const line of over) console.log(`::warning title=Dense canvas performance::${line}`);
}
