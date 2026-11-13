// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// A camera file gets the H.264 ladder (decision 0128): its card plays, and the viewer's Quality
// menu offers Auto and each rung. Needs ffmpeg where the server runs. Set E2E_SHOTS to a folder to
// also capture the card, the menu and Settings → Video, light and dark, desktop and phone.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;

/** The parts of the API the test reads (`@inkadra/shared` is not a dependency of e2e). */
type Asset = { playback?: { renditions: Array<{ name: string; status: string }> } | null };
type VideoSettingsView = Record<string, unknown>;
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };

/** Two seconds of 720p ProRes: a format browsers do not play, large enough for two rungs. */
function prores720() {
  const out = join(mkdtempSync(join(tmpdir(), 'inkadra-ladder-')), 'A003_C012.mov');
  execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=25:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=2',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '0',
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  return readFileSync(out);
}

function hasFfmpeg() {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function seed(page: Page, base: string) {
  const cookie = await signIn(base, admin);
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base };
    }),
  );
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: `Ladder ${Date.now()}` },
  });
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const assetId = await uploadFile(base, cookie, project.id, {
    body: prores720(),
    name: 'A003_C012.mov',
    type: 'video/quicktime',
  });
  if (!assetId) throw new Error('upload failed');
  await waitForAssets(base, cookie, [assetId]);
  const doc = createBoardDoc(project.rootBoardId);
  createElement(doc, 'file', { x: 60, y: 80 }, { assetId, w: 360 }, { userId: null });
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  return { assetId, boardUrl: `/p/${project.id}/b/${project.rootBoardId}` };
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
}

test('a camera file gets two rungs, plays in its card and offers them in the viewer', async ({
  page,
  baseURL,
}) => {
  test.skip(!hasFfmpeg(), 'needs ffmpeg');
  test.setTimeout(180_000);
  const { assetId, boardUrl } = await seed(page, baseURL as string);
  // The worker makes 480p, then 720p, in one run.
  await expect
    .poll(
      async () => {
        const asset = (await (await page.request.get(`/api/v1/assets/${assetId}`)).json()) as Asset;
        return (asset.playback?.renditions ?? [])
          .filter((r) => r.status === 'ready')
          .map((r) => r.name);
      },
      { timeout: 120_000 },
    )
    .toEqual(['480', '720']);
  const master = await page.request.get(`/api/v1/assets/${assetId}/hls/master.m3u8`);
  expect(master.status()).toBe(200);
  expect(await master.text()).toMatch(/480\.m3u8[\s\S]*720\.m3u8/);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(boardUrl);
  const card = page.locator('.card--file').first();
  await expect(card.locator('[data-play-link]')).toBeVisible();
  await card.locator('button[data-play-link]').click();
  const video = card.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime > 0)).toBe(true);
  await shoot(page, 'ladder-card');

  await card.locator('.fcard__footer').dblclick();
  await expect(page.getByRole('dialog').locator('video')).toBeVisible();
  const quality = page.locator('.viewer-quality__button');
  await expect(quality).toBeVisible();
  await quality.click();
  const items = page.locator('[role="menuitemradio"]');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toHaveText(/720p/);
  await expect(items.nth(2)).toHaveText(/480p/);
  await shoot(page, 'ladder-viewer-menu');
  await items.nth(2).click();
  await expect(quality).toContainText('480p');
});

/** A fictional studio on an Intel N100, as on the approved mockup. */
const studio = (view: VideoSettingsView): VideoSettingsView => ({
  ...view,
  enabled: true,
  encoder: {
    label: 'Intel Quick Sync (Intel, /dev/dri/renderD128, low power)',
    backend: 'qsv',
    tuning: 'full',
    av1: false,
    requested: 'auto',
    concurrency: 2,
  },
  library: [
    { side: '480', minutes: 30, fastMinutes: 0, videos: 20 },
    { side: '720', minutes: 90, fastMinutes: 10, videos: 46 },
    { side: '1080', minutes: 430, fastMinutes: 60, videos: 160 },
    { side: '2160', minutes: 310, fastMinutes: 40, videos: 86 },
  ],
  copiesBytes: 19e9,
  freeBytes: 412e9,
  outdated: 214,
  speed: null,
});

test('Settings → Video shows the encoder, the presets, the estimates and live playback', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const cookie = await signIn(baseURL as string, admin);
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL as string };
    }),
  );
  const direct = await page.request.get('/api/v1/instance/video-settings');
  expect(direct.status(), await direct.text()).toBe(200);
  let running = false;
  await page.route('**/api/v1/instance/video-settings*', async (route) => {
    const real = await route.fetch();
    const view = studio((await real.json()) as VideoSettingsView);
    await route.fulfill({
      response: real,
      json: running
        ? {
            ...view,
            queue: { queued: 120, processing: 2 },
            backfill: {
              scope: 'outdated',
              status: 'running',
              total: 214,
              done: 37,
              startedAt: new Date().toISOString(),
            },
          }
        : view,
    });
  });
  for (const [width, height, name] of [
    [1280, 1700, 'desktop'],
    [390, 3200, 'phone'],
  ] as const) {
    running = false;
    await page.setViewportSize({ width, height });
    await page.goto('/settings?section=video');
    await expect(page.getByText('Intel Quick Sync').first()).toBeVisible();
    await expect(page.locator('input[name="video-quality"]')).toHaveCount(3);
    await shoot(page, `video-settings-${name}`);
    running = true;
    await page.reload();
    await expect(page.locator('.video-run [role="progressbar"]')).toBeVisible();
    await shoot(page, `video-settings-running-${name}`);
  }
});
