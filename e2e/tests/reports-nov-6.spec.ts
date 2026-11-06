import { addFrame, addScene, createElement, updateElement } from '@inkadra/canvas-core';
import { initBoardDoc, setBoardAspect, STROKE_GRID } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.REPORT_SCREENSHOTS;
let seeded: { projectId: string; rootId: string; storyboardId: string; imageId: string };

async function picture(page: Page, width: number, height: number) {
  const bytes = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const fill = ctx.createLinearGradient(0, 0, 0, h as number);
      fill.addColorStop(0, '#7fb1d8');
      fill.addColorStop(1, '#5c6b3a');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w as number, h as number);
      const blob = (await new Promise((r) => canvas.toBlob(r, 'image/png'))) as Blob;
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [width, height],
  );
  return Buffer.from(bytes);
}

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

test('seed a board and a portrait storyboard', async ({ page, baseURL }) => {
  const base = baseURL as string;
  await page.goto('/login');
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
    name: 'Segnalazioni',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Verticale',
  });
  const upload = async (name: string, w: number, h: number) => {
    const body = await picture(page, w, h);
    const id = await uploadFile(base, cookie, project.id, { body, name, type: 'image/png' });
    if (!id) throw new Error('upload failed');
    await waitForAssets(base, cookie, [id]);
    return id;
  };

  // A card that got the placeholder's 4:3 before its 3:2 picture was known.
  const root = new Y.Doc();
  initBoardDoc(root, project.rootBoardId);
  const image = createElement(
    root,
    'image',
    { x: 300, y: 200 },
    { assetId: await upload('wide.png', 900, 600) },
    { userId: null },
  );
  updateElement(root, image.id, { w: 600, h: 450 });
  await pushBoardDoc(base, cookie, project.rootBoardId, root);

  const doc = new Y.Doc();
  initBoardDoc(doc, storyboard.id);
  setBoardAspect(doc, '9:16');
  const scene = addScene(doc, { number: '1', title: 'Verticale' }, { userId: null });
  const assetId = await upload('tall.png', 540, 960);
  addFrame(
    doc,
    scene.id,
    null,
    {
      action: 'Salita',
      assetId,
      strokes: [
        {
          id: 'report-stroke-0001',
          tool: 'marker',
          color: '#E5484D',
          width: 12,
          // From corner to corner of the frame: it has to end on the corners of the picture.
          points: [0, 0, STROKE_GRID, STROKE_GRID],
        },
      ],
    },
    { userId: null },
  );
  await pushBoardDoc(base, cookie, storyboard.id, doc);
  seeded = {
    projectId: project.id,
    rootId: project.rootBoardId,
    storyboardId: storyboard.id,
    imageId: image.id,
  };
});

test('an image card takes the shape of its picture', async ({ page }) => {
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootId}`);
  const card = page.locator(`.card[data-el="${seeded.imageId}"]`);
  const media = card.locator('.card__media');
  await expect(async () => {
    const box = await media.boundingBox();
    if (!box) throw new Error('no picture');
    expect(box.width / box.height).toBeCloseTo(1.5, 1);
  }).toPass();
  if (shots) await page.screenshot({ path: `${shots}/image-card.png` });
});

test('the export dialog stays centred and the format label fits', async ({ page }) => {
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}`);
  const select = page.locator('.story__aspect .ink-select span').first();
  await expect(select).toHaveText(/9 : 16/);
  expect(await select.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const dialog = page.getByRole('dialog', { name: /Esporta/ });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (!box) throw new Error('no dialog');
  const width = page.viewportSize()?.width ?? 0;
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
  if (shots) await page.screenshot({ path: `${shots}/export.png` });
});

test('the invite field can be seen and typed in', async ({ page }) => {
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootId}`);
  await page.getByRole('button', { name: 'Condividi', exact: true }).click();
  const field = page.getByRole('combobox', { name: 'Email o nome' });
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(160);
  if (shots) await page.screenshot({ path: `${shots}/share.png` });
});

test('the drawing stays on the picture in the presentation', async ({ page }) => {
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}`);
  await page.getByRole('button', { name: 'Presenta', exact: true }).click();
  const present = page.getByRole('dialog', { name: 'Presenta' });
  const frame = present.locator('.present-stage__canvas > .frame-pic');
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  if (!box) throw new Error('no frame');
  expect(box.width / box.height).toBeCloseTo(9 / 16, 1);
  const image = await frame.locator('img').boundingBox();
  const ink = await frame.locator('.frame-pic__ink').boundingBox();
  expect(image).toEqual(box);
  expect(ink).toEqual(box);
  if (shots) await page.screenshot({ path: `${shots}/presentation.png` });
});

test('the same screens in the light theme and on a phone', async ({ page }) => {
  test.skip(!shots, 'only makes screenshots');
  await signInPage(page);
  for (const [name, width, height, colorScheme] of [
    ['light', 1280, 800, 'light'],
    ['phone', 390, 844, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await page.goto(`/p/${seeded.projectId}/b/${seeded.rootId}`);
    await page.getByRole('button', { name: 'Condividi', exact: true }).first().click();
    const field = page.getByRole('combobox', { name: 'Email o nome' });
    await expect(field).toBeVisible();
    expect((await field.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/share-${name}.png` });
    await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}`);
    if (name === 'light') {
      await page.getByRole('button', { name: 'Presenta', exact: true }).click();
      const present = page.getByRole('dialog', { name: 'Presenta' });
      await expect(present.locator('.present-stage__canvas > .frame-pic')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/presentation-light.png` });
    }
  }
});
