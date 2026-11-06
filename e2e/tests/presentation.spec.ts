import { addFrame, addScene, createElement, encodeStroke } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.PRESENTATION_SCREENSHOTS;
let url = '';

async function picture(page: Page, from: string, to: string) {
  const bytes = await page.evaluate(
    async ([a, b]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const fill = ctx.createLinearGradient(0, 0, 960, 540);
      fill.addColorStop(0, a as string);
      fill.addColorStop(1, b as string);
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 960, 540);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('no picture');
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [from, to],
  );
  return Buffer.from(bytes);
}

async function open(page: Page, signedIn = false) {
  if (!signedIn) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  }
  await page.goto(url);
  await page.getByRole('button', { name: 'Presenta', exact: true }).click();
  const present = page.getByRole('dialog', { name: 'Presenta' });
  await expect(present.locator('.present-stage__canvas')).toBeVisible();
  return present;
}

test('seed a storyboard to present', async ({ page, baseURL }) => {
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
    name: 'Primo Test',
  });
  const board = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Il gatto',
  });
  const assets: string[] = [];
  for (const [i, [from, to]] of [
    ['#7fb1d8', '#5c6b3a'],
    ['#c98a4b', '#5a2e1e'],
    ['#47612f', '#16210f'],
  ].entries()) {
    const body = await picture(page, from as string, to as string);
    const id = await uploadFile(base, cookie, project.id, {
      body,
      name: `shot-${i}.png`,
      type: 'image/png',
    });
    if (!id) throw new Error('upload failed');
    assets.push(id);
  }
  await waitForAssets(base, cookie, assets);

  const doc = new Y.Doc();
  initBoardDoc(doc, board.id);
  const opts = { userId: null };
  const scene = addScene(doc, { number: '1', title: 'Il cortile' }, opts);
  // More slides than the strip can show at 1280px: 14 frames and the plan's slide.
  for (let i = 0; i < 14; i++) {
    addFrame(
      doc,
      scene.id,
      null,
      {
        action:
          i === 13
            ? 'Il gatto attraversa il cortile, si ferma davanti alla porta e guarda in macchina. '.repeat(
                8,
              )
            : `Il gatto si avvicina ${i + 1}`,
        notes: 'Tenere l’inquadratura tre secondi prima dello stacco.',
        shot: 'ws',
        movement: 'static',
        ...(i === 13 ? { lens: '35mm anamorfico', audio: 'Vento e passi in lontananza' } : {}),
        assetId: assets[i % assets.length],
      },
      opts,
    );
  }
  createElement(
    doc,
    'plan',
    { x: 0, y: 0 },
    {
      w: 480,
      title: 'Cortile',
      sceneIds: [scene.id],
      strokes: [
        {
          id: 'presentationPlan',
          tool: 'pencil',
          color: '#B897F0',
          width: 4,
          points: encodeStroke([
            { x: 0.1, y: 0.1 },
            { x: 0.8, y: 0.6 },
          ]),
        },
      ],
    },
    opts,
  );
  await pushBoardDoc(base, cookie, board.id, doc);
  url = `/p/${project.id}/b/${board.id}`;
});

test('the header carries the controls and the picture takes the space', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const present = await open(page);
  const header = present.locator('.present-header');
  await expect(header.getByText('1 / 15')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Note del relatore' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Schermo intero' })).toBeVisible();
  await expect(present.getByText('per cambiare slide')).toHaveCount(0);
  await expect(present.getByRole('button', { name: 'Slide successiva' })).toBeHidden();

  // The arrow keys still work, and the strip follows them past its end.
  await page.keyboard.press('ArrowRight');
  await expect(header.getByText('2 / 15')).toBeVisible();
  await expect(present.locator('.present-stage__specs')).not.toBeEmpty();
  for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowRight');
  await expect(header.getByText('15 / 15')).toBeVisible();
  await expect(present.locator('.present-thumb[aria-current]')).toBeInViewport({ ratio: 1 });

  const stage = await present.locator('.present-stage__canvas').boundingBox();
  expect(stage?.height ?? 0).toBeGreaterThan(800 * 0.6);
  const frame = await present.locator('.present-stage__canvas > .frame-pic').boundingBox();
  expect((frame?.width ?? 0) / (frame?.height ?? 1)).toBeCloseTo(16 / 9, 1);

  const panel = await present.locator('.present-sidebar').boundingBox();
  expect(panel?.width).toBe(240);
  await present.getByRole('button', { name: 'Comprimi pannello' }).click();
  await expect(present.locator('.present-sidebar')).toHaveCount(0);
  await header.getByRole('button', { name: 'Note del relatore' }).click();
  await expect(present.locator('.present-sidebar')).toBeVisible();
});

