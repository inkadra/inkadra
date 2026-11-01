// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// A board kept around its content (#324) and the personal preferences behind it (#302).
import { mkdirSync } from 'node:fs';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** Screenshots and a recording for the pull request, only when a folder is given. */
const shots = process.env.BOUNDED_CANVAS_SHOTS;

async function open(page: Page, baseURL: string, prefs: Record<string, unknown> = {}) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.goto('/');
  const saved = await page.request.patch('/api/v1/me/preferences', {
    headers: { origin: baseURL },
    data: { keepAroundContent: true, toolbar: null, ...prefs },
  });
  expect(saved.ok()).toBe(true);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Sopralluogo Lagunc', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = (await response.json()) as { id: string; rootBoardId: string };
  const doc = createBoardDoc(project.rootBoardId);
  const hexes = ['#7A5C3E', '#3E6A7A', '#5C7A3E'];
  const seed = [
    { x: 80, y: 80, w: 240, h: 160 },
    { x: 360, y: 140, w: 200, h: 140 },
    { x: 120, y: 300, w: 300, h: 120 },
  ];
  for (const [i, r] of seed.entries())
    createElement(
      doc,
      'color',
      r,
      { w: r.w, h: r.h, hex: hexes[i] ?? '#808086' },
      { userId: null },
    );
  await pushBoardDoc(baseURL, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  await expect(page.locator('.card--free')).toHaveCount(3);
  return project;
}

/** How many cards are at least partly on screen. */
async function cardsInView(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.canvas')?.getBoundingClientRect();
    if (!canvas) return 0;
    return [...document.querySelectorAll('.card--free')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.right > canvas.left &&
        r.left < canvas.right &&
        r.bottom > canvas.top &&
        r.top < canvas.bottom
      );
    }).length;
  });
}

async function scrollFar(page: Page) {
  const canvas = page.locator('.canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(400, 300);
  // The view springs back once scrolling stops.
  await page.waitForTimeout(600);
}

test('a board kept around its content stops panning there; off, it pans away', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await open(page, baseURL!);
  await scrollFar(page);
  expect(await cardsInView(page)).toBeGreaterThan(0);
  // The farthest zoom out holds the whole area: zooming out stops, and "−" says so.
  const out = page.getByRole('button', { name: 'Riduci', exact: true });
  for (let i = 0; i < 12 && (await out.isEnabled()); i++) await out.click();
  await expect(out).toBeDisabled();
  expect(await cardsInView(page)).toBe(3);

  // The preference follows the account: off, the board is endless again.
  await page.goto('/settings?section=preferences');
  const keep = page.getByRole('switch', { name: 'Mantieni la board attorno al contenuto' });
  await expect(keep).toBeChecked();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/me/preferences') && r.request().method() === 'PATCH',
  );
  await keep.uncheck();
  expect((await saved).ok()).toBe(true);
  await page.goBack();
  await expect(page.locator('.card--free')).toHaveCount(3);
  await scrollFar(page);
  expect(await cardsInView(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Riduci', exact: true })).toBeEnabled();
});

test.describe('pictures for the pull request', () => {
  test.skip(!shots, 'BOUNDED_CANVAS_SHOTS is not set');
  // The rubber band only shows with motion allowed.
  test.use({ reducedMotion: 'no-preference' });

  async function context(browser: Browser, theme: 'light' | 'dark', phone: boolean, video = false) {
    return browser.newContext({
      colorScheme: theme,
      locale: 'it-IT',
      reducedMotion: 'no-preference',
      viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
      ...(video
        ? { recordVideo: { dir: `${shots}/video`, size: { width: 1440, height: 900 } } }
        : {}),
    });
  }

  for (const theme of ['dark', 'light'] as const)
    for (const phone of [false, true])
      test(`settings and the canvas edge, ${theme}${phone ? ', phone' : ''}`, async ({
        browser,
        baseURL,
      }) => {
        test.setTimeout(120_000);
        mkdirSync(shots!, { recursive: true });
        const ctx = await context(browser, theme, phone);
        await ctx.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
        const page = await ctx.newPage();
        const name = `${theme}-${phone ? 'phone' : 'desktop'}`;
        await open(page, baseURL!, { undoButtons: true });
        // Pulled past the right edge, held: dots fade and the edge glows.
        const box = (await page.locator('.canvas').boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down('Space');
        await page.mouse.down();
        for (let i = 1; i <= 30; i++)
          await page.mouse.move(box.x + box.width / 2 - i * 60, box.y + box.height / 2 - i * 4);
        await page.waitForTimeout(100);
        await page.screenshot({ path: `${shots}/canvas-edge-${name}.png` });
        await page.mouse.up();
        await page.keyboard.up('Space');
        for (let i = 0; i < 14; i++)
          await page.getByRole('button', { name: 'Riduci', exact: true }).click({ force: true });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${shots}/canvas-zoomed-out-${name}.png` });
        for (const section of ['preferences', 'toolbar', 'notifications']) {
          await page.goto(`/settings?section=${section}`);
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${shots}/settings-${section}-${name}.png` });
        }
        await ctx.close();
      });

  test('recording of a pan to the edge', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ctx = await context(browser, 'dark', false, true);
    const page = await ctx.newPage();
    await open(page, baseURL!);
    const box = (await page.locator('.canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    for (const dir of [1, -1]) {
      await page.keyboard.down('Space');
      await page.mouse.down();
      for (let i = 1; i <= 50; i++) {
        await page.mouse.move(x - dir * i * 30, y - dir * i * 8);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      await page.keyboard.up('Space');
      await page.waitForTimeout(700);
      await page.mouse.move(x, y);
    }
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(800);
    await ctx.close();
  });
});
