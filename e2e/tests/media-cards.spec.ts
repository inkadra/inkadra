// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const fixtures = fileURLToPath(new URL('../../apps/server/src/media/fixtures/', import.meta.url));
const fixture = (name: string) => readFile(join(fixtures, name));

let projectId: string;
let rootBoardId: string;
let cookie: string;

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  cookie = await signIn(base, admin);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Schede dei file' }),
  });
  if (!res.ok) throw new Error(`project: ${res.status} ${await res.text()}`);
  ({ id: projectId, rootBoardId } = (await res.json()) as { id: string; rootBoardId: string });
});

test('uploaded PDF and ProRes files get their badges, page count and playable copy', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInPage(page);
  await page.goto(`/p/${projectId}/b/${rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: await fixture('two-pages.pdf') },
    {
      name: 'prores-proxy.mov',
      mimeType: 'video/quicktime',
      buffer: await fixture('prores-proxy.mov'),
    },
  ]);

  const pdf = page.locator('[data-type="file"]', { hasText: 'two-pages' });
  const video = page.locator('[data-type="file"]', { hasText: 'prores-proxy' });
  await expect(pdf).toHaveCount(1, { timeout: 30_000 });
  await expect(video).toHaveCount(1, { timeout: 30_000 });

  // PDF: red document badge, the extension kept, two pages read by poppler, page 1 rendered.
  await expect(pdf.locator('.fcard__ext')).toHaveText('.pdf');
  await expect(pdf.locator('.fbadge')).toHaveText('PDF');
  await expect(pdf.locator('.fbadge')).toHaveClass(/fbadge--doc/);
  await expect(pdf.locator('.fcard__meta')).toContainText('2 pagine', { timeout: 60_000 });
  await expect(pdf.locator('img.fcard__page')).toBeVisible();

  // ProRes: violet badge naming the codec, frame rate from the probe, then the play button
  // once the worker has made the playable copy.
  await expect(video.locator('.fbadge')).toHaveText('PRORES', { timeout: 60_000 });
  await expect(video.locator('.fbadge')).toHaveClass(/fbadge--video/);
  await expect(video.locator('.fcard__meta')).toContainText('12 fps');
  await expect(video.locator('.fcard__play')).toBeVisible({ timeout: 60_000 });

  // Both uploads land near the middle, the video 24 px lower and to the right: move it away
  // by the strip only it covers, so each card can be opened.
  const box = await video.boundingBox();
  if (!box) throw new Error('video card has no box');
  await page.mouse.move(box.x + box.width - 6, box.y + box.height - 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 300, box.y + box.height - 12, { steps: 8 });
  await page.mouse.up();

  // Opening the card shows the shared viewer, which plays the copy, not the original.
  await video.locator('.fcard__footer').dblclick();
  const viewer = page.getByRole('dialog', { name: 'prores-proxy.mov' });
  await expect(viewer.locator('video')).toHaveAttribute('src', /\/proxy$/);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // There is no PDF view yet: the viewer shows page 1, the page count and the download.
  await pdf.locator('.fcard__footer').dblclick();
  const pdfViewer = page.getByRole('dialog', { name: 'two-pages.pdf' });
  await expect(pdfViewer.getByText('Pagina 1 di 2')).toBeVisible();
  await expect(pdfViewer.locator('.viewer__pdf-bar a[download]')).toHaveAttribute(
    'href',
    /\/file$/,
  );
  await page.keyboard.press('Escape');
});

/** A solid PNG with a soft diagonal, for the photo of the family board. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      rows.set(
        [Math.round(31 + t * 91), Math.round(58 + t * 102), Math.round(42 + t * 80)],
        o + 1 + x * 3,
      );
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Half a second of a 440 Hz tone, 8 kHz mono WAV. */
function wav(): Buffer {
  const samples = 4000;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 8000) * 8000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('one card per file type, as in the approved mockup', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const gpx =
    '<?xml version="1.0"?><gpx version="1.1" creator="inkadra"><trk><trkseg>' +
    '<trkpt lat="46.33" lon="9.55"/><trkpt lat="46.34" lon="9.57"/></trkseg></trk></gpx>';
  const files: Array<{ name: string; type: string; body: Buffer }> = [
    {
      name: 'intervista-A001.mov',
      type: 'video/quicktime',
      body: await fixture('prores-proxy.mov'),
    },
    { name: 'drone-B014.mov', type: 'video/quicktime', body: await fixture('prores-proxy.mov') },
    { name: 'nota-vocale-regista.wav', type: 'audio/wav', body: wav() },
    { name: 'bosco-alba.png', type: 'image/png', body: png(600, 400) },
    {
      name: 'athlete-guide-2026.pdf',
      type: 'application/pdf',
      body: await fixture('two-pages.pdf'),
    },
    { name: 'DSCF4417.dng', type: 'image/x-adobe-dng', body: await fixture('orientation-6.dng') },
    { name: 'trattamento-v3.docx', type: 'application/octet-stream', body: Buffer.alloc(2048) },
    { name: 'poster-locandina.psd', type: 'application/octet-stream', body: Buffer.alloc(4096) },
    { name: 'val-bregaglia-trail.gpx', type: 'application/gpx+xml', body: Buffer.from(gpx) },
    { name: 'Recoleta-Bold.otf', type: 'application/octet-stream', body: Buffer.alloc(1024) },
    { name: 'set-cucina.glb', type: 'application/octet-stream', body: Buffer.alloc(3072) },
    {
      name: 'consegna-cliente.zip',
      type: 'application/zip',
      body: Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(18)]),
    },
  ];
  const ids: string[] = [];
  for (const file of files) {
    const id = await uploadFile(base, cookie, projectId, file);
    if (!id) throw new Error(`upload of ${file.name} failed`);
    ids.push(id);
  }
  await waitForAssets(base, cookie, ids);

  const res = await fetch(`${base}/api/v1/projects/${projectId}/boards`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      title: 'Famiglia delle card',
      kind: 'board',
      parentBoardId: rootBoardId,
    }),
  });
  if (!res.ok) throw new Error(`board: ${res.status} ${await res.text()}`);
  const boardId = ((await res.json()) as { id: string }).id;
  const doc = new Y.Doc();
  initBoardDoc(doc, boardId);
  ids.forEach((assetId, i) => {
    const type = files[i]?.type === 'image/png' ? 'image' : 'file';
    createElement(
      doc,
      type,
      { x: 40 + (i % 4) * 250, y: 40 + Math.floor(i / 4) * 300 },
      { w: 230, assetId },
      { userId: null },
    );
  });
  await pushBoardDoc(base, cookie, boardId, doc);

  // The "Preparing preview" state of a long camera file, shown on the second video.
  const preparing = ids[1] as string;
  await page.route(`**/api/v1/assets/${preparing}`, async (route) => {
    const response = await route.fetch();
    const asset = await response.json();
    await route.fulfill({
      response,
      json: {
        ...asset,
        proxy: { ...asset.proxy, status: 'processing', progress: 42, url: null },
      },
    });
  });

  await signInPage(page);
  await page.goto(`/p/${projectId}/b/${boardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('.fcard')).toHaveCount(ids.length - 1);
  await expect(page.locator('.fbadge').filter({ hasText: 'RAW' })).toHaveCount(1);
  await expect(page.locator('.fcard__prep')).toContainText('42%');
  await page.keyboard.press('Shift+Digit1');

  const dir = process.env.FILE_CARDS_SCREENSHOTS ?? info.outputPath();
  mkdirSync(dir, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.screenshot({ path: join(dir, `file-cards-${theme}.png`), animations: 'disabled' });
  }
});
