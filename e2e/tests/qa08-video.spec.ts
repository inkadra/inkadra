import { readFileSync } from 'node:fs';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

test('QA video proportions, thumbnail playback and converted audio', async ({ page, baseURL }) => {
  test.skip(!process.env.QA_VIDEO, 'Requires generated ProRes/PCM fixture and real media tools');
  test.setTimeout(120_000);
  if (process.env.QA_THEME)
    await page.addInitScript(
      (theme) => localStorage.setItem('inkadra.theme', theme),
      process.env.QA_THEME,
    );
  const cookie = await signIn(baseURL!, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL! };
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'QA video' },
  });
  const project = await response.json();
  const assetId = await uploadFile(baseURL!, cookie, project.id, {
    body: readFileSync(process.env.QA_VIDEO!),
    name: 'qa.mov',
    type: 'video/quicktime',
  });
  expect(assetId).toBeTruthy();
  await waitForAssets(baseURL!, cookie, [assetId!]);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/assets/${assetId}`)).json()).proxy?.status,
      { timeout: 90_000 },
    )
    .toBe('ready');
  const asset = await (await page.request.get(`/api/v1/assets/${assetId}`)).json();
  const doc = createBoardDoc(project.rootBoardId);
  createElement(doc, 'file', { x: 60, y: 60 }, { assetId: assetId!, w: 400 }, { userId: null });
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  const card = page.locator('.card--file');
  await expect(card).toBeVisible();
  await page.route(`**/api/v1/assets/${assetId}`, async (route) =>
    route.fulfill({
      json: { ...asset, proxy: { ...asset.proxy, status: 'processing', progress: 42 } },
    }),
  );
  await page.reload();
  await expect(card.locator('.fcard__prep')).toBeVisible();
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/02-video-preparing.png` });
  await page.unroute(`**/api/v1/assets/${assetId}`);
  await page.reload();
  await expect(card.locator('.card__play')).toBeVisible();
  await card.locator('.fcard__footer').click();
  const media = card.locator('.fcard__preview');
  const first = await media.boundingBox();
  const handle = page.locator('.canvas__resize-handles [data-handle="se"]');
  const point = await handle.boundingBox();
  await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
  await page.mouse.down();
  await page.mouse.move(point!.x + 160, point!.y + 15, { steps: 12 });
  await page.mouse.up();
  const resized = await media.boundingBox();
  expect.soft(resized!.width / resized!.height).toBeCloseTo(first!.width / first!.height, 1);
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/01-video-resize.png` });
  await card.getByRole('button', { name: 'Riproduci qa.mov' }).click();
  const video = card.locator('video');
  await expect(video).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  expect(
    await video.evaluate((v: HTMLVideoElement) => ({
      muted: v.muted,
      volume: v.volume,
      audio: (v as HTMLVideoElement & { webkitAudioDecodedByteCount: number })
        .webkitAudioDecodedByteCount,
    })),
  ).toMatchObject({ muted: false, volume: 1 });
  await expect
    .poll(() =>
      video.evaluate(
        (v) =>
          (v as HTMLVideoElement & { webkitAudioDecodedByteCount: number })
            .webkitAudioDecodedByteCount,
      ),
    )
    .toBeGreaterThan(0);
  if (process.env.QA_SHOTS) {
    await page.screenshot({ path: `${process.env.QA_SHOTS}/02-video-audio.png` });
    const copy = await page.request.get(asset.proxy.url);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${process.env.QA_SHOTS}/converted.mp4`, await copy.body());
  }
});