test('the bars leave after 3 seconds without the mouse and come back with it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const present = await open(page);
  const header = present.locator('.present-header');
  const bottom = present.locator('.present-bottom');

  await page.mouse.move(400, 300);
  await expect(header).toHaveCSS('opacity', '1');
  await page.waitForTimeout(2500);
  await expect(header).toHaveCSS('opacity', '1');
  await expect(header).toHaveCSS('opacity', '0');
  await expect(bottom).toHaveCSS('opacity', '0');
  // What the audience looks at stays: the shot and the notes panel.
  await expect(present.locator('.present-stage__shot-label')).toHaveCSS('opacity', '1');
  await expect(present.locator('.present-sidebar')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/idle.png` });

  // Changing slide from the keyboard doesn't bring them back.
  await page.keyboard.press('ArrowRight');
  await expect(header.getByText('2 / 15')).toBeAttached();
  await expect(header).toHaveCSS('opacity', '0');

  await page.mouse.move(420, 320);
  await expect(header).toHaveCSS('opacity', '1');
  await expect(bottom).toHaveCSS('opacity', '1');

  // A thumbnail clicked with the mouse holds focus, not keyboard focus: they still leave.
  await present.locator('.present-thumb').nth(2).click();
  await page.keyboard.press('ArrowRight');
  await expect(header.getByText('4 / 15')).toBeVisible();
  await expect(header).toHaveCSS('opacity', '0', { timeout: 6000 });

  // Keyboard focus inside them keeps them, in the strip as well as in the header.
  await page.mouse.move(400, 300);
  await present.getByRole('button', { name: 'Esci' }).focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(3500);
  await expect(header).toHaveCSS('opacity', '1');
  await expect(bottom).toHaveCSS('opacity', '1');

  // A click on the stage takes the keyboard focus away, and they can leave again.
  await present.locator('.present-stage__canvas').click();
  await expect(header).toHaveCSS('opacity', '0', { timeout: 6000 });
});

test('the bars fade, except without motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const present = await open(page);
  await expect(present.locator('.present-header')).not.toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(present.locator('.present-header')).toHaveCSS('transition-duration', '0s');
  await expect(present.locator('.present-bottom')).toHaveCSS('transition-duration', '0s');
});

test('a phone keeps its layout and its buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const present = await open(page);
  const header = present.locator('.present-header');
  await expect(present.locator('.present-sidebar')).toBeHidden();
  await expect(present.locator('.present-strip')).toBeHidden();
  await expect(header.getByText('1 / 15')).toBeVisible();

  const next = present.getByRole('button', { name: 'Slide successiva' });
  await next.click();
  await expect(header.getByText('2 / 15')).toBeVisible();
  // No mouse to bring them back: they don't leave.
  await page.waitForTimeout(3500);
  await expect(header).toHaveCSS('opacity', '1');

  // A long title gives way to the controls.
  await header.locator('.present-header__title').evaluate((el) => {
    el.textContent = 'Un titolo molto lungo '.repeat(12);
  });
  await expect(header.getByRole('button', { name: 'Schermo intero' })).toBeInViewport({ ratio: 1 });

  const width = await present.evaluate((el) => el.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  const frame = await present.locator('.present-stage__canvas > .frame-pic').boundingBox();
  expect(frame?.width).toBe(390);
});

test('screenshots of the presentation', async ({ page }) => {
  test.skip(!shots, 'only makes screenshots');
  test.setTimeout(120_000);
  const take = async (name: string) => {
    await page.mouse.move(600, 300);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/${name}.png` });
  };
  let signedIn = false;
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const present = await open(page, signedIn);
    signedIn = true;
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await take(`desktop-${scheme}`);
    await present.locator('.present-thumb').nth(1).focus();
    await page.keyboard.press('Tab');
    await take(`desktop-${scheme}-keyboard-focus`);
    await present.locator('.present-thumb').last().click();
    await take(`desktop-${scheme}-long-text`);
    await present.getByRole('button', { name: 'Comprimi pannello' }).click();
    await take(`desktop-${scheme}-no-notes`);
    await present.locator('.present-thumb').first().click();
    await take(`desktop-${scheme}-scene-plan`);
    await page.keyboard.press('ArrowRight');
    await page.setViewportSize({ width: 390, height: 844 });
    await take(`phone-${scheme}`);
    await page.keyboard.press('Escape');
  }
});
