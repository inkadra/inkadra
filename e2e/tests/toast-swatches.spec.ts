// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// The undoable summary toast (#310) and colour swatches: hex and RGB, copy, palette from an
// image (#308). Set E2E_SHOTS to a folder to also capture each state, light and dark.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

test.describe.configure({ mode: 'serial' });

const shots = process.env.E2E_SHOTS;
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const HEXES = ['#7A5C3E', '#3E6A7A', '#5C7A3E', '#C8742E'];
/** The toast on screen, not the copy of the last one fading out. */
const TOAST = '.toast:not(.ink-motion-exit)';

/** A warm-to-teal picture with bands of colour, so its palette has six clear entries. */
function bandsPng(width: number, height: number): Buffer {
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
  const bands = [
    [200, 116, 46],
    [122, 74, 42],
    [227, 185, 138],
    [44, 58, 42],
    [86, 102, 74],
    [15, 26, 31],
  ];
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    const [r, g, b] = bands[Math.floor((y / height) * bands.length)] as number[];
    for (let x = 0; x < width; x++) rows.set([r ?? 0, g ?? 0, b ?? 0], row + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Seeded {
  cookie: string;
  url: string;
  imageId: string;
  colorIds: string[];
  /** Colours the media worker found in the picture. */
  palette: number;
}

/** A board with a picture and four colour cards, in a project of its own. */
async function seed(base: string): Promise<Seeded> {
  const cookie = await signIn(base, account);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Rifugio Lagunc', type: 'short_film' }),
  });
  if (!res.ok) throw new Error(`project: ${res.status} ${await res.text()}`);
  const project = (await res.json()) as { id: string; rootBoardId: string };
  const assetId = await uploadFile(base, cookie, project.id, {
    body: bandsPng(300, 200),
    name: 'rifugio-tramonto.png',
    type: 'image/png',
  });
  if (!assetId) throw new Error('upload failed');
  await waitForAssets(base, cookie, [assetId]);
  const asset = (await (
    await fetch(`${base}/api/v1/assets/${assetId}`, { headers: { cookie } })
  ).json()) as { palette: string[] | null };
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null };
  const imageId = createElement(doc, 'image', { x: 80, y: 80 }, { w: 300, assetId }, opts).id;
  const colorIds = HEXES.map(
    (hex, i) => createElement(doc, 'color', { x: 80 + i * 132, y: 360 }, { hex }, opts).id,
  );
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  const url = `/p/${project.id}/b/${project.rootBoardId}`;
  return { cookie, url, imageId, colorIds, palette: asset.palette?.length ?? 0 };
}

async function open(page: Page, base: string, seeded: Seeded, view = 'canvas') {
  await page.context().addCookies(
    seeded.cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.goto(`${seeded.url}?view=${view}`);
}

/** Captures the page in both themes, when shots were asked for. */
async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.screenshot({ path: join(shots, `${name}-${theme}.png`), animations: 'disabled' });
  }
}

/** Copies the selection and pastes it back, through the board's own clipboard handlers. */
async function copyAndPaste(page: Page) {
  await page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
}

let seeded: Seeded;
test.beforeAll(async ({ baseURL }) => {
  seeded = await seed(baseURL as string);
});

test('pasting many cards sums them up in a toast that undoes them in one step', async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL as string, seeded);
  const cards = page.locator('.card--free');
  await expect(cards).toHaveCount(5);
  await page.keyboard.press('ControlOrMeta+a');
  await copyAndPaste(page);
  await expect(cards).toHaveCount(10);
  const toast = page.locator(TOAST);
  await expect(toast).toContainText('Incollati 1 immagine e 4 colori');
  await expect(toast.getByRole('button', { name: 'Mostra' })).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Chiudi l’avviso' })).toBeVisible();
  await shoot(page, '310-toast-desktop');

  // Show fits the view to the pasted cards and leaves the toast; Undo, from the keyboard,
  // takes the whole paste back.
  await toast.getByRole('button', { name: 'Mostra' }).click();
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Annulla' }).focus();
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(5);
  await expect(toast).toBeHidden();

  // After another edit Undo leaves the toast: it would take back that edit instead.
  await page.keyboard.press('ControlOrMeta+a');
  await copyAndPaste(page);
  await expect(toast.getByRole('button', { name: 'Annulla' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(toast.getByRole('button', { name: 'Annulla' })).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards).toHaveCount(5);
});

