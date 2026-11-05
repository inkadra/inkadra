// SPDX-License-Identifier: AGPL-3.0-only
// Notes on the canvas, step by step as a person does it: delete and Undo, lock and hide from
// guests. Each check reloads, so what counts is what the server kept.
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const TOAST = '.toast:not(.ink-motion-exit)';

let existingId: string;

test.beforeEach(async ({ page, baseURL }) => {
  const base = baseURL as string;
  const cookie = await signIn(base, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  await page.goto('/');
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: 'Explorbot notes', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  // A note that is on the board before the page loads.
  const doc = createBoardDoc(project.rootBoardId);
  existingId = createElement(doc, 'note', { x: 80, y: 120 }, { w: 220 }, { userId: null }).id;
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('Existing note')]);
  const body = roots(doc).elements.get(existingId)?.get('body') as Y.XmlFragment;
  body.insert(0, [paragraph]);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  await page.evaluate(
    (id) => localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
    project.rootBoardId,
  );
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
});

const cards = (page: Page) => page.locator('.canvas [data-el]');

/** Note tool, a click on empty canvas, some text, Escape: a new note, still selected. */
async function addNote(page: Page, text: string) {
  await page.locator('.canvas .toolbar').getByRole('button', { name: 'Nota', exact: true }).click();
  await page.mouse.click(700, 420);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const note = cards(page).filter({ hasText: text });
  await expect(note).toHaveCount(1);
  return note;
}

test('Delete then Undo on a new note keeps the existing one and brings the new one back', async ({
  page,
}) => {
  const fresh = await addNote(page, 'Fresh note');
  await expect(cards(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(fresh).toHaveCount(0);
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
  await page.locator(TOAST).getByRole('button', { name: 'Annulla' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
  await expect(cards(page).filter({ hasText: 'Fresh note' })).toHaveCount(1);
  await expect(cards(page)).toHaveCount(2);
});

test('Delete then Undo on the existing note brings it back after a reload', async ({ page }) => {
  await addNote(page, 'Fresh note');
  await page.locator(`[data-el="${existingId}"]`).click();
  await page.keyboard.press('Escape');
  await page.locator(`[data-el="${existingId}"]`).click();
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-el="${existingId}"]`)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);
  await page.locator(TOAST).getByRole('button', { name: 'Annulla' }).click();
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(`[data-el="${existingId}"]`)).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
});

test('a locked note hidden from guests is still on the board after a reload', async ({ page }) => {
  const card = page.locator(`[data-el="${existingId}"]`);
  await card.click();
  const bar = page.locator('.ctxbar');
  await bar.getByRole('button', { name: 'Blocca posizione' }).click();
  await bar.getByRole('button', { name: 'Nascondi agli ospiti' }).click();
  await expect(bar.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('a selection bar control brought into view is not under Delete and More', async ({
    page,
  }) => {
    await page.locator(`[data-el="${existingId}"]`).click();
    const bar = page.locator('.ctxbar');
    await expect(bar).toBeVisible();
    // The bar scrolls sideways under its last two buttons; focus scrolls each control in.
    for (const button of await bar.locator('button').all()) {
      await button.focus();
      const covered = await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top && !el.contains(top) ? (top.getAttribute('aria-label') ?? top.className) : null;
      });
      expect(covered, (await button.getAttribute('aria-label')) ?? '').toBeNull();
    }
  });
});
