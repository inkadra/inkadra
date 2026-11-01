// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

/** Repackage the already bundled OFL font's WOFF tables as SFNT; no new binary fixture. */
function sfntFromWoff(woff: Buffer): Buffer {
  const count = woff.readUInt16BE(12);
  const output = Buffer.alloc(woff.readUInt32BE(16));
  output.writeUInt32BE(woff.readUInt32BE(4));
  output.writeUInt16BE(count, 4);
  const power = Math.floor(Math.log2(count));
  output.writeUInt16BE(16 * 2 ** power, 6);
  output.writeUInt16BE(power, 8);
  output.writeUInt16BE(count * 16 - 16 * 2 ** power, 10);
  let cursor = 12 + count * 16;
  let headOffset = 0;
  for (let i = 0; i < count; i++) {
    const source = 44 + i * 20;
    const target = 12 + i * 16;
    const offset = woff.readUInt32BE(source + 4);
    const compressed = woff.readUInt32BE(source + 8);
    const length = woff.readUInt32BE(source + 12);
    const bytes = woff.subarray(offset, offset + compressed);
    const decoded = compressed === length ? bytes : inflateSync(bytes, { maxOutputLength: length });
    woff.copy(output, target, source, source + 4);
    output.writeUInt32BE(woff.readUInt32BE(source + 16), target + 4);
    output.writeUInt32BE(cursor, target + 8);
    output.writeUInt32BE(length, target + 12);
    decoded.copy(output, cursor);
    if (woff.toString('ascii', source, source + 4) === 'head') headOffset = cursor;
    cursor += Math.ceil(length / 4) * 4;
  }
  output.writeUInt32BE(0, headOffset + 8);
  let sum = 0;
  for (let i = 0; i < output.length; i += 4) sum = (sum + output.readUInt32BE(i)) >>> 0;
  output.writeUInt32BE((0xb1b0afba - sum) >>> 0, headOffset + 8);
  return output;
}

test('3D and font cards on a real board', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
  const cookie = await signIn(base, admin);
  const response = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: '3D and font previews' }),
  });
  expect(response.ok).toBeTruthy();
  const { id: projectId, rootBoardId } = await response.json();
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ indices: 0 }] }],
      accessors: [{ count: 36 }],
    }).padEnd(160),
  );
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(180, 8);
  header.writeUInt32LE(160, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const fontDir = '../apps/web/node_modules/@fontsource/fraunces/files';
  const woff = await readFile(join(fontDir, 'fraunces-latin-400-normal.woff'));
  const files = [
    { name: 'cube.glb', type: 'model/gltf-binary', body: Buffer.concat([header, json]) },
    { name: 'Fraunces-Regular.ttf', type: 'font/ttf', body: sfntFromWoff(woff) },
    { name: 'Fraunces-Regular.woff', type: 'font/woff', body: woff },
    {
      name: 'Fraunces-Regular.woff2',
      type: 'font/woff2',
      body: await readFile(join(fontDir, 'fraunces-latin-400-normal.woff2')),
    },
  ];
  const ids: string[] = [];
  for (const file of files) {
    const id = await uploadFile(base, cookie, projectId, file);
    if (!id) throw new Error('upload failed');
    ids.push(id);
  }
  await waitForAssets(base, cookie, ids);
  const doc = new Y.Doc();
  initBoardDoc(doc, rootBoardId);
  ids.forEach((assetId, i) => {
    createElement(
      doc,
      'file',
      { x: (i % 2) * 300, y: Math.floor(i / 2) * 250 },
      { w: 260, assetId },
      { userId: null },
    );
  });
  await pushBoardDoc(base, cookie, rootBoardId, doc);
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.goto(`/p/${projectId}/b/${rootBoardId}`);
  await expect(page.locator('.model-tile')).toBeVisible();
  await expect(page.locator('.fcard__meta').filter({ hasText: '12 poligoni' })).toBeVisible();
  const fonts = page.locator('.fcard[data-family="font"]');
  await expect(fonts).toHaveCount(3);
  for (const extension of ['.ttf', '.woff', '.woff2']) {
    const card = fonts.filter({
      has: page.locator('.fcard__ext', {
        hasText: new RegExp(`^${extension.replace('.', String.raw`\.`)}$`),
      }),
    });
    await expect(card.locator('.fcard__meta')).toContainText(/Fraunces · Regular · \d+ glifi/);
    await expect(card.locator('[data-font-loaded="true"]')).toBeVisible();
  }
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  // Verify the actual glyph font used by Chromium, not just a CSS declaration or load flag.
  const { root } = await session.send('DOM.getDocument');
  for (let i = 0; i < 3; i++) {
    // Use an id on the specimen so a global DOM query stays independent of canvas wrappers.
    await fonts
      .nth(i)
      .locator('.font-specimen > span')
      .first()
      .evaluate((el, id) => {
        el.id = id;
      }, `font-glyphs-${i}`);
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `#font-glyphs-${i}`,
    });
    const result = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(
      result.fonts.some(
        (font) => font.isCustomFont && font.glyphCount > 0 && font.familyName.includes('Fraunces'),
      ),
    ).toBe(true);
  }
  await session.detach();
  const dir = process.env.MODEL_FONT_SCREENSHOTS ?? info.outputPath();
  mkdirSync(dir, { recursive: true });
  for (const [device, width, height] of [
    ['desktop', 1440, 900],
    ['phone', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(fonts.locator('[data-font-loaded="true"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Adatta alla vista', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.keyboard.press('Escape');
      await page.screenshot({
        path: join(dir, `model-font-${device}-${theme}.png`),
        animations: 'disabled',
      });
      const ttf = fonts.filter({ has: page.locator('.fcard__ext', { hasText: '.ttf' }) });
      await ttf.locator('.fcard__footer').dblclick();
      const specimen = page.locator('.font-specimen--viewer[data-font-loaded="true"]');
      await expect(specimen).toBeVisible();
      const text = page.getByRole('textbox', { name: 'Testo di esempio' });
      await text.fill('Aa — Fraunces\nInkadra 123');
      await expect(text).toHaveValue('Aa — Fraunces\nInkadra 123');
      await expect(page.locator('.viewer__thumbnails img')).toHaveCount(0);
      await expect(
        page.locator('.viewer__thumb-placeholder').filter({ hasText: 'WOFF2' }),
      ).toBeVisible();
      await text.evaluate((el) => {
        if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
        el.scrollTop = 0;
      });
      expect(await text.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
        'inkadra-font-',
      );
      await page.screenshot({
        path: join(dir, `model-font-viewer-${device}-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(specimen).toBeHidden();
    }
  }
});
