// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { addTodoItem, createElement, moveIntoParent } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

/** Portrait with transparent edges and translucent stripes, for the alpha/contain checks. */
function portraitPng() {
  const w = 180,
    h = 320;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const alpha = x < 25 || x > 155 || y < 20 || y > 300 ? 0 : y % 40 < 20 ? 128 : 255;
      rows.set([100, 110, 120, alpha], y * (w * 4 + 1) + 1 + x * 4);
    }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const width of [1280, 390]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`QA08 polish ${width} ${theme}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      const base = baseURL!;
      const cookie = await signIn(base, {
        name: 'Giulia',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      });
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const at = pair.indexOf('=');
          return { name: pair.slice(0, at), value: pair.slice(at + 1), url: base };
        }),
      );
      await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await page.goto('/');
      await page.request.patch('/api/v1/me/preferences', {
        headers: { origin: base },
        data: { keepAroundContent: false },
      });
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: base },
        data: { name: 'QA 0.8 polish' },
      });
      expect(response.ok()).toBeTruthy();
      const project = await response.json();
      const assetId = await uploadFile(base, cookie, project.id, {
        body: readFileSync(new URL('../../docs/assets/social-preview.png', import.meta.url)),
        name: 'Reference.png',
        type: 'image/png',
      });
      if (!assetId) throw new Error('Upload failed');
      await waitForAssets(base, cookie, [assetId]);
      const portrait = await uploadFile(base, cookie, project.id, {
        body: portraitPng(),
        name: 'Portrait.png',
        type: 'image/png',
      });
      if (!portrait) throw new Error('Portrait upload failed');
      await waitForAssets(base, cookie, [portrait]);
      const previewResponse = await page.request.post('/api/v1/map-previews', {
        headers: { origin: base },
        data: { projectId: project.id, url: 'https://www.openstreetmap.org/#map=16/45.46/9.19' },
      });
      expect(previewResponse.ok()).toBeTruthy();
      const preview = await previewResponse.json();
      const doc = createBoardDoc(project.rootBoardId);
      const image = createElement(
        doc,
        'image',
        { x: 80, y: 160 },
        { assetId, w: 240 },
        { userId: null },
      );
      const todo = createElement(
        doc,
        'todo',
        { x: width === 390 ? 80 : 450, y: 320 },
        { title: 'Preparazione set', items: [], w: 280 },
        { userId: null },
      );
      addTodoItem(doc, todo.id, 'Controllare le batterie');
      const map = createElement(
        doc,
        'map',
        { x: 80, y: 650 },
        {
          name: 'Milano',
          lat: 45.46,
          lon: 9.19,
          zoom: 16,
          imageAssetId: preview.imageAssetId,
          w: 280,
        },
        { userId: null },
      );
      const tray = createElement(
        doc,
        'image',
        { x: 0, y: 0 },
        { assetId, w: 240 },
        { userId: null },
      );
      const alpha = createElement(
        doc,
        'image',
        { x: width === 390 ? 80 : 450, y: 420 },
        { assetId: portrait, w: 100 },
        { userId: null },
      );
      const vertical = createElement(
        doc,
        'image',
        { x: 0, y: 0 },
        { assetId: portrait, w: 240 },
        { userId: null },
      );
      moveIntoParent(doc, [tray.id, vertical.id], 'unsorted', 0);
      await pushBoardDoc(base, cookie, project.rootBoardId, doc);
      await page.evaluate(
        (id) =>
          localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
        project.rootBoardId,
      );
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      const shot = async (name: string) => {
        if (!process.env.QA08_SHOTS) return;
        mkdirSync(process.env.QA08_SHOTS, { recursive: true });
        if (!name.includes('during')) await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(process.env.QA08_SHOTS, `${width}-${theme}-${name}.png`),
          animations: 'disabled',
        });
      };
      const card = page.locator(`.card[data-el="${image.id}"]`);
      await expect(card.locator('img')).toBeVisible();
      await card.click();
      const handle = page.locator('[data-resize-el] .card__handle--se');
      const hit = (await handle.boundingBox())!;
      expect(hit.width).toBeGreaterThanOrEqual(24);
      expect(hit.height).toBeGreaterThanOrEqual(24);
      expect(await handle.evaluate((el) => getComputedStyle(el, '::after').borderRadius)).toBe(
        '50%',
      );
      await shot('handles');
      // The bar keeps its place over the card while a top corner is dragged and while the board
      // zooms, frame by frame, not only once the gesture settles.
      const gap = () =>
        page.evaluate(() => {
          const bar = document.querySelector('.ctxbar')!.getBoundingClientRect();
          const box = document.querySelector('[data-resize-el]')!.getBoundingClientRect();
          return { gap: Math.round(box.top - bar.bottom), top: box.top };
        });
      const before = await gap();
      const ne = (await page.locator('[data-resize-el] .card__handle--ne').boundingBox())!;
      await page.mouse.move(ne.x + ne.width / 2, ne.y + ne.height / 2);
      await page.mouse.down();
      await page.mouse.move(ne.x + ne.width / 2 + 80, ne.y + ne.height / 2 - 80, { steps: 6 });
      await shot('during-resize-toolbar');
      const during = await gap();
      expect(during.top).toBeLessThan(before.top - 20);
      expect(Math.abs(during.gap - before.gap)).toBeLessThanOrEqual(1);
      await page.mouse.up();
      const frames = await page.evaluate(async () => {
        const canvas = document.querySelector('.canvas')!;
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            ctrlKey: true,
            deltaY: -240,
            clientX: 350,
            clientY: 350,
            bubbles: true,
            cancelable: true,
          }),
        );
        const top = () => document.querySelector('[data-resize-el]')!.getBoundingClientRect().top;
        const seen: { gap: number; below: number; top: number }[] = [];
        const start = top();
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame);
          const bar = document.querySelector('.ctxbar')!.getBoundingClientRect();
          const box = document.querySelector('[data-resize-el]')!.getBoundingClientRect();
          seen.push({
            gap: Math.round(box.top - bar.bottom),
            below: Math.round(bar.top - box.bottom),
            top: box.top,
          });
        }
        return { seen, start };
      });
      expect(new Set([frames.start, ...frames.seen.map((f) => f.top)]).size).toBeGreaterThan(1);
      // Above the card, or 8px under it once there is no room above (a phone zoomed in).
      for (const f of frames.seen)
        expect(Math.min(Math.abs(f.gap - before.gap), Math.abs(f.below - 8))).toBeLessThanOrEqual(
          1,
        );
      await shot('zoom-toolbar');
      await card.dblclick();
      const viewer = page.locator('.viewer');
      await expect(viewer).toBeVisible();
      await viewer.getByRole('button', { name: 'Ingrandisci', exact: true }).click();
      await expect(page.locator('.viewer__image-plane')).toHaveCSS('transform', /1\.5/);
      await shot('viewer-zoom');
      const imagePlane = page.locator('.viewer__image-plane');
      const center = (await viewer.boundingBox())!;
      await page.mouse.move(center.x + 220, center.y + 300);
      await page.mouse.down();
      await page.mouse.move(center.x + 260, center.y + 330, { steps: 5 });
      await page.mouse.up();
      await expect(imagePlane).not.toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)');
      await page.mouse.wheel(0, -40);
      const touch = await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
      const view = (await page.locator('.viewer__image-view').boundingBox())!;
      const mid = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
      const beforePinch = await imagePlane.getAttribute('style');
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: mid.x - 50, y: mid.y, id: 1 },
          { x: mid.x + 50, y: mid.y, id: 2 },
        ],
      });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: mid.x - 90, y: mid.y, id: 1 },
          { x: mid.x + 90, y: mid.y, id: 2 },
        ],
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(imagePlane).not.toHaveAttribute('style', beforePinch!);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await touch.detach();
      await viewer.getByRole('img').first().dblclick();
      await expect(imagePlane).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      await viewer.getByRole('img').first().dblclick();
      await expect(imagePlane).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)');
      await viewer.getByRole('button', { name: '200%', exact: true }).click();
      await page.locator('.viewer__image-view').click({ position: { x: 8, y: 8 } });
      await expect(viewer).toBeHidden();
      await page.locator('.zoom__value').click();
      await expect(page.locator('.zoom__value')).toHaveText('100%');
      await expect(
        page.locator(`.card[data-el="${todo.id}"] .card__todo-list li`).first(),
      ).toHaveCSS('font-size', '15px');
      await shot('todo-100');
      if (width >= 768) {
        // The floating panels keep their glass while the board pans under them (QA 0.8).
        const glass = () =>
          page.evaluate(
            () =>
              getComputedStyle(document.querySelector('.ink-sidebar')!, '::before').backdropFilter,
          );
        expect(await glass()).toContain('blur');
        await page.mouse.move(700, 120);
        await page.mouse.down({ button: 'middle' });
        await page.mouse.move(640, 160, { steps: 4 });
        await expect(page.locator('.canvas--moving')).toHaveCount(1);
        expect(await glass()).toContain('blur');
        await page.mouse.up({ button: 'middle' });
      }
      await card.click();
      const danger = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--ink-status-danger').trim(),
      );
      const red = await page.evaluate((c) => {
        const probe = document.createElement('span');
        probe.style.color = c;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, danger);
      const lock = page
        .locator('.ctxbar')
        .getByRole('button', { name: 'Blocca posizione', exact: true });
      // Red marks the locked state only, not an action to avoid.
      await expect(lock).not.toHaveCSS('color', red);
      await lock.click();
      await expect(card.locator('.card__lock')).toBeVisible();
      await expect(card.locator('.card__lock')).toHaveCSS('color', red);
      await expect(
        page.locator('.ctxbar').getByRole('button', { name: 'Sblocca', exact: true }),
      ).toHaveCSS('color', red);
      await shot('locked');
      await page.locator('.ctxbar').getByRole('button', { name: 'Sblocca', exact: true }).click();
      await page
        .locator('.ctxbar')
        .getByRole('button', { name: 'Commenti e revisione', exact: true })
        .click();
      await expect(page.locator('.comments-panel')).toBeVisible();
      await expect(page.locator('.comments-panel__body')).toHaveCSS('scrollbar-width', 'none');
      await expect(page.locator('.comments-panel').getByText('Tutte le discussioni')).toHaveCount(
        0,
      );
      await shot('comments');
      await page.locator('.comments-panel__head button').click();
      await page.locator('.unsorted__toggle').click();
      await expect(page.locator('.unsorted__panel')).toBeVisible();
      await expect(page.locator('.unsorted__panel img').first()).toHaveCSS('object-fit', 'contain');
      // Two pictures fit their tiles whole instead of being squashed into strips.
      for (const media of await page.locator('.unsorted__panel .card__media').all())
        expect((await media.boundingBox())!.height).toBeGreaterThanOrEqual(139);
      await shot('drawer');
      await page.locator('.unsorted__toggle').click();
      await expect(page.locator('.unsorted__panel:not(.ink-motion-exit)')).toHaveCount(0);
      const alphaCard = page.locator(`.card[data-el="${alpha.id}"]`);
      await alphaCard.click();
      await shot('alpha-before-drag');
      const alphaBox = (await alphaCard.boundingBox())!;
      await page.mouse.move(alphaBox.x + 40, alphaBox.y + 40);
      await page.mouse.down();
      await page.mouse.move(alphaBox.x + 65, alphaBox.y + 60, { steps: 8 });
      await shot('alpha-during-drag');
      await page.mouse.up();
      await shot('alpha-after-drag');
      const mapCard = page.locator(`.card[data-el="${map.id}"]`);
      await page.mouse.move(width - 20, 450);
      await page.mouse.wheel(0, 350);
      // Satellite tiles come only through Inkadra's proxy, never from the tile server directly.
      const direct: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/satellite/')) direct.push(r.url());
      });
      await mapCard.getByRole('button', { name: 'Satellite', exact: true }).click();
      await expect(mapCard.locator('.mcard__static')).toBeVisible();
      await expect
        .poll(() => mapCard.locator('.leaflet-tile-loaded[src*="layer=satellite"]').count())
        .toBeGreaterThan(0);
      await expect(mapCard.locator('.mcard__satellite-credit')).toBeVisible();
      await shot('satellite-picture');
      await mapCard.getByRole('button', { name: /Esplora/ }).click();
      await expect(mapCard.locator('.mcard__live:not(.mcard__static)')).toBeVisible();
      await expect(mapCard.locator('.leaflet-tile-loaded').first()).toHaveCSS('opacity', '1');
      await shot('satellite-interactive');
      await mapCard.getByRole('button', { name: 'Mappa', exact: true }).click();
      expect(direct).toEqual([]);
      await shot('board');
    });
  }
}
