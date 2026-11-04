// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, newTable } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
async function screenshot(page: Page, name: string) {
  const dir = process.env.CONTEXTUAL_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({ path: join(dir, `${name}-${theme}.png`), animations: 'disabled' });
  }
}
for (const width of [1280, 390]) {
  test.describe(`contextual A ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('one bar changes modes, keeps selection, and persists note/section/image/table changes', async ({
      page,
      baseURL,
    }) => {
      const base = baseURL as string;
      const cookie = await signIn(base, account);
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
        }),
      );
      await page.request.patch('/api/v1/me/preferences', {
        headers: { origin: base },
        data: { keepAroundContent: false },
      });
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: base },
        data: { name: 'Contextual toolbar A' },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      const assetId = await uploadFile(base, cookie, project.id, {
        body: readFileSync(new URL('../../docs/assets/social-preview.png', import.meta.url)),
        name: 'reference.png',
        type: 'image/png',
      });
      if (!assetId) throw new Error('Upload failed');
      await waitForAssets(base, cookie, [assetId]);
      const doc = createBoardDoc(project.rootBoardId);
      const opts = { userId: null };
      const note = createElement(doc, 'note', { x: 24, y: 120 }, { w: 280 }, opts);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Prima selezione dopo')]);
      (roots(doc).elements.get(note.id)!.get('body') as Y.XmlFragment).insert(0, [p]);
      const section = createElement(
        doc,
        'section',
        { x: 24, y: 320 },
        { w: 280, title: 'Scena 14 · Esterno notte', size: 'M', bold: true },
        opts,
      );
      const image = createElement(
        doc,
        'image',
        { x: 24, y: 430 },
        { w: 120, assetId, caption: 'Riferimento · alba' },
        opts,
      );
      const table = createElement(
        doc,
        'table',
        { x: 24, y: 710 },
        { w: 280, ...newTable(2, 2), header: true },
        opts,
      );
      await pushBoardDoc(base, cookie, project.rootBoardId, doc);
      await page.goto('/');
      await page.evaluate(
        (id) =>
          localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
        project.rootBoardId,
      );
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      const card = page.locator(`[data-el="${note.id}"]`);
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.locator('.ctxbar')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Fatto', exact: true })).toHaveCount(0);
      await screenshot(page, `${width}-selection`);
      await page.keyboard.press('Enter');
      const editor = card.locator('[contenteditable=true]');
      await expect(editor).toBeVisible();
      await expect(
        page.locator('.ctxbar').getByRole('button', { name: 'Grassetto', exact: true }),
      ).toBeDisabled();
      await editor.press('Control+a');
      const bar = page.locator('.ctxbar');
      const origin = await bar.boundingBox();
      await bar.getByRole('button', { name: 'Grassetto', exact: true }).click();
      await expect(editor.locator('strong')).toHaveText('Prima selezione dopo');
      await bar
        .getByRole('button', { name: 'Dimensione, liste e allineamento', exact: true })
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Dimensione, liste e allineamento' }),
      ).toBeVisible();
      await screenshot(page, `${width}-note-typography`);
      if (width === 390) {
        await page.setViewportSize({ width, height: 500 });
        const popup = page.getByRole('dialog', { name: 'Dimensione, liste e allineamento' });
        await expect(popup).toBeVisible();
        // The popup moves on the resize event, which arrives after the viewport has changed.
        await expect
          .poll(async () => {
            const box = await popup.boundingBox();
            return box!.y + box!.height;
          })
          .toBeLessThanOrEqual(500);
        expect((await popup.boundingBox())!.y).toBeGreaterThanOrEqual(0);
        await screenshot(page, `${width}-short-viewport`);
        await page.setViewportSize({ width, height: 900 });
      }
      await bar.getByRole('button', { name: 'Colore testo ed evidenziatore', exact: true }).click();
      await expect(page.locator('.contextual-popover')).toHaveCount(1);
      await page
        .getByRole('dialog', { name: 'Colore testo ed evidenziatore' })
        .getByRole('button', { name: 'Colore testo: Turchese', exact: true })
        .first()
        .click();
      await expect(editor.locator('[data-ink-color=teal]')).toBeVisible();
      await screenshot(page, `${width}-note-colors`);
      await page.keyboard.press('Escape');
      await expect(editor).toBeVisible();
      await bar.getByRole('button', { name: 'Fatto', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(card.locator('[style*="--ink-tag-teal"]')).toBeVisible();
      await card.dblclick();
      await expect(editor).toBeVisible();
      const next = await bar.boundingBox();
      expect(Math.abs(next!.x - origin!.x)).toBeLessThan(3);
      await page.locator('.canvas').click({ position: { x: width - 30, y: 400 } });
      await expect(editor).toHaveCount(0);
      await expect(bar).toHaveCount(1);
      const heading = page.locator(`[data-el="${section.id}"]`);
      await heading.dblclick();
      await bar.getByRole('button', { name: 'Corsivo', exact: true }).click();
      await bar.getByRole('switch', { name: 'Linea', exact: true }).click();
      await expect(heading.locator('.has-rule')).toHaveCount(0);
      await screenshot(page, `${width}-section`);
      await bar.getByRole('button', { name: 'Fatto', exact: true }).click();
      const photo = page.locator(`[data-el="${image.id}"]`);
      await photo.dblclick();
      await bar.getByRole('button', { name: 'Ruota di 90° a destra', exact: true }).click();
      await bar.getByRole('button', { name: 'Disegna', exact: true }).click();
      const drawing = photo.locator('.image-drawing');
      await expect(drawing).toHaveCSS('pointer-events', 'auto');
      const picture = await drawing.boundingBox();
      await page.mouse.move(picture!.x + 30, picture!.y + 30);
      await page.mouse.down();
      await page.mouse.move(picture!.x + 80, picture!.y + 60, { steps: 5 });
      await page.mouse.up();
      await expect(drawing.locator('path')).toHaveCount(1);
      await screenshot(page, `${width}-image-drawing`);
      await bar.getByRole('button', { name: 'Fatto', exact: true }).click();
      if (width === 390) {
        await page.locator('.canvas').focus();
        await page.keyboard.down('Space');
        await page.mouse.move(360, 500);
        await page.mouse.down();
        await page.mouse.move(360, 280, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Space');
      }
      const grid = page.locator(`[data-el="${table.id}"]`);
      await grid.dblclick();
      if (width === 390) await bar.getByRole('button', { name: 'Righe', exact: true }).click();
      await page.getByRole('button', { name: 'Aggiungi riga', exact: true }).click();
      await expect(grid.locator('tr')).toHaveCount(3);
      await page.keyboard.press('Escape');
      await screenshot(page, `${width}-table`);
      await page.reload();
      await expect(page.locator(`[data-el="${image.id}"] .image-drawing path`)).toHaveCount(1);
      await expect(page.locator(`[data-el="${note.id}"] [style*="--ink-tag-teal"]`)).toHaveCount(1);
    });
    test('link appearance keeps metadata and video preview independent and preserves viewer entry', async ({
      page,
      baseURL,
    }) => {
      const base = baseURL as string;
      const cookie = await signIn(base, account);
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
        }),
      );
      await page.request.patch('/api/v1/me/preferences', {
        headers: { origin: base },
        data: { keepAroundContent: false },
      });
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: base },
        data: { name: 'Link appearance A' },
      });
      const project = await response.json();
      const doc = createBoardDoc(project.rootBoardId);
      const link = createElement(
        doc,
        'link',
        { x: 24, y: 150 },
        {
          w: 280,
          url: 'https://youtu.be/dQw4w9WgXcQ',
          title: 'Intervista',
          description: 'Appunti di regia',
        },
        { userId: null },
      );
      await pushBoardDoc(base, cookie, project.rootBoardId, doc);
      await page.goto('/');
      await page.evaluate(
        (id) =>
          localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
        project.rootBoardId,
      );
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      const card = page.locator(`[data-el="${link.id}"]`);
      await card.click();
      await page.locator('.ctxbar [aria-haspopup=menu]').last().click();
      await page.getByRole('menuitem', { name: 'Aspetto', exact: true }).click();
      const bar = page.locator('.ctxbar');
      await bar.getByRole('switch', { name: 'Info', exact: true }).click();
      await expect(card.getByText('Appunti di regia')).toHaveCount(0);
      await expect(card.locator('.card__play')).toBeVisible();
      await bar.getByRole('switch', { name: 'Anteprima', exact: true }).click();
      await expect(card.locator('.card__play')).toHaveCount(0);
      await bar.getByRole('switch', { name: 'Info', exact: true }).click();
      await expect(card.getByText('Appunti di regia')).toBeVisible();
      await expect(card.locator('.card__play')).toHaveCount(0);
      await screenshot(page, `${width}-link-appearance`);
      await bar.getByRole('button', { name: 'Fatto', exact: true }).click();
      await card.dblclick();
      await expect(page.locator('.viewer')).toBeVisible();
    });
  });
}
