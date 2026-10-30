// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addFrame, addScene, createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const out = fileURLToPath(new URL('../../docs/screenshots/0.6-frame-grab/', import.meta.url));

/** Fictional animated train, generated in Chrome without a codec dependency or third-party media. */
async function footage(page: Page) {
  return Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      const draw = (x: number) => {
        ctx.fillStyle = '#142330';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#20394a';
        ctx.fillRect(0, 340, 1280, 380);
        ctx.fillStyle = '#d6af6a';
        ctx.fillRect(0, 540, 1280, 6);
        ctx.fillStyle = '#101b25';
        ctx.fillRect(x, 300, 800, 220);
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = '#d6af6a';
          ctx.fillRect(x + 30 + i * 110, 325, 76, 100);
        }
        ctx.fillStyle = '#f0e8d5';
        ctx.font = '32px sans-serif';
        ctx.fillText('LAST TRAIN', 70, 95);
        ctx.font = '20px sans-serif';
        ctx.fillText('PLATFORM 09 · NIGHT EXTERIOR', 70, 130);
      };
      draw(240);
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const done = new Promise<number[]>((resolve) => {
        recorder.onstop = async () =>
          resolve([...new Uint8Array(await new Blob(chunks).arrayBuffer())]);
      });
      recorder.start();
      for (let i = 0; i < 40; i++) {
        draw(240 - i * 3);
        await new Promise((r) => setTimeout(r, 33));
      }
      recorder.stop();
      for (const track of stream.getTracks()) track.stop();
      return done;
    }),
  );
}

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 412, 915],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`uploaded video capture ${device} ${theme}`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height });
      const cookie = await signIn(baseURL!, {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      });
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const index = pair.indexOf('=');
          return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
        }),
      );
      await page.addInitScript((theme) => {
        localStorage.setItem('inkadra.theme', theme);
        const violations: string[] = [];
        (window as unknown as { violations: string[] }).violations = violations;
        document.addEventListener('securitypolicyviolation', (e) =>
          violations.push(`${e.effectiveDirective}: ${e.blockedURI}`),
        );
      }, theme);
      await page.goto('/');
      const body = await footage(page);
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: baseURL! },
        data: { name: 'Last Train', type: 'short_film' },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      const boardResponse = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
        headers: { origin: baseURL! },
        data: { parentBoardId: project.rootBoardId, title: 'Platform 09', kind: 'storyboard' },
      });
      expect(boardResponse.ok()).toBe(true);
      project.rootBoardId = (await boardResponse.json()).id;
      const assetId = await uploadFile(baseURL!, cookie, project.id, {
        body,
        name: 'Last Train.webm',
        type: 'video/webm',
      });
      expect(assetId).toBeTruthy();
      await waitForAssets(baseURL!, cookie, [assetId!]);
      const doc = createBoardDoc(project.rootBoardId);
      const scene = addScene(doc, { title: 'Platform 09', number: '1' }, { userId: null });
      addFrame(
        doc,
        scene.id,
        null,
        { action: 'The last train arrives at the platform.', notes: 'Keep the warm window light.' },
        { userId: null },
      );
      createElement(
        doc,
        'file',
        { x: 60, y: 40 },
        { assetId: assetId!, guestHidden: device === 'desktop' && theme === 'dark' },
        { userId: null },
      );
      await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      await expect(page.locator('[data-type="file"]')).toBeVisible();
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.locator('[data-type="file"]').dblclick();
      const viewer = page.getByRole('dialog');
      const video = viewer.locator('video');
      await expect(video).toBeVisible();
      await video.evaluate(async (video: HTMLVideoElement) => {
        if (video.readyState < 2)
          await new Promise<void>((r) =>
            video.addEventListener('loadeddata', () => r(), { once: true }),
          );
        video.pause();
        video.currentTime = 0.6;
        await new Promise<void>((r) => video.addEventListener('seeked', () => r(), { once: true }));
      });
      await expect(viewer.locator('.viewer__hint')).toHaveText(
        ', / . · ⇧ ← / → Fotogramma precedente / successivo',
      );
      await page.screenshot({ path: `${out}/${device}-${theme}-viewer.png` });
      // Period steps the paused video; plain arrows remain gallery navigation.
      const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
      await page.keyboard.press('.');
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(before);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
      await page.keyboard.press('g');
      await expect(page.getByRole('region', { name: 'Destinazione del fotogramma' })).toBeVisible();
      await page
        .getByRole('combobox', { name: 'Inquadratura', exact: true })
        .selectOption({ label: '1A' });
      await expect(
        page.getByText(/^Fotogramma a \d+:\d{2},\d{2} · risoluzione originale$/),
      ).toBeVisible();
      if (device === 'desktop' && theme === 'dark')
        await expect(
          page.getByText(
            'La sorgente è nascosta agli ospiti: anche questa inquadratura verrà nascosta.',
          ),
        ).toBeVisible();
      await page.screenshot({ path: `${out}/${device}-${theme}-destination.png` });
      const uploaded = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && res.url().includes('/uploads/') && res.ok(),
      );
      await page.getByRole('button', { name: 'Usa come immagine dell’inquadratura' }).click();
      const upload = await uploaded;
      const capturedId = upload.headers()['inkadra-asset-id'];
      if (!capturedId) throw new Error('Upload response has no asset id');
      expect(capturedId).not.toBe(assetId);
      await waitForAssets(baseURL!, cookie, [capturedId]);
      const captured = await (await page.request.get(`/api/v1/assets/${capturedId}`)).json();
      expect(captured).toMatchObject({ kind: 'image', width: 1280, height: 720 });
      await expect(viewer).toHaveCount(0);
      if (device === 'phone')
        await page.getByRole('combobox', { name: 'Vista', exact: true }).selectOption('storyboard');
      else await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
      await expect(page.locator('.story__tile img')).toBeVisible();
      await page.screenshot({ path: `${out}/${device}-${theme}-storyboard.png` });
      expect(
        await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
      ).toEqual([]);
      const saved = await readBoard(baseURL!, cookie, project.rootBoardId);
      const frame = [...roots(saved).elements.values()]
        .map(readElement)
        .find((el) => el?.type === 'frame');
      expect(frame).toMatchObject({
        assetId: capturedId,
        source: { kind: 'uploaded-video', assetId },
        notes: 'Keep the warm window light.',
      });
      expect(
        frame?.type === 'frame' &&
          frame.source?.kind === 'uploaded-video' &&
          frame.source.timeSeconds,
      ).toBeGreaterThan(0);
      await page.reload();
      await expect(page.locator('.story__tile img')).toHaveAttribute('src', new RegExp(capturedId));
      if (device === 'desktop' && theme === 'dark') {
        await page.getByRole('button', { name: '1A', exact: true }).click();
        await page.getByRole('button', { name: 'Da video', exact: true }).click();
        await page.getByRole('button', { name: 'Last Train.webm', exact: true }).click();
        const player = page.getByRole('dialog').locator('video');
        await expect
          .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
          .toBeGreaterThanOrEqual(2);
        await player.evaluate((video: HTMLVideoElement) => video.play());
        expect(await player.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
        await page.getByRole('button', { name: 'Cattura fotogramma', exact: true }).click();
        await expect(
          page.getByRole('combobox', { name: 'Inquadratura', exact: true }),
        ).not.toHaveValue('');
        await page.getByRole('button', { name: 'Aggiungi alla lavagna', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const board = await readBoard(baseURL!, cookie, project.rootBoardId);
        const image = [...roots(board).elements.values()]
          .map(readElement)
          .find((el) => el?.type === 'image');
        expect(image).toMatchObject({ source: { kind: 'uploaded-video', assetId } });
        expect(image?.type === 'image' && image.caption).toMatch(
          /Last Train\.webm · \d+:\d{2},\d{2}$/,
        );
      }
    });
  }
}

