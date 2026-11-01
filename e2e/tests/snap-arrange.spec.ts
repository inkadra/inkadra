// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Snap to grid (#296) and arranging the selection (#320).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out =
  process.env.E2E_SHOTS ??
  fileURLToPath(new URL('../../docs/screenshots/0.7-arrange/', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const GRID = 22;

type Seed = Array<{ x: number; y: number; w: number; h: number }>;

async function open(page: Page, baseURL: string, seed: Seed, theme: 'light' | 'dark' = 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Ultimo Treno', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = (await response.json()) as { id: string; rootBoardId: string };
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null };
  const hexes = ['#7A5C3E', '#3E6A7A', '#5C7A3E', '#7A3E5C'];
  const ids = seed.map(
    (r, i) =>
      createElement(doc, 'color', r, { w: r.w, h: r.h, hex: hexes[i % 4] ?? '#808086' }, opts).id,
  );
  await pushBoardDoc(baseURL, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  await expect(page.locator('.card--free')).toHaveCount(seed.length);
  return { project, ids };
}

/** World position and size of a card, from its style (the world layer is scaled, not the card). */
async function rectOf(page: Page, id: string) {
  return page.locator(`.card--free[data-el="${id}"]`).evaluate((el) => {
    const s = (el as HTMLElement).style;
    return {
      x: Number.parseFloat(s.left),
      y: Number.parseFloat(s.top),
      w: Number.parseFloat(s.width),
      h: Number.parseFloat(s.height),
    };
  });
}

/** Drags a card by a distance in screen pixels, in steps, as a hand would. */
async function drag(page: Page, id: string, dx: number, dy: number) {
  const box = (await page.locator(`.card--free[data-el="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

for (const theme of ['dark', 'light'] as const) {
  test(`the magnet snaps a dragged card to the grid, and is remembered ${theme}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    mkdirSync(out, { recursive: true });
    // On the grid and 44 units wide, so a guide to another card is on the grid too.
    const { ids } = await open(
      page,
      baseURL!,
      [
        { x: 88, y: 88, w: 176, h: 132 },
        { x: 616, y: 88, w: 176, h: 132 },
        { x: 616, y: 440, w: 176, h: 132 },
      ],
      theme,
    );
    const [card] = ids as [string];
    const magnet = page.getByRole('button', { name: 'Aggancia alla griglia' });
    await expect(magnet).toHaveAttribute('aria-pressed', 'false');

    // Off: the card goes exactly where it is dropped.
    await drag(page, card, 37, 23);
    const free = await rectOf(page, card);
    expect(free.x % GRID !== 0 || free.y % GRID !== 0).toBe(true);

    // On: the card lands on the 22-unit world grid, whatever the zoom.
    await magnet.click();
    await expect(magnet).toHaveAttribute('aria-pressed', 'true');
    // The tooltip shows when the pointer comes over the button again.
    await page.mouse.move(700, 600);
    await magnet.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Aggancia alla griglia · G');
    await page.screenshot({ path: `${out}/magnet-on-${theme}.png` });
    await drag(page, card, 41, 29);
    const snapped = await rectOf(page, card);
    expect(snapped.x % GRID).toBe(0);
    expect(snapped.y % GRID).toBe(0);
    expect(snapped.x).not.toBe(free.x);

    // A keyboard nudge moves one grid step.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await rectOf(page, card)).x).toBe(snapped.x + GRID);

    // The choice is this person's on this device: still on after a reload, and G turns it off.
    await page.reload();
    await expect(magnet).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('g');
    await expect(magnet).toHaveAttribute('aria-pressed', 'false');
  });
}

const messy: Seed = [
  { x: 133, y: 97, w: 180, h: 120 },
  { x: 420, y: 71, w: 140, h: 200 },
  { x: 151, y: 371, w: 200, h: 100 },
  { x: 397, y: 402, w: 160, h: 160 },
];

/** Selects every card and tidies them into a mosaic from the selection bar's Arrange menu. */
async function tidyIntoMosaic(page: Page, shot?: string) {
  await page.keyboard.press('ControlOrMeta+a');
  const bar = page.getByRole('toolbar', { name: 'Azioni sulla selezione' });
  await bar.getByRole('button', { name: 'Disponi' }).click();
  const menu = page.getByRole('menu', { name: 'Disponi' });
  await expect(menu.getByRole('menuitemradio', { name: 'Spazio medio' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const mosaic = menu.getByRole('menuitem', { name: /Metti in ordine a mosaico/ });
  await mosaic.hover();
  if (shot) await page.screenshot({ path: shot });
  await mosaic.click();
  await expect(menu).toBeHidden();
}

for (const theme of ['dark', 'light'] as const) {
  test(`tidy into mosaic packs the selection with an even gap ${theme}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    mkdirSync(out, { recursive: true });
    const { ids } = await open(page, baseURL!, messy, theme);
    const before = await Promise.all(ids.map((id) => rectOf(page, id)));
    await tidyIntoMosaic(page, `${out}/arrange-menu-${theme}.png`);

    const gap = 16;
    await expect.poll(async () => (await rectOf(page, ids[0]!)).w).toBe(170);
    const after = await Promise.all(ids.map((id) => rectOf(page, id)));
    // Two columns of the median width, one gap apart, from the selection's top-left corner.
    expect(after.every((r) => r.w === 170)).toBe(true);
    const columns = [...new Set(after.map((r) => r.x))].sort((a, b) => a - b);
    expect(columns).toEqual([133, 133 + 170 + gap]);
    expect(Math.min(...after.map((r) => r.y))).toBe(71);
    for (const x of columns) {
      const stack = after.filter((r) => r.x === x).sort((a, b) => a.y - b.y);
      for (let i = 1; i < stack.length; i++) {
        expect(stack[i]!.y - (stack[i - 1]!.y + stack[i - 1]!.h)).toBe(gap);
      }
    }
    // Each card kept its aspect ratio.
    after.forEach((r, i) => {
      expect(r.w / r.h).toBeCloseTo(before[i]!.w / before[i]!.h, 1);
    });
    await page.screenshot({ path: `${out}/mosaic-${theme}.png` });

    // One undo step puts every card back.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => Promise.all(ids.map((id) => rectOf(page, id)))).toEqual(before);
  });
}

test('records tidying into a mosaic', async ({ browser, baseURL }) => {
  test.skip(!process.env.E2E_VIDEO, 'Only when asked for a video (E2E_VIDEO=1).');
  test.setTimeout(90_000);
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'it-IT',
    colorScheme: 'dark',
    recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await open(page, baseURL!, messy);
  await page.waitForTimeout(600);
  await tidyIntoMosaic(page);
  await page.waitForTimeout(1200);
  await context.close();
});

