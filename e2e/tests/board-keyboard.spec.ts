// SPDX-License-Identifier: AGPL-3.0-only
// Cards on the canvas are reached and selected with the keyboard alone (#825). Set E2E_SHOTS to
// a folder to also capture the focus ring: light and dark, desktop and phone.
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };

/** A board with three cards: a note and a colour on the first row, a note below the first. */
async function seedBoard(page: Page, base: string) {
  const cookie = await signIn(base, admin);
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base };
    }),
  );
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: `Keyboard cards ${Date.now()}` },
  });
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null } as const;
  const first = createElement(doc, 'note', { x: 60, y: 80 }, { w: 220 }, opts);
  const right = createElement(doc, 'color', { x: 420, y: 80 }, { hex: '#D9774B', label: 'Tramonto' }, opts);
  const below = createElement(doc, 'note', { x: 60, y: 400 }, { w: 220 }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  return { boardUrl: `/p/${project.id}/b/${project.rootBoardId}`, first, right, below };
}

const card = (page: Page, id: string) => page.locator(`.card--free[data-el="${id}"]`);

test('Tab reaches a card, the arrows walk the cards, Enter selects and Escape leaves', async ({
  page,
  baseURL,
}) => {
  const { boardUrl, first, right, below } = await seedBoard(page, baseURL as string);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(boardUrl);
  await expect(page.locator('.card--free')).toHaveCount(3);
  // One tab stop for the whole board: the first card in reading order.
  await expect(page.locator('.card--free[tabindex="0"]')).toHaveCount(1);
  await expect(card(page, first.id)).toHaveAttribute('tabindex', '0');
  await expect(card(page, right.id)).toHaveAttribute('role', 'group');
  await expect(card(page, right.id)).toHaveAccessibleName(/Tramonto/);

  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Tab');
  await expect(card(page, first.id)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(card(page, right.id)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await expect(card(page, below.id)).toBeFocused();
  // The focus alone selects nothing; Enter does, and says so.
  await expect(card(page, below.id)).not.toHaveClass(/is-selected/);
  await page.keyboard.press('Enter');
  await expect(card(page, below.id)).toHaveClass(/is-selected/);
  await expect(page.locator('.canvas > [aria-live="polite"]')).toHaveText(/Nota/);
  // Selected, the arrows move the card as before.
  const before = await card(page, below.id).boundingBox();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await card(page, below.id).boundingBox())?.x)
    .toBeGreaterThan(before?.x ?? 0);
  // Escape clears the selection and keeps the focus; again, it hands the keyboard to the canvas.
  await page.keyboard.press('Escape');
  await expect(card(page, below.id)).not.toHaveClass(/is-selected/);
  await expect(card(page, below.id)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(card(page, first.id)).toBeFocused();
  await page.keyboard.press(' ');
  await expect(card(page, first.id)).toHaveClass(/is-selected/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas')).toBeFocused();
});

test('screenshots for the pull request', async ({ browser, page, baseURL }) => {
  test.skip(!shots, 'Only when E2E_SHOTS is set');
  const { boardUrl, right } = await seedBoard(page, baseURL as string);
  const storageState = await page.context().storageState();
  for (const [name, viewport] of [
    ['1280', { width: 1280, height: 800 }],
    ['390', { width: 390, height: 844 }],
  ] as const)
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport, storageState });
      const shot = await context.newPage();
      await shot.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
      await shot.goto(boardUrl);
      await expect(shot.locator('.card--free')).toHaveCount(3);
      await shot.getByTestId('canvas').focus();
      await shot.keyboard.press('Tab');
      await shot.keyboard.press('ArrowRight');
      await expect(card(shot, right.id)).toBeFocused();
      await shot.screenshot({ path: `${shots}/board-keyboard-${name}-${theme}-focus.png` });
      await shot.keyboard.press('Enter');
      await shot.screenshot({ path: `${shots}/board-keyboard-${name}-${theme}-selected.png` });
      await context.close();
    }
});
