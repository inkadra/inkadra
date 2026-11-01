import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const NAME = 'Val Bregaglia';
let seeded: { projectId: string; storyboardId: string };

/** A small solid PNG, as a logo would be. */
function pngLogo(width: number, height: number): Buffer {
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Fonts, fill colours and pictures drawn on each page of a PDF. */
async function readPdf(path: string) {
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(path)),
    fontExtraProperties: true,
  }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const ops = await page.getOperatorList();
    const fonts = new Set<string>();
    const fills = new Set<string>();
    let images = 0;
    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.setFont)
        fonts.add(String((page.commonObjs.get(args[0] as string) as { name?: string }).name));
      if (fn === OPS.setFillRGBColor) fills.add(String(args[0]).toLowerCase());
      if (fn === OPS.paintImageXObject) images++;
    });
    const text = (await page.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push({ fonts: [...fonts].join(' '), fills: [...fills], images, text });
  }
  return pages;
}

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const post = async <T>(path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const project = await post<{ id: string; rootBoardId: string }>('/projects', { name: NAME });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'La salita',
  });
  const doc = new Y.Doc();
  initBoardDoc(doc, storyboard.id);
  const scene = addScene(doc, { number: '2', title: 'La salita' }, { userId: null });
  for (const action of ['Sentiero da Pianazzola', 'Controcampo'])
    addFrame(doc, scene.id, null, { action, shot: 'ws' }, { userId: null });
  await pushBoardDoc(base, cookie, storyboard.id, doc);
  seeded = { projectId: project.id, storyboardId: storyboard.id };
});

test('the project theme dresses the presentation and the PDF', async ({ page }, info) => {
  await signInPage(page);
  await page.getByRole('link', { name: 'Progetti', exact: true }).first().click();
  await page
    .getByRole('button', { name: `Opzioni progetto: ${NAME}` })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Aspetto del progetto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aspetto del progetto' });
  await dialog.getByRole('tab', { name: 'Presentazione' }).click();
  await expect(dialog.getByText('colore del progetto')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Petrolio' }).click();
  await dialog.getByRole('radio', { name: /^Fraunces/ }).click();
  // The logo is the export logo, saved at once.
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'logo-valbregaglia.png',
    mimeType: 'image/png',
    buffer: pngLogo(120, 120),
  });
  await expect(dialog.getByText('logo-valbregaglia.png')).toBeVisible({ timeout: 30_000 });
  if (process.env.THEME_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.THEME_SCREENSHOTS}/dialog-desktop-dark.png` });
  await dialog.getByRole('button', { name: 'Salva' }).click();
  await expect(dialog).toBeHidden();
  const stored = await (
    await page.request.get(`/api/v1/projects/${seeded.projectId}/export-settings`)
  ).json();
  expect(stored.theme).toEqual({ accent: 'teal', headingFont: 'fraunces' });
  expect(stored.logo).toMatchObject({ filename: 'logo-valbregaglia.png' });

  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Presenta', exact: true }).click();
  const present = page.getByRole('dialog', { name: 'Presenta' });
  await expect(present.locator('.present-header__logo')).toBeVisible();
  const label = present.locator('.present-stage__shot-label');
  await expect(label).toHaveCSS('font-family', /Inkadra Fraunces/);
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('600 16px "Inkadra Fraunces"')))
    .toBe(true);
  // Dark theme: the teal tag colour.
  await expect(present.locator('.present-progress__bar')).toHaveCSS(
    'background-color',
    'rgb(96, 216, 235)',
  );
  if (process.env.THEME_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.THEME_SCREENSHOTS}/presentation-dark.png` });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const exporter = page.getByRole('dialog', { name: 'Esporta' });
  await exporter.getByRole('checkbox', { name: /Copertina/ }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exporter.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const path = info.outputPath('theme.pdf');
  await download.saveAs(path);
  const [cover, content] = await readPdf(path);
  // Headings in Fraunces, body in Inter; on paper, the darker teal of the light theme.
  expect(cover?.fonts).toMatch(/Fraunces/);
  expect(cover?.text).toContain('La salita');
  expect(cover?.fills).toContain('#1e809c');
  expect(cover?.images).toBeGreaterThan(0);
  expect(content?.fonts).toMatch(/Fraunces/);
  expect(content?.fonts).toMatch(/Inter/);
  expect(content?.text).toContain('Sentiero da Pianazzola');
});
