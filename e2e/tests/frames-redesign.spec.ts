// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

for (const theme of ['dark', 'light'] as const)
  for (const width of [1280, 390]) {
    test(`frames and drawing ${theme} ${width}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
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
      const project = await (
        await page.request.post('/api/v1/projects', {
          headers: { origin: baseURL! },
          data: { name: `Frames ${theme} ${width}` },
        })
      ).json();
      await page.goto('/');
      const imageAssetId = await uploadFile(baseURL!, cookie, project.id, {
        body: Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 960;
            canvas.height = 540;
            const c = canvas.getContext('2d')!;
            const g = c.createLinearGradient(0, 0, 0, 540);
            g.addColorStop(0, '#1a1016');
            g.addColorStop(1, '#7c3a22');
            c.fillStyle = g;
            c.fillRect(0, 0, 960, 540);
            c.fillStyle = '#0c0a0d';
            c.beginPath();
            c.ellipse(590, 400, 100, 230, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(590, 185, 58, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#f59a45';
            c.beginPath();
            c.arc(350, 410, 70, 0, Math.PI * 2);
            c.fill();
            return canvas.toDataURL('image/png').split(',')[1]!;
          }),
          'base64',
        ),
        name: 'reference.png',
        type: 'image/png',
      });
      await waitForAssets(baseURL!, cookie, [imageAssetId!]);
      const doc = createBoardDoc(project.rootBoardId);
      const frame = createElement(
        doc,
        'frame',
        { x: 60, y: 80 },
        { w: 280, assetId: imageAssetId! },
        { userId: null },
      );
      const image = createElement(
        doc,
        'image',
        { x: 400, y: 300 },
        { assetId: imageAssetId! },
        { userId: null },
      );
      const other = createElement(doc, 'note', { x: 400, y: 80 }, {}, { userId: null });
      const character = createElement(
        doc,
        'character',
        { x: 700, y: 80 },
        { name: 'Marta' },
        { userId: null },
      );
      await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.locator(`[data-el="${frame.id}"]`).dblclick();
      await expect(page.locator('.film-panel')).toBeVisible();
      if (width === 1280) {
        await page.locator(`[data-el="${other.id}"]`).click();
        await expect(page.locator('.film-panel')).toHaveCount(0);
        await page.locator(`[data-el="${character.id}"]`).dblclick();
        await expect(page.locator('.story-panel')).toBeVisible();
        await page.locator(`[data-el="${other.id}"]`).click();
        await expect(page.locator('.story-panel')).toHaveCount(0);
        await page.locator(`[data-el="${frame.id}"]`).dblclick();
      }
      const out = process.env.FRAMES_SCREENSHOTS;
      if (out) {
        mkdirSync(out, { recursive: true });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${out}/${width}-${theme}-panel.png` });
      }
      if (width === 1280) {
        // No side panel covers the dock: its last button is the one on top where it stands.
        const canvasButton = page.locator('.canvas__dock .toolbar__btn--canvas');
        const covered = () =>
          canvasButton.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const top = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return !button.contains(top);
          });
        expect(await covered()).toBe(false);
        await page.locator('.comments-button').click();
        await expect(page.locator('.comments-panel')).toBeVisible();
        expect(await covered()).toBe(false);
        if (out) await page.screenshot({ path: `${out}/1280-${theme}-comments.png` });
        await page.locator('.comments-button').click();
        await expect(page.locator('.comments-panel')).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Disegna', exact: true }).last().click();
      const editor = page.locator('.pen');
      await expect(editor).toBeVisible();
      await page.keyboard.press('Tab');
      expect(await editor.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await expect(editor.locator('.pen__strip,.pen__layers,.pen__guides')).toHaveCount(0);
      await expect(editor).toHaveAttribute('aria-label', 'Disegno · 1');
      const box = await editor.locator('.pen__area').boundingBox();
      if (!box) throw new Error('No drawing area');
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.mouse.up();
      await expect(editor.locator('.frame-pic__ink path').first()).toHaveAttribute(
        'stroke',
        '#E5484D',
      );
      await page.mouse.move(0, 0);
      if (out) await page.screenshot({ path: `${out}/${width}-${theme}-draw.png` });
      await editor.getByRole('button', { name: 'Colore: rosso', exact: true }).click();
      if (out) {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${out}/${width}-${theme}-palette.png` });
      }
      await editor.getByRole('button', { name: 'Spessore', exact: true }).click();
      if (out) {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${out}/${width}-${theme}-width.png` });
      }
      await editor.getByRole('button', { name: 'Altre azioni', exact: true }).click();
      if (out) {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${out}/${width}-${theme}-more.png` });
      }
      const popup = await editor.locator('.pen__more').boundingBox();
      const select = await editor.locator('.pen__more .ink-select').boundingBox();
      expect(popup && select && select.x + select.width <= popup.x + popup.width).toBe(true);
      await editor.getByRole('button', { name: 'Fatto', exact: true }).click();
      await expect(editor).toHaveCount(0);
      if (width === 1280 && theme === 'dark') {
        await page.locator(`[data-el="${other.id}"]`).click();
        const from = await page.locator(`[data-el="${image.id}"]`).boundingBox();
        const to = await page.locator(`[data-el="${frame.id}"]`).boundingBox();
        if (!from || !to) throw new Error('Missing cards');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
        await expect(page.locator('.canvas__frame-drop')).toContainText(
          'Rilascia per sostituire l’immagine',
        );
        await expect(page.locator('.canvas__frame-drop')).toContainText('Il disegno resta');
        if (out) await page.screenshot({ path: `${out}/1280-dark-drop.png` });
        await page.mouse.up();
        await expect(page.locator(`[data-el="${image.id}"]`)).toHaveCount(0);
        await expect(page.locator('.toast:not([inert])')).toContainText('Immagine inserita in 1');
        await page.keyboard.press('Control+z');
        await expect(page.locator(`[data-el="${image.id}"]`)).toBeVisible();
        await expect(page.locator(`[data-el="${frame.id}"] .frame-pic__ink path`)).toHaveCount(1);

        // A file that fails to upload leaves the picture alone, with the error and Retry on it.
        const before = await page.locator(`[data-el="${frame.id}"] img`).getAttribute('src');
        await page.route('**/api/v1/uploads**', (route) => route.abort());
        const dropped = await page.evaluateHandle(() => {
          const data = new DataTransfer();
          data.items.add(new File(['x'], 'fails.png', { type: 'image/png' }));
          return data;
        });
        const at = await page.locator(`[data-el="${frame.id}"]`).boundingBox();
        const point = { clientX: at!.x + at!.width / 2, clientY: at!.y + at!.height / 3 };
        await page.locator('[data-testid="canvas"]').dispatchEvent('drop', {
          ...point,
          dataTransfer: dropped,
        });
        await expect(page.locator('.frame-upload')).toContainText('Caricamento non riuscito', {
          timeout: 15_000,
        });
        await expect(
          page.locator('.frame-upload').getByRole('button', { name: 'Riprova' }),
        ).toBeVisible();
        if (out) await page.screenshot({ path: `${out}/1280-dark-upload-failed.png` });
        expect(await page.locator(`[data-el="${frame.id}"] img`).getAttribute('src')).toBe(before);
        await page.unroute('**/api/v1/uploads**');
      }
    });
  }

test('server capture reads the 4K original and rejects invalid times', async ({
  page,
  baseURL,
}) => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'inkadra-frame-original-'));
  const file = join(dir, 'source.mkv');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=3840x2160:r=1',
    '-frames:v',
    '2',
    '-c:v',
    'ffv1',
    file,
  ]);
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
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: 'Original 4K capture' },
    })
  ).json();
  const id = await uploadFile(baseURL!, cookie, project.id, {
    body: readFileSync(file),
    name: 'source.mkv',
    type: 'video/x-matroska',
  });
  await waitForAssets(baseURL!, cookie, [id!]);
  const response = await page.request.get(`/api/v1/assets/${id}/frame?time=0.5`);
  expect(response.status()).toBe(200);
  const png = await response.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([3840, 2160]);
  expect((await page.request.get(`/api/v1/assets/${id}/frame?time=-1`)).status()).toBe(400);
  expect((await page.request.get(`/api/v1/assets/${id}/frame?time=99999`)).status()).toBe(400);
});
