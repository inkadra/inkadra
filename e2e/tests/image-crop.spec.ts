// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const screenshotDir = fileURLToPath(
  new URL('../../docs/screenshots/0.7-image-crop', import.meta.url),
);

interface Seeded {
  projectId: string;
  rootBoardId: string;
  primaryImageId: string;
}
let seeded: Seeded;

/**
 * Generates a fictional cinematic location frame PNG with distinct quadrant colours and
 * a horizon band so crop and 90° rotation are visually unmistakable.
 */
function fictionalFramePng(width: number, height: number, variant: 'platform' | 'alley'): Buffer {
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
    const rowOffset = y * (width * 3 + 1);
    rows[rowOffset] = 0;
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      let r = 24;
      let g = 34;
      let b = 52;
      if (variant === 'platform') {
        // Warm sodium lamp glow in top-left, deep teal night sky in top-right, wet slate pavement below
        const dx = nx - 0.28;
        const dy = ny - 0.34;
        const glow = Math.max(0, 1 - Math.hypot(dx * 1.4, dy * 1.8) * 2.2);
        const horizon = ny > 0.56 ? 0.75 : 1;
        r = Math.min(255, Math.round((28 + nx * 35 + glow * 215) * horizon));
        g = Math.min(255, Math.round((44 + (1 - ny) * 48 + glow * 145) * horizon));
        b = Math.min(255, Math.round((78 + (1 - nx) * 60 + glow * 40) * horizon));
        // Architectural pillar & beam lines for clear composition
        if (Math.abs(nx - 0.68) < 0.018 || Math.abs(ny - 0.56) < 0.012) {
          r = Math.round(r * 0.45);
          g = Math.round(g * 0.45);
          b = Math.round(b * 0.5);
        }
      } else {
        // Secondary moodboard reference: cool cyan rain with warm window rectangle
        const inWindow = nx > 0.55 && nx < 0.82 && ny > 0.22 && ny < 0.62;
        r = inWindow ? 226 : Math.round(22 + ny * 30);
        g = inWindow ? 158 : Math.round(58 + (1 - nx) * 52);
        b = inWindow ? 88 : Math.round(92 + (1 - ny) * 64);
      }
      const px = rowOffset + 1 + x * 3;
      rows[px] = r;
      rows[px + 1] = g;
      rows[px + 2] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Switches the theme and captures the page. Animations are finished first: the header buttons
 * fade their background for 120 ms, and a capture taken mid-fade shows them half dark.
 */
async function shoot(page: Page, theme: 'light' | 'dark', name: string) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.screenshot({ path: join(screenshotDir, name), animations: 'disabled' });
}

/** Width over height of a locator's box. */
async function aspectOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box.width / box.height;
}

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

test.beforeAll(async ({ baseURL }) => {
  mkdirSync(screenshotDir, { recursive: true });
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
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Notturno Scalo Est',
  });

  const asset1 = await uploadFile(base, cookie, project.id, {
    body: fictionalFramePng(480, 320, 'platform'),
    name: 'banchina_camera_a.png',
    type: 'image/png',
  });
  const asset2 = await uploadFile(base, cookie, project.id, {
    body: fictionalFramePng(400, 300, 'alley'),
    name: 'controluce_pioggia.png',
    type: 'image/png',
  });
  if (!asset1 || !asset2) throw new Error('Failed to upload fictional test images');
  await waitForAssets(base, cookie, [asset1, asset2]);

  const board = new Y.Doc();
  initBoardDoc(board, project.rootBoardId);
  const img1 = createElement(
    board,
    'image',
    { x: 80, y: 40 },
    { w: 300, assetId: asset1, caption: 'Banchina — camera A (35mm)', tags: ['luce'] },
    { userId: null },
  );
  createElement(
    board,
    'image',
    { x: 420, y: 40 },
    { w: 260, assetId: asset2, caption: 'Controluce pioggia — esterno', tags: ['luce'] },
    { userId: null },
  );
  const note = createElement(board, 'note', { x: 420, y: 290 }, { w: 260 }, { userId: null });
  const body = roots(board).elements.get(note.id)?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('Ritaglio 16:9 e rotazione per il riferimento del carrello.')]);
  body.insert(0, [p]);

  await pushBoardDoc(base, cookie, project.rootBoardId, board);
  seeded = {
    projectId: project.id,
    rootBoardId: project.rootBoardId,
    primaryImageId: img1.id,
  };
});

