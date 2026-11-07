// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// While a character card is resized across 260 px, where its portrait grows or shrinks, the
// selection follows the card's height, and the card keeps the width it was given
// (inkadra-feedback#22).
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** With CHARACTER_SHOTS set, a screenshot of each drag, held. */
const shots = process.env.CHARACTER_SHOTS;

for (const theme of shots ? (['light', 'dark'] as const) : (['light'] as const)) {
  test(`the selection follows a resized character ${theme}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const cookie = await signIn(baseURL!, account);
    await page.context().addCookies(
      cookie.split('; ').map((pair) => {
        const index = pair.indexOf('=');
        return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
      }),
    );
    await page.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
    await page.goto('/');
    const created = await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: `Scheda larga ${theme}`, type: 'short_film' },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const portrait = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#c8b8a0';
      ctx.fillRect(0, 0, 320, 320);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    const assetId = (await uploadFile(baseURL!, cookie, project.id, {
      body: Buffer.from(portrait),
      name: 'andrea.png',
      type: 'image/png',
    }))!;
    await waitForAssets(baseURL!, cookie, [assetId]);
    const doc = createBoardDoc(project.rootBoardId);
    const andrea = createElement(
      doc,
      'character',
      { x: 200, y: 200 },
      { name: 'andrea', assetId },
      { userId: null },
    );
    await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
    const saved = async () => {
      const board = await readBoard(baseURL!, cookie, project.rootBoardId);
      const map = roots(board).elements.get(andrea.id);
      return map ? readElement(map) : null;
    };

    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
    const card = page.locator(`[data-el="${andrea.id}"]`);
    await card.click();
    const handle = page.locator('[data-handle="se"]');
    /** Distance between the bottom right handle and the card's bottom edge, in screen px. */
    const gap = async () => {
      const c = (await card.boundingBox())!;
      const h = (await handle.boundingBox())!;
      return Math.abs(h.y + h.height / 2 - (c.y + c.height));
    };
    const drag = async (dx: number, name: string) => {
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + dx, h.y + 60, { steps: 20 });
      // Still held: the selection follows the card as its content reflows.
      await expect.poll(gap).toBeLessThan(6);
      if (shots) await page.screenshot({ path: `${shots}/character-resize-${theme}-${name}.png` });
      await page.mouse.up();
      await expect.poll(gap).toBeLessThan(6);
    };

    // Past 260 px the portrait doubles and the card grows taller.
    const before = (await card.boundingBox())!;
    await drag(260, 'wide');
    expect((await card.boundingBox())!.height).toBeGreaterThan(before.height + 20);
    await expect.poll(async () => (await saved())?.w).toBeGreaterThan(before.width + 200);
    // Back under 260 px it gets shorter again, and keeps the width it was given.
    await drag(-260, 'narrow');
    expect((await card.boundingBox())!.height).toBeCloseTo(before.height, 0);
    await expect.poll(async () => (await saved())?.w).toBeLessThan(before.width + 40);
  });
}
