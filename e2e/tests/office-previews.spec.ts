// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = { name: 'Giulia Bianchi', email: 'giulia@example.com', password: 'correct-horse-battery' };
test('CSV upload previews inert cells, creates the first sheet and undoes without removing the file', async ({ page, baseURL }) => {
  const base = baseURL!;
  const cookie = await signIn(base, account);
  await page.context().addCookies(cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }; }));
  await page.goto('/');
  const res = await page.request.post('/api/v1/projects', { headers: { origin: base }, data: { name: 'Office previews' } });
  expect(res.ok()).toBe(true);
  const project = await res.json();
  const id = await uploadFile(base, cookie, project.id, { body: Buffer.from('Oggetto,Qtà,Reparto\r\nPannello LED,2,Elettricisti\r\nBandiere nere,4,Macchinisti\r\nRadiomicrofono,3,Suono\r\n=1+1,1,<script>bad</script>'), name: 'ordine-materiale.csv', type: 'text/csv' });
  expect(id).toBeTruthy();
  await waitForAssets(base, cookie, [id!]);
  const manifest = await page.request.get(`/api/v1/assets/${id}/office/manifest.json`);
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).sheets[0].rows[4][0]).toBe('=1+1');
  const doc = createBoardDoc(project.rootBoardId);
  const file = createElement(doc, 'file', { x: 80, y: 80 }, { assetId: id!, w: 250 }, { userId: null });
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  const card = page.locator(`[data-el="${file.id}"]`);
  await expect(card).toBeVisible();
  await card.dblclick();
  const viewer = page.getByRole('dialog', { name: 'ordine-materiale.csv' });
  await expect(viewer.getByRole('cell', { name: '=1+1', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  if (process.env.OFFICE_SHOTS) {
    mkdirSync(process.env.OFFICE_SHOTS, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 820 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(process.env.OFFICE_SHOTS, `csv-${width}-${theme}.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  await viewer.getByRole('button', { name: 'Trasforma in tabella', exact: true }).filter({ visible: true }).click();
  await expect(viewer).not.toBeVisible();
  await expect(page.locator('.tcard')).toHaveCount(1);
  await expect(card).toBeVisible();
  if (process.env.OFFICE_SHOTS) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 820 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(process.env.OFFICE_SHOTS, `table-toast-${width}-${theme}.png`) });
      }
    }
  }
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(page.locator('.tcard')).toHaveCount(0);
  await expect(card).toBeVisible();
});