test('image card crop, rotate, reload persistence, moodboard + viewer toggle, export, and restore original', async ({
  page,
}, info) => {
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  const card = page.locator(`[data-el="${seeded.primaryImageId}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toBeVisible();

  // Enter crop mode via selection toolbar button
  await card.click();
  const cropBtn = page.getByRole('button', { name: 'Ritaglia e ruota' });
  await expect(cropBtn).toBeVisible();
  await cropBtn.click();

  const stage = page.getByTestId('image-crop-stage');
  const cropBox = page.getByTestId('image-crop-box');
  const cropToolbar = page.getByRole('toolbar', { name: 'Ritaglio e rotazione' });
  await expect(stage).toBeVisible();
  await expect(cropBox).toBeVisible();
  await expect(cropToolbar).toBeVisible();
  await expect(stage.locator('.crop-stage__handle')).toHaveCount(8);

  // Select 16:9 aspect preset, drag SE handle slightly, and rotate +90°
  await cropToolbar.getByRole('button', { name: 'Proporzioni 16:9' }).click();
  const seHandle = stage.locator('.crop-stage__handle--se');
  const seBox = await seHandle.boundingBox();
  if (seBox) {
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBox.x - 24, seBox.y - 14, { steps: 4 });
    await page.mouse.up();
  }
  await cropToolbar.getByRole('button', { name: 'Ruota di 90° a destra' }).click();
  await expect(cropToolbar.locator('.crop-bar__deg')).toHaveText('90°');

  // The crop stage shows the whole turned picture; the 16:9 preset stays landscape.
  await expect
    .poll(() =>
      aspectOf(page, `[data-el="${seeded.primaryImageId}"] [data-testid="image-crop-box"]`),
    )
    .toBeCloseTo(16 / 9, 1);

  // Keyboard: the crop box takes focus, arrows move it, the size is announced.
  await expect(stage.getByText('Ritaglio 320 × 180 px')).toBeAttached();
  await cropBox.focus();
  const before = await cropBox.boundingBox();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await cropBox.boundingBox())?.y).toBeGreaterThan(before?.y ?? 0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await cropBox.boundingBox())?.y).toBeCloseTo(before?.y ?? 0, 0);
  // The angle slider is the themed one; double-click and the readout both go back to 0°.
  const angle = cropToolbar.getByRole('slider', { name: 'Angolo di rotazione' });
  await expect(angle).toHaveClass(/ink-slider/);
  await angle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cropToolbar.locator('.crop-bar__deg')).toHaveText('91°');
  await cropToolbar.getByRole('button', { name: 'Raddrizza: angolo fine a 0°' }).click();
  await expect(cropToolbar.locator('.crop-bar__deg')).toHaveText('90°');
  await page.mouse.move(0, 0);

  await shoot(page, 'dark', 'desktop-edit-dark.png');
  await shoot(page, 'light', 'desktop-edit-light.png');

  // Exit crop mode via Done button
  await cropToolbar.getByRole('button', { name: 'Fatto' }).click();
  await expect(stage).toBeHidden();
  const croppedMedia = card.locator('.cropped-image[data-cropped="true"]');
  await expect(croppedMedia).toBeVisible();
  await expect(croppedMedia).toHaveAttribute('data-rotation', '90');

  // The card follows the crop: same width, 16:9 picture, caption and tags below, no overflow.
  const cardBox = await card.boundingBox();
  const mediaBox = await card.locator('.card__media').boundingBox();
  const pictureBox = await croppedMedia.boundingBox();
  const captionBox = await card.getByText('Banchina — camera A (35mm)').boundingBox();
  if (!cardBox || !mediaBox || !pictureBox || !captionBox) throw new Error('card without boxes');
  expect(pictureBox.width / pictureBox.height).toBeCloseTo(16 / 9, 1);
  expect(mediaBox.width / mediaBox.height).toBeCloseTo(16 / 9, 1);
  expect(Math.abs(mediaBox.width - cardBox.width)).toBeLessThanOrEqual(2);
  expect(pictureBox.y + pictureBox.height).toBeLessThanOrEqual(mediaBox.y + mediaBox.height + 1);
  expect(captionBox.y).toBeGreaterThanOrEqual(mediaBox.y + mediaBox.height - 1);
  expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  const tagBox = await card.locator('.tag-chip').first().boundingBox();
  expect(tagBox && tagBox.y + tagBox.height <= cardBox.y + cardBox.height).toBe(true);

  await shoot(page, 'dark', 'desktop-result-dark.png');
  await shoot(page, 'light', 'desktop-result-light.png');

  // Phone: a fresh load at phone size, the card zoomed into view.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(card.locator('.cropped-image[data-cropped="true"]')).toBeAttached();
  await page.keyboard.press('Shift+Digit1');
  await card.click();
  await page.keyboard.press('Shift+Digit2');
  await page.getByRole('button', { name: 'Ritaglia e ruota' }).click();
  const phoneBar = page.getByRole('toolbar', { name: 'Ritaglio e rotazione' });
  await expect(page.getByTestId('image-crop-stage')).toBeVisible();
  await page.keyboard.press('Shift+Digit2');
  // The crop bar is a bottom sheet: inside the screen, above the tool bar, 44 px targets.
  const barBox = await phoneBar.boundingBox();
  const toolsBox = await page.locator('.toolbar').boundingBox();
  if (!barBox || !toolsBox) throw new Error('phone bars without boxes');
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(toolsBox.y);
  for (const name of ['Ripristina originale', 'Fatto', 'Ruota di 90° a destra']) {
    const button = await phoneBar.getByRole('button', { name }).boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);
    expect(button && button.x >= 0 && button.x + button.width <= 390).toBe(true);
  }
  await shoot(page, 'dark', 'phone-edit-dark.png');
  await shoot(page, 'light', 'phone-edit-light.png');
  // Escape on the focused crop box leaves crop mode.
  await page.getByTestId('image-crop-box').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-crop-stage')).toBeHidden();
  await shoot(page, 'light', 'phone-result-light.png');
  await shoot(page, 'dark', 'phone-result-dark.png');

  // Restore desktop viewport and reload page to verify persistence
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const persistedCropped = page
    .locator(`[data-el="${seeded.primaryImageId}"]`)
    .locator('.cropped-image[data-cropped="true"]');
  await expect(persistedCropped).toBeVisible();
  await expect(persistedCropped).toHaveAttribute('data-rotation', '90');

  // Verify Moodboard gallery and MediaViewer toggle ("Mostra originale" / "Mostra ritaglio")
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootBoardId}?view=moodboard`);
  const moodboardCropped = page.locator('.moodboard__card .cropped-image[data-cropped="true"]');
  await expect(moodboardCropped).toBeVisible();
  await expect(moodboardCropped).toHaveAttribute('data-rotation', '90');

  await moodboardCropped.click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.cropped-image[data-cropped="true"]')).toBeVisible();
  const toggleOriginalBtn = viewer.getByRole('button', { name: 'Mostra originale' });
  await expect(toggleOriginalBtn).toBeVisible();
  await toggleOriginalBtn.click();
  await expect(viewer.locator('.cropped-image[data-cropped="true"]')).toBeHidden();
  const toggleEditedBtn = viewer.getByRole('button', { name: 'Mostra ritaglio' });
  await expect(toggleEditedBtn).toBeVisible();
  await toggleEditedBtn.click();
  await expect(viewer.locator('.cropped-image[data-cropped="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // Return to canvas and verify PNG export reflects cropped image
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Menu della board' }).click();
  await page.getByRole('menuitem', { name: 'Esporta…' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Esporta' });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole('button', { name: /Personalizza/ }).click();
  await exportDialog.getByRole('radio', { name: 'Immagine (PNG)' }).click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const pngPath = info.outputPath('cropped-board.png');
  await pngDownload.saveAs(pngPath);
  const pngBytes = await readFile(pngPath);
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
  expect(pngBytes.readUInt32BE(16)).toBeGreaterThanOrEqual(800);

  // Restore original and verify persistence. A fresh load can leave the card under the
  // floating navigation (#349): fit the view first, so the click lands on the card.
  await page.getByRole('button', { name: 'Adatta alla vista' }).click();
  await card.click();
  const restoreBtn = page.getByRole('button', { name: 'Ripristina originale' });
  await expect(restoreBtn).toBeVisible();
  await restoreBtn.click();
  await expect(card.locator('.cropped-image[data-cropped="true"]')).toBeHidden();

  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(
    page.locator(`[data-el="${seeded.primaryImageId}"] .cropped-image[data-cropped="true"]`),
  ).toBeHidden();
});
