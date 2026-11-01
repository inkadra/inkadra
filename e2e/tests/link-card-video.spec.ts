// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Locator, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
// Set to a folder to keep screenshots and a video of the cards (see the last test).
const shots = process.env.LINK_CARD_SHOTS;
// With this set the demo loads the real Instagram embed instead of the stub.
const realInstagram = !!process.env.LINK_CARD_REAL_INSTAGRAM;

const PLAYERS = {
  'https://www.youtube-nocookie.com': 'YouTube',
  'https://player.vimeo.com': 'Vimeo',
  'https://www.instagram.com': 'Instagram',
};

/** The players are third-party pages: answer for them, and record what is asked of them. */
async function stubPlayers(page: Page, skip: string[] = []) {
  const requested: string[] = [];
  for (const [origin, name] of Object.entries(PLAYERS)) {
    if (skip.includes(origin)) continue;
    await page.route(`${origin}/**`, (route) => {
      requested.push(route.request().url());
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><body style="margin:0;background:#000;color:#fff;font:13px sans-serif;display:grid;place-items:center;height:100vh"><div style="text-align:center">${name} player<div style="margin-top:10px;width:120px;height:3px;background:#ffffff40"><i style="display:block;height:100%;width:40%;background:#f33;animation:p 4s linear infinite"></i></div></div><style>@keyframes p{to{width:100%}}</style></body>`,
      });
    });
  }
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { violations: string[] }).violations = violations;
    document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(e.effectiveDirective),
    );
  });
  return requested;
}

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

/** A project whose board holds a YouTube, a Vimeo and an Instagram card, placed by `place`. */
async function seedBoard(page: Page, base: string, place: (i: number) => { x: number; y: number }) {
  const cookie = await signIn(base, admin);
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Video nelle card' }),
  });
  const { id: projectId, rootBoardId } = (await created.json()) as {
    id: string;
    rootBoardId: string;
  };

  // A picture to stand in for the thumbnails the link preview would copy.
  const size = page.viewportSize();
  await page.setContent(
    '<body style="margin:0;width:640px;height:340px;background:linear-gradient(135deg,#1c2430,#5a6a7a)">',
  );
  await page.setViewportSize({ width: 640, height: 340 });
  const thumbnail = await page.screenshot();
  if (size) await page.setViewportSize(size);
  const imageAssetId = await uploadFile(base, cookie, projectId, {
    body: thumbnail,
    name: 'thumb.png',
    type: 'image/png',
  });
  if (!imageAssetId) throw new Error('upload failed');
  await waitForAssets(base, cookie, [imageAssetId]);

  const doc = new Y.Doc();
  initBoardDoc(doc, rootBoardId);
  const links = [
    {
      url: 'https://www.youtube.com/watch?v=yMnFHFf43Qg',
      title: 'I built a better Homepod',
      description: 'Another Channel',
    },
    { url: 'https://vimeo.com/123456', title: 'Beyond the Grid', description: 'Studio · 4:21' },
    {
      url: 'https://www.instagram.com/p/CUbHfhpswxt/',
      title: 'Behind the scenes, night shoot',
      description: '@lasttrain',
    },
  ];
  for (const [i, link] of links.entries())
    createElement(doc, 'link', place(i), { w: 300, imageAssetId, ...link }, { userId: null });
  await pushBoardDoc(base, cookie, rootBoardId, doc);
  return { projectId, rootBoardId };
}

async function openBoard(page: Page, ids: { projectId: string; rootBoardId: string }) {
  await signInPage(page);
  await page.goto(`/p/${ids.projectId}/b/${ids.rootBoardId}`);
  await expect(page.locator('[data-type="link"]')).toHaveCount(3);
}

const cardOf = (page: Page, text: string) => page.locator('[data-type="link"]', { hasText: text });
const box = async (locator: Locator) => (await locator.boundingBox())!;

test('a video plays inside its card, one at a time, and the viewer is one click away', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const ids = await seedBoard(page, baseURL as string, (i) => ({ x: 60 + i * 340, y: 80 }));
  const requested = await stubPlayers(page);
  await openBoard(page, ids);

  const youtube = cardOf(page, 'Homepod');
  const vimeo = cardOf(page, 'Beyond the Grid');
  const instagram = cardOf(page, 'night shoot');
  await expect(page.locator('[data-type="link"]')).toHaveCount(3);

  // Before play there is no iframe and nothing was asked of YouTube, Vimeo or Instagram.
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(requested).toEqual([]);
  await expect(instagram.locator('.card__badge')).toHaveText('Instagram');

  // Play on the card: the player takes the thumbnail's place in the card.
  await youtube.locator('.card__play').click();
  await expect(youtube.locator('.card__embed iframe')).toHaveAttribute(
    'src',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/yMnFHFf43Qg\?autoplay=1/,
  );
  await expect(youtube.locator('img')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('.viewer')).toHaveCount(0);

  // A second video returns the first to its thumbnail.
  await vimeo.locator('.card__play').click();
  await expect(vimeo.locator('.card__embed iframe')).toHaveAttribute(
    'src',
    /^https:\/\/player\.vimeo\.com\/video\/123456\?dnt=1&autoplay=1/,
  );
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(youtube.locator('iframe')).toHaveCount(0);
  await expect(youtube.locator('.card__play')).toBeVisible();

  // Instagram loads its official embed only on the click, in a taller picture area.
  const thumbnailHeight = (await box(instagram.locator('.card__media'))).height;
  await instagram.locator('.card__play').click();
  await expect(instagram.locator('.card__embed iframe')).toHaveAttribute(
    'src',
    'https://www.instagram.com/p/CUbHfhpswxt/embed',
  );
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(vimeo.locator('iframe')).toHaveCount(0);
  expect((await box(instagram.locator('.card__embed'))).height).toBeGreaterThan(thumbnailHeight);

  // Esc returns the playing card to its thumbnail.
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(instagram.locator('.card__play')).toBeVisible();

  // ↗ stops the card's player and opens the viewer, which plays the same video.
  await youtube.locator('.card__play').click();
  await youtube.locator('.card__embed .card__expand').click();
  await expect(page.locator('.viewer__iframe')).toHaveAttribute(
    'src',
    /youtube-nocookie\.com\/embed\/yMnFHFf43Qg/,
  );
  await expect(youtube.locator('.card__embed')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer__iframe')).toHaveCount(0);

  // The CSP let the three players in.
  expect(
    await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
  ).toEqual([]);
});

test('a playing card is dragged by its frame, or by anywhere while Alt is held', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const ids = await seedBoard(page, baseURL as string, (i) => ({ x: 120 + i * 340, y: 80 }));
  await stubPlayers(page);
  await openBoard(page, ids);

  const youtube = cardOf(page, 'Homepod');
  await youtube.locator('.card__play').click();
  await expect(youtube.locator('.card__embed iframe')).toHaveCount(1);

  const drag = async (from: { x: number; y: number }, by: { dx: number; dy: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.dx / 2, from.y + by.dy / 2, { steps: 5 });
    await page.mouse.move(from.x + by.dx, from.y + by.dy, { steps: 5 });
    await page.mouse.up();
  };

  // From the frame: a few pixels inside the card's left edge, beside the player.
  const start = await box(youtube);
  await drag({ x: start.x + 3, y: start.y + 80 }, { dx: 160, dy: 120 });
  await expect(youtube.locator('iframe')).toHaveCount(1);
  const framed = await box(youtube);
  // The board may snap the card to its grid: the move is the drag, give or take a grid step.
  expect(Math.abs(framed.x - start.x - 160)).toBeLessThan(12);
  expect(Math.abs(framed.y - start.y - 120)).toBeLessThan(12);

  // The player takes the pointer, and so keeps its own controls...
  const player = await box(youtube.locator('iframe'));
  await expect(youtube.locator('.card__shield')).toHaveCount(0);
  // ...until Alt lays a shield over it: then the middle of the player drags the card too.
  await page.keyboard.down('Alt');
  await expect(youtube.locator('.card__shield')).toHaveCount(1);
  await drag(
    { x: player.x + player.width / 2, y: player.y + player.height / 2 },
    { dx: -60, dy: 40 },
  );
  await page.keyboard.up('Alt');
  await expect(youtube.locator('.card__shield')).toHaveCount(0);
  const shielded = await box(youtube);
  expect(Math.abs(shielded.x - framed.x + 60)).toBeLessThan(12);
  expect(Math.abs(shielded.y - framed.y - 40)).toBeLessThan(12);
  await expect(youtube.locator('iframe')).toHaveCount(1);
});

test('Continue playing videos off-screen is a setting, off by default', async ({ page }) => {
  await signInPage(page);
  await page.goto('/settings?section=preferences');
  const keep = page.getByRole('switch', { name: 'Continua a riprodurre i video fuori schermo' });
  await expect(keep).not.toBeChecked();
  await keep.check();
  await expect(keep).toBeChecked();
  await page.reload();
  await expect(keep).toBeChecked();
  await keep.uncheck();
  expect(
    await page.evaluate(() => localStorage.getItem('inkadra.video.keepPlayingOffscreen')),
  ).toBe('0');
});

test('demo: screenshots and a video of the cards', async ({ browser, baseURL }) => {
  test.skip(!shots, 'Only when asked for screenshots (LINK_CARD_SHOTS=<folder>).');
  test.setTimeout(240_000);
  const out = shots as string;
  mkdirSync(out, { recursive: true });
  const skip = realInstagram ? ['https://www.instagram.com'] : [];

  for (const phone of [false, true]) {
    const size = phone ? { width: 412, height: 915 } : { width: 1440, height: 900 };
    const context = await browser.newContext({
      viewport: size,
      hasTouch: phone,
      isMobile: phone,
      locale: 'it-IT',
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
      ...(phone ? {} : { recordVideo: { dir: out, size: { width: 1280, height: 800 } } }),
    });
    const page = await context.newPage();
    const ids = await seedBoard(page, baseURL as string, (i) =>
      phone ? { x: 24, y: [560, 900, 24][i] as number } : { x: 60 + i * 340, y: 70 },
    );
    await stubPlayers(page, skip);
    await openBoard(page, ids);
    const name = phone ? 'phone' : 'desktop';
    const instagram = cardOf(page, 'night shoot');
    const youtube = cardOf(page, 'Homepod');
    if (phone) {
      // A phone shows one column: scroll the board so the Instagram card is on screen.
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.waitForTimeout(500);

    if (!phone) {
      // Video: Instagram plays, then the playing YouTube card is dragged by its frame.
      await instagram.locator('.card__play').click();
      await page.waitForTimeout(realInstagram ? 6000 : 1500);
    } else {
      await instagram.locator('.card__play').tap();
      await page.waitForTimeout(realInstagram ? 6000 : 500);
    }
    await expect(instagram.locator('iframe')).toHaveCount(1);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      await page.waitForTimeout(realInstagram && !phone ? 1500 : 400);
      await page.screenshot({ path: `${out}/instagram-${name}-${theme}.png` });
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));

    if (!phone) {
      await youtube.locator('.card__play').click();
      await page.waitForTimeout(800);
      const from = await box(youtube);
      await page.mouse.move(from.x + 3, from.y + 80);
      await page.mouse.down();
      await page.mouse.move(from.x + 120, from.y + 260, { steps: 25 });
      await page.mouse.move(from.x + 220, from.y + 340, { steps: 25 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/dragged-${name}-dark.png` });
      await page.keyboard.press('Escape');

      // The setting: off by default, switched on.
      await page.goto('/settings?section=preferences');
      const keep = page.getByRole('switch', {
        name: 'Continua a riprodurre i video fuori schermo',
      });
      await expect(keep).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/setting-off-${name}-dark.png` });
      await keep.check();
      await page.waitForTimeout(700);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/setting-on-${name}-${theme}.png` });
      }
      await keep.uncheck();
      await page.waitForTimeout(500);
    }
    const video = page.video();
    await context.close();
    if (video && !phone) await video.saveAs(`${out}/link-cards-demo.webm`);
  }
});