test('a swatch shows its hex, RGB and copy on hover, and an image makes a palette', async ({
  page,
  baseURL,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, baseURL as string, seeded);
  const swatch = page.locator(`.card--free[data-el="${seeded.colorIds[0]}"]`);
  await expect(swatch.locator('.card__color-hex')).toContainText('#7A5C3E');
  await expect(swatch.locator('.card__rgb')).toHaveCSS('opacity', '0');
  await swatch.hover();
  await expect(swatch.locator('.card__rgb')).toHaveText('122 92 62');
  await expect(swatch.locator('.card__rgb')).toHaveCSS('opacity', '1');
  await shoot(page, '308-swatch-hover-desktop');
  await swatch.getByRole('button', { name: 'Copia #7A5C3E (RGB 122 92 62)' }).click();
  await expect(page.locator(TOAST)).toHaveText('Copiato #7A5C3E');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#7A5C3E');
  await shoot(page, '308-copied-desktop');

  // Editing a swatch opens its picker beside the card: the square takes the arrow keys, the
  // fields take typed values, and copy copies the swatch's own new colour.
  await swatch.dblclick();
  const picker = page.getByRole('dialog', { name: 'Selettore colore' });
  await expect(picker).toBeVisible();
  const pickerBox = (await picker.boundingBox())!;
  const cardBox = (await swatch.boundingBox())!;
  expect(pickerBox.width).toBe(240);
  expect(pickerBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width);
  await expect(picker.getByRole('slider', { name: 'Saturazione e luminosità' })).toBeFocused();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(swatch.locator('.card__color-hex')).not.toContainText('#7A5C3E');
  // The card did not move: the arrows belong to the picker.
  expect((await swatch.boundingBox())?.x).toBe(cardBox.x);
  await picker.getByLabel('Rosso').fill('200');
  await picker.getByLabel('Verde').fill('92');
  await picker.getByLabel('Blu').fill('62');
  await expect(picker.getByLabel('Esadecimale')).toHaveValue('#C85C3E');
  await expect(swatch.locator('.card__color-hex')).toContainText('#C85C3E');
  await expect(picker.getByRole('button', { name: 'Usa #3E6A7A' })).toBeVisible();
  await picker.getByRole('button', { name: /^Copia #C85C3E/ }).click();
  await expect(page.locator(TOAST)).toHaveText('Copiato #C85C3E');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#C85C3E');
  await shoot(page, '308-picker-desktop');
  // Back to the seed colour from the hex field, then Escape closes the picker.
  await picker.getByLabel('Esadecimale').fill('#7A5C3E');
  await picker.getByLabel('Esadecimale').press('Enter');
  await expect(swatch.locator('.card__color-hex')).toContainText('#7A5C3E');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  // The menu opens it too.
  await swatch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Modifica colore' }).click();
  await expect(picker).toBeVisible();
  await page.mouse.click(1200, 120);
  await expect(picker).toBeHidden();

  // The image's menu makes six compact chips beside it, selected together, in one undo step.
  const image = page.locator(`.card--free[data-el="${seeded.imageId}"]`);
  await expect(image.locator('img')).toBeVisible();
  await image.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Crea palette' })).toBeVisible();
  await shoot(page, '308-menu-desktop');
  await page.getByRole('menuitem', { name: 'Crea palette' }).click();
  // Six colours, as the worker now finds; the picture has six bands.
  expect(seeded.palette).toBe(6);
  const colours = page.locator('.card--free.card--color');
  await expect(colours).toHaveCount(10);
  const chips = page.locator('.card--free.card--color.is-selected');
  await expect(chips).toHaveCount(6);
  expect(
    await chips.evaluateAll((els) => els.map((el) => (el as HTMLElement).style.width)),
  ).toEqual(Array(6).fill('50px'));
  await expect(page.locator(TOAST)).toContainText('Aggiunti 6 colori');
  await shoot(page, '308-palette-desktop');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(colours).toHaveCount(4);
});

test('the moodboard swatch copies too', async ({ page, baseURL }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, baseURL as string, seeded, 'moodboard');
  const swatch = page.locator('.moodboard__card--color').first();
  await swatch.hover();
  await expect(swatch.locator('.card__rgb')).toBeVisible();
  await shoot(page, '308-moodboard-desktop');
  await swatch.getByRole('button', { name: /^Copia #/ }).click();
  await expect(page.locator(TOAST)).toContainText('Copiato #');
});

async function phone(browser: Browser, base: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'it-IT',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await open(page, base, seeded);
  return { context, page };
}

test('on a phone the toast spans the width and a tap shows RGB and copy', async ({
  browser,
  baseURL,
}) => {
  test.skip(!shots, 'Only for the screenshots (E2E_SHOTS).');
  const { context, page } = await phone(browser, baseURL as string);
  const swatch = page.locator(`.card--free[data-el="${seeded.colorIds[1]}"]`);
  await expect(swatch).toBeVisible();
  await swatch.tap();
  await expect(swatch.locator('.card__copy')).toHaveCSS('opacity', '1');
  await shoot(page, '308-swatch-phone');
  await swatch.dblclick();
  const picker = page.getByRole('dialog', { name: 'Selettore colore' });
  await expect(picker).toBeVisible();
  await shoot(page, '308-picker-phone');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await page.keyboard.press('ControlOrMeta+a');
  await copyAndPaste(page);
  await expect(page.locator(TOAST)).toContainText('Incollati 1 immagine e 4 colori');
  await shoot(page, '310-toast-phone');
  await page.keyboard.press('ControlOrMeta+z');
  await context.close();
});
