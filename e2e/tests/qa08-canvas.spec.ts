// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, moveIntoParent } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { cardAction } from '../helpers/phone-board.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.QA08_SHOTS;
async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({ path: join(shots, `${name}-light.png`), animations: 'disabled' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}
for (const width of [1280, 390]) {
  test.describe(`QA canvas ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    let imageId: string;
    let columnId: string;
    let childId: string;
    test.beforeEach(async ({ page, baseURL }) => {
      const base = baseURL as string;
      const cookie = await signIn(base, account);
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
        }),
      );
      await page.goto('/');
      await page.request.patch('/api/v1/me/preferences', {
        headers: { origin: base },
        data: { keepAroundContent: false, snapToGrid: true },
      });
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: base },
        data: { name: 'QA canvas', type: 'short_film' },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      const assetId = await uploadFile(base, cookie, project.id, {
        body: readFileSync(new URL('../../docs/assets/social-preview.png', import.meta.url)),
        name: 'canvas.png',
        type: 'image/png',
      });
      if (!assetId) throw new Error('Upload failed');
      await waitForAssets(base, cookie, [assetId]);
      const doc = createBoardDoc(project.rootBoardId);
      imageId = createElement(
        doc,
        'image',
        { x: 44, y: 88 },
        {
          w: 220,
          h: 160,
          assetId,
          caption: 'Caption to edit',
        },
        { userId: null },
      ).id;
      columnId = createElement(
        doc,
        'column',
        { x: width === 390 ? 44 : 440, y: 350 },
        {
          w: 264,
          title: 'References',
        },
        { userId: null },
      ).id;
      childId = createElement(
        doc,
        'image',
        { x: 0, y: 0 },
        { w: 220, assetId },
        { userId: null },
      ).id;
      moveIntoParent(doc, [childId], columnId, 0);
      await pushBoardDoc(base, cookie, project.rootBoardId, doc);
      await page.evaluate(
        (id) =>
          localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
        project.rootBoardId,
      );
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      await expect(page.locator(`[data-el="${imageId}"] img`)).toBeVisible();
    });
    // The account is shared with the other specs: put its preferences back to the defaults.
    test.afterEach(async ({ page, baseURL }) => {
      const reset = await page.request.patch('/api/v1/me/preferences', {
        headers: { origin: baseURL as string },
        data: { keepAroundContent: true, snapToGrid: false },
      });
      expect(reset.ok()).toBe(true);
    });
    test('snap lands on the visible dot grid after move and Ctrl resize', async ({ page }) => {
      const card = page.locator(`[data-el="${imageId}"]`);
      await card.click();
      const box = (await card.boundingBox())!;
      await drag(page, box.x + 40, box.y + 40, 37, 29);
      await expect
        .poll(() => card.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left) % 22))
        .toBe(0);
      await page.keyboard.down('Control');
      const handle = page.locator('[data-handle="se"]');
      const h = (await handle.boundingBox())!;
      await drag(page, h.x + h.width / 2, h.y + h.height / 2, 38, 24);
      await page.keyboard.up('Control');
      await shoot(page, `${width}-snap`);
      const dotDistance = await card.evaluate((el) => {
        const dots = document.querySelector('.canvas__dots')!;
        const style = getComputedStyle(dots);
        const step = Number.parseFloat(style.backgroundSize);
        const [px, py] = style.backgroundPosition.split(' ').map(Number.parseFloat);
        const origin = dots.getBoundingClientRect();
        const corner = el.getBoundingClientRect();
        const distance = (n: number) => Math.abs(n - Math.round(n / step) * step);
        return Math.max(
          distance(corner.left - origin.left - (px ?? 0) - step / 2),
          distance(corner.top - origin.top - (py ?? 0) - step / 2),
        );
      });
      expect.soft(dotDistance).toBeLessThan(1);
      expect
        .soft(
          await card.evaluate((el) => {
            const s = (el as HTMLElement).style;
            return (Number.parseFloat(s.left) + Number.parseFloat(s.width)) % 22;
          }),
        )
        .toBeCloseTo(0);
    });
    test('rotation can pass 45 degrees in both directions', async ({ page }) => {
      await page.locator(`[data-el="${imageId}"]`).click();
      await page.getByRole('button', { name: 'Ritaglia e ruota', exact: true }).click();
      const slider = page.getByRole('slider');
      await slider.focus();
      await slider.press('Home');
      await shoot(page, `${width}-rotation`);
      expect.soft(Number(await slider.inputValue())).toBeLessThanOrEqual(-90);
      await slider.press('End');
      expect.soft(Number(await slider.inputValue())).toBeGreaterThanOrEqual(90);
    });
    test('caption double click edits and image has no decorative border', async ({ page }) => {
      const card = page.locator(`[data-el="${imageId}"]`);
      await card.locator('.card__caption').dblclick();
      await shoot(page, `${width}-caption`);
      await expect
        .soft(page.getByRole('textbox', { name: 'Didascalia', exact: true }))
        .toBeVisible();
      await expect.soft(card).toHaveCSS('border-top-width', '0px');
    });
    test('tag picker follows the image and fits the viewport after zoom and pan', async ({
      page,
    }) => {
      const card = page.locator(`[data-el="${imageId}"]`);
      await card.click({ button: 'right' });
      await cardAction(page, /Tag/).click();
      const popup = page.locator('.tag-popover');
      await expect(popup).toBeVisible();
      const before = (await popup.boundingBox())!;
      await page.mouse.move(width - 20, 700);
      await page.mouse.wheel(0, 120);
      await shoot(page, `${width}-tags`);
      await expect.poll(async () => (await popup.boundingBox())?.y).not.toBe(before.y);
      const imageBox = (await card.boundingBox())!;
      await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -250);
      await page.keyboard.up('Control');
      await page.getByRole('button', { name: 'Fatto', exact: true }).click();
      // On a phone the zoom sits at the top of the board and can cover the zoomed card's middle.
      const zoomed = (await card.boundingBox())!;
      const corner = (await page.locator('.canvas__corner').boundingBox())!;
      const below = corner.y + corner.height + 12 - zoomed.y;
      await card.click({
        button: 'right',
        position:
          width < 768 && below > zoomed.height / 2
            ? { x: zoomed.width / 2, y: Math.min(zoomed.height - 4, below) }
            : undefined,
      });
      await cardAction(page, /Tag/).click();
      await expect(popup).toBeVisible();
      await shoot(page, `${width}-tags`);
      const box = (await popup.boundingBox())!;
      expect.soft(box.x).toBeGreaterThanOrEqual(0);
      expect.soft(box.y).toBeGreaterThanOrEqual(0);
      expect.soft(box.x + box.width).toBeLessThanOrEqual(width);
      expect.soft(box.y + box.height).toBeLessThanOrEqual(900);
    });
    test('column resize keeps content below header and fits its height', async ({ page }) => {
      const column = page.locator(`[data-el="${columnId}"]`);
      const child = page.locator(`[data-el="${childId}"]`);
      await column.locator('.column__title').click();
      const handle = page.locator('[data-handle="se"]');
      const h = (await handle.boundingBox())!;
      await drag(page, h.x + h.width / 2, h.y + h.height / 2, width === 390 ? 35 : 130, 180);
      await shoot(page, `${width}-column`);
      const c = (await column.boundingBox())!;
      const kid = (await child.boundingBox())!;
      expect.soft(c.y + c.height - kid.y - kid.height).toBeLessThan(16);
      expect.soft(kid.y - c.y).toBeLessThan(80);
    });
  });
}