for (const provider of ['youtube', 'vimeo']) {
  test(`${provider} uses the stored oEmbed thumbnail and preserves notes`, async ({
    page,
    baseURL,
  }) => {
    const cookie = await signIn(baseURL!, {
      name: 'Giulia Bianchi',
      email: 'giulia@example.com',
      password: 'correct-horse-battery',
    });
    await page.context().addCookies(
      cookie.split('; ').map((pair) => {
        const i = pair.indexOf('=');
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseURL! };
      }),
    );
    await page.addInitScript(() => {
      const violations: string[] = [];
      (window as unknown as { violations: string[] }).violations = violations;
      document.addEventListener('securitypolicyviolation', (e) =>
        violations.push(e.effectiveDirective),
      );
    });
    await page.goto('/');
    const thumbnail = await page.screenshot();
    const res = await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: 'Last Train · reference' },
    });
    const project = await res.json();
    const imageAssetId = await uploadFile(baseURL!, cookie, project.id, {
      body: thumbnail,
      name: 'reference.png',
      type: 'image/png',
    });
    expect(imageAssetId).toBeTruthy();
    await waitForAssets(baseURL!, cookie, [imageAssetId!]);
    const url =
      provider === 'youtube'
        ? 'https://www.youtube.com/watch?v=abcdefghijk&t=42'
        : 'https://vimeo.com/123456';
    // Mock the oEmbed-derived preview response; the thumbnail itself is a real server asset.
    // Server video-meta.test.ts separately verifies bounded oEmbed and SSRF-safe thumbnail fetch.
    await page.route('**/api/v1/link-previews', (route) =>
      route.fulfill({
        json: {
          url,
          title: 'Last Train · reference',
          imageAssetId,
          description: 'Fictional film reference',
          siteName: provider,
        },
      }),
    );
    await page.route('https://www.youtube-nocookie.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Mock player</title>',
      }),
    );
    const preview = await page.evaluate(
      async ({ projectId, boardId, url }) => {
        const res = await fetch('/api/v1/link-previews', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, boardId, url }),
        });
        return res.json();
      },
      { projectId: project.id, boardId: project.rootBoardId, url },
    );
    const doc = createBoardDoc(project.rootBoardId);
    const scene = addScene(doc, { title: 'Reference', number: '1' }, { userId: null });
    addFrame(doc, scene.id, null, { notes: 'Preserve this direction.' }, { userId: null });
    createElement(doc, 'link', { x: 60, y: 40 }, preview, { userId: null });
    await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
    await page.locator('[data-type="link"]').dblclick();
    await page.getByRole('button', { name: 'Usa miniatura', exact: true }).click();
    await expect(page.getByText('I player esterni non consentono', { exact: false })).toBeVisible();
    if (provider === 'youtube') {
      await page.getByLabel('Tempo di riferimento YouTube (secondi)').fill('67');
    }
    await page
      .getByRole('combobox', { name: 'Inquadratura', exact: true })
      .selectOption({ label: '1A' });
    await page.getByRole('button', { name: 'Usa come immagine dell’inquadratura' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await readBoard(baseURL!, cookie, project.rootBoardId);
    const frame = [...roots(saved).elements.values()]
      .map(readElement)
      .find((el) => el?.type === 'frame');
    expect(frame).toMatchObject({ assetId: imageAssetId, source: { kind: 'link-thumbnail', url } });
    if (provider === 'youtube')
      expect(frame).toMatchObject({
        source: { timeSeconds: 67 },
        notes: 'Preserve this direction.\nhttps://www.youtube.com/watch?v=abcdefghijk&t=67',
      });
    else expect(frame).toMatchObject({ notes: 'Preserve this direction.' });
    expect(
      await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
    ).toEqual([]);
  });
}
