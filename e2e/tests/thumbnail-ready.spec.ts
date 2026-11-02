// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

// Exercise the browser's local RAW preview and processing→ready transition without depending
// on the workstation having the RAW converter. The upload bytes are the real DNG fixture;
// metadata and the resulting derivative are controlled at the HTTP boundary.
test('RAW thumbnail appears after processing without reloading', async ({ page, baseURL }) => {
  const cookie = await signIn(baseURL!, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseURL! };
    }),
  );
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'RAW thumbnail regression' },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  let ready = false;
  let thumbnailRequests = 0;
  await page.route('**/qa-thumbnail.png', async (route) => {
    thumbnailRequests++;
    expect(ready).toBe(true);
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  await page.route(/\/api\/v1\/assets\/[^/]+$/, async (route) => {
    const response = await route.fetch();
    const asset = await response.json();
    await route.fulfill({
      response,
      json: {
        ...asset,
        status: ready ? 'ready' : 'processing',
        width: 600,
        height: 400,
        variants: ready ? [{ size: '256', width: 256, height: 170, url: '/qa-thumbnail.png' }] : [],
      },
    });
  });
  await page.goto(`/p/${project.id}?view=canvas`);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: 'orientation-6.dng',
    mimeType: 'image/x-adobe-dng',
    buffer: readFileSync(
      fileURLToPath(
        new URL('../../apps/server/src/media/fixtures/orientation-6.dng', import.meta.url),
      ),
    ),
  });
  const card = page.locator('[data-type="image"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Elaborazione');
  await expect(card.locator('img')).toHaveCount(0);
  expect(thumbnailRequests).toBe(0);
  ready = true;
  await expect
    .poll(
      () =>
        card
          .locator('img')
          .evaluateAll(
            (images) => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0,
          ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(card.locator('img')).toHaveAttribute('src', '/qa-thumbnail.png');
  const out = process.env.THUMBNAIL_SHOTS ?? join(tmpdir(), 'inkadra-thumbnail');
  mkdirSync(out, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Adatta alla vista' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(out, `thumbnail-${width}-${theme}.png`) });
    }
  }
});
