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
