import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { seedPerfBoard } from './seed.ts';

/**
 * Gate 0.2: a board with 1000 elements, 500 of them images, opens in under two seconds and
 * stays smooth while panning and zooming. The numbers land in e2e/perf-results.json.
 */

const OPEN_LIMIT_MS = Number(process.env.PERF_OPEN_LIMIT_MS ?? 2000);
// Frames are timed in headless Chromium on a CI runner, without a GPU: rasterising is done on
// the CPU, so the bar is a floor that catches regressions, not the 60 fps of a real browser.
// On average at least 25 fps, and 95% of frames under 70 ms (no visible stall).
const FRAME_AVG_LIMIT_MS = Number(process.env.PERF_FRAME_AVG_LIMIT_MS ?? 40);
const FRAME_P95_LIMIT_MS = Number(process.env.PERF_FRAME_P95_LIMIT_MS ?? 70);

const resultsPath = fileURLToPath(new URL('../../perf-results.json', import.meta.url));

interface FrameStats {
  frames: number;
  avg: number;
  p95: number;
  max: number;
}

type Metrics = Record<string, number>;
const TRACKED = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration'];

/** Main-thread time spent per kind of work between two snapshots, in ms. */
function spent(before: Metrics, after: Metrics) {
  return Object.fromEntries(
    TRACKED.map((k) => [k, Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000)]),
  );
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

test('a board with 1000 elements opens fast and pans smoothly', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL ?? 'http://localhost:3100';
  const seeded = await seedPerfBoard(base);

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

  // Shared CI runners vary by a second from run to run: the median of three opens catches a
  // regression without failing on one slow sample. Every sample is kept in the results.
  const openSamples: number[] = [];
  for (let i = 0; i < 3; i++) {
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
  const openMs = [...openSamples].sort((a, b) => a - b)[1] ?? Number.POSITIVE_INFINITY;
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
  const pan = await timed(120, false);
  const zoom = await timed(60, true);
  await page.keyboard.press('Shift+Digit0');
  await page.waitForTimeout(500);
  const panFull = await timed(120, false);

  const results = {
    measuredAt: new Date().toISOString(),
    elements: Object.values(seeded.counts).reduce((s, n) => s + n, 0),
    counts: seeded.counts,
    images: seeded.images,
    renderedOnOpen: rendered,
    openMs,
    openSamples,
    pan,
    zoom,
    panAt100: panFull,
    limits: {
      openMs: OPEN_LIMIT_MS,
      frameAvgMs: FRAME_AVG_LIMIT_MS,
      frameP95Ms: FRAME_P95_LIMIT_MS,
    },
  };
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));

  expect(results.elements).toBeGreaterThanOrEqual(1000);
  expect(openMs).toBeLessThan(OPEN_LIMIT_MS);
  for (const run of [pan, zoom, panFull]) {
    expect(run.avg).toBeLessThan(FRAME_AVG_LIMIT_MS);
    expect(run.p95).toBeLessThan(FRAME_P95_LIMIT_MS);
  }
});
