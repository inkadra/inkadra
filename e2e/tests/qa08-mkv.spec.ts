import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

for (const codec of ['ac3', 'eac3', 'dca', 'flac', 'libopus', 'aac']) {
  test(`H.264 MKV with ${codec}: pending, unavailable and ready playback`, async ({
    page,
    baseURL,
  }) => {
    test.skip(!process.env.QA_MKV, 'Requires generated MKV fixtures and real media tools');
    test.setTimeout(120_000);
    const before = process.env.QA_BEFORE === '1';
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
    const res = await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: `MKV ${codec}` },
    });
    const project = await res.json();
    const assetId = await uploadFile(baseURL!, cookie, project.id, {
      body: readFileSync(join(process.env.QA_MKV!, `${codec}.mkv`)),
      name: `${codec}.mkv`,
      type: 'video/x-matroska',
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
    // Measure whether this Chromium build decodes the original's sound, independently of the UI.
    await page.goto('/');
    const original = await page.evaluate(async (url) => {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      document.body.append(v);
      await v.play().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      const result = {
        readyState: v.readyState,
        error: v.error?.code,
        audio: (v as HTMLVideoElement & { webkitAudioDecodedByteCount: number })
          .webkitAudioDecodedByteCount,
      };
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
      return result;
    }, asset.url);
    const states: unknown[] = [];
    for (const status of ['queued', 'processing', 'skipped', 'failed']) {
      await page.route(`**/api/v1/assets/${assetId}`, (route) =>
        route.fulfill({
          json: {
            ...asset,
            proxy: {
              ...asset.proxy,
              url: null,
              status,
              progress: status === 'processing' ? 42 : null,
            },
          },
        }),
      );
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
      const card = page.locator('.card--file');
      await expect(card.locator('.fcard__preview--video')).toBeVisible();
      const playCount = await card.locator('.card__play').count();
      if (process.env.QA_SHOTS)
        await page.screenshot({ path: `${process.env.QA_SHOTS}/${codec}-${status}-card.png` });
      await card.locator('.fcard__footer').dblclick();
      const viewer = page.getByRole('dialog');
      await expect(viewer).toBeVisible();
      const videoCount = await viewer.locator('video').count();
      states.push({ status, playCount, videoCount });
      if (!before) {
        expect(playCount).toBe(0);
        expect(videoCount).toBe(0);
        await expect(viewer).toContainText(
          status === 'queued' || status === 'processing'
            ? 'il server sta preparando'
            : 'Formato non riproducibile',
        );
      }
      if (process.env.QA_SHOTS)
        await page.screenshot({ path: `${process.env.QA_SHOTS}/${codec}-${status}.png` });
      if (!before && codec === 'ac3' && status === 'processing') {
        await page.unroute(`**/api/v1/assets/${assetId}`);
        const converted = viewer.locator('video');
        await expect(converted).toBeVisible({ timeout: 15_000 });
        await expect(converted).toHaveAttribute('src', asset.proxy.url);
        await expect
          .poll(() =>
            converted.evaluate(
              (v) =>
                (v as HTMLVideoElement & { webkitAudioDecodedByteCount: number })
                  .webkitAudioDecodedByteCount,
            ),
          )
          .toBeGreaterThan(0);
      }
      await page.keyboard.press('Escape');
      await page.unroute(`**/api/v1/assets/${assetId}`);
    }
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
    await page.locator('.card--file .card__play').click();
    const video = page.locator('.card--file video');
    await expect(video).toBeVisible();
    await expect
      .poll(() =>
        video.evaluate(
          (v) =>
            (v as HTMLVideoElement & { webkitAudioDecodedByteCount: number })
              .webkitAudioDecodedByteCount,
        ),
      )
      .toBeGreaterThan(0);
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    expect(await video.getAttribute('src')).toBe(asset.proxy.url);
    if (process.env.QA_SHOTS) {
      await page.screenshot({ path: `${process.env.QA_SHOTS}/${codec}-ready.png` });
      const file = `${process.env.QA_SHOTS}/${codec}-converted.mp4`;
      writeFileSync(file, await (await page.request.get(asset.proxy.url)).body());
      const probe = JSON.parse(
        execFileSync(
          process.env.FFPROBE_PATH!,
          ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file],
          { encoding: 'utf8' },
        ),
      );
      expect(probe.streams).toContainEqual({ codec_name: 'aac', codec_type: 'audio' });
      writeFileSync(
        `${process.env.QA_SHOTS}/${codec}-evidence.json`,
        JSON.stringify({ original, states, converted: probe }, null, 2),
      );
    }
  });
}
