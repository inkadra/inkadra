// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// A to-do card resized by its corner: the selection outline stays on the card while it is dragged,
// the card never gets shorter than its text (nothing spills out under it), never so narrow that
// the text breaks a few letters per line, and the drag logs no ResizeObserver loop
// (inkadra-feedback#23).
import { addTodoItem, createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** With CARD_RESIZE_SHOTS set, a screenshot of each drag, held and let go. */
const shots = process.env.CARD_RESIZE_SHOTS;

for (const theme of shots ? (['light', 'dark'] as const) : (['light'] as const)) {
  test(`a resized to-do card keeps its text inside ${theme}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const cookie = await signIn(baseURL!, account);
    await page.context().addCookies(
      cookie.split('; ').map((pair) => {
        const index = pair.indexOf('=');
        return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
      }),
    );
    await page.addInitScript((value) => {
      localStorage.setItem('inkadra.theme', value);
      // The browser reports a ResizeObserver loop as an error event, not as an uncaught error.
      const loops: string[] = [];
      Object.assign(window, { resizeLoops: loops });
      window.addEventListener('error', (e) => {
        if (String(e.message).includes('ResizeObserver')) loops.push(e.message);
      });
    }, theme);
    await page.goto('/');
    const created = await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: `Scheda stretta ${theme}`, type: 'short_film' },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const doc = createBoardDoc(project.rootBoardId);
    const list = createElement(
      doc,
      'todo',
      { x: 200, y: 160 },
      { title: 'After the shoot', items: [] },
      { userId: null },
    );
    for (const text of [
      'Send the proofing link to Studio Maree',
      'Retouch the picks',
      'Return the coat to Studio Maree',
      'Deliver the finals',
    ])
      addTodoItem(doc, list.id, text);
    await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
    const saved = async () => {
      const board = await readBoard(baseURL!, cookie, project.rootBoardId);
      const map = roots(board).elements.get(list.id);
      return map ? readElement(map) : null;
    };

    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
    const card = page.locator(`.card[data-el="${list.id}"]`);
    await card.locator('.card__todo-head').click();
    const handle = page.locator('[data-handle="se"]');
    const outline = page.locator(`.canvas__resize-handles[data-resize-el="${list.id}"]`);
    /** How far the outline's bottom and the card's text bottom are apart, in screen px. */
    const fit = async () => {
      const box = (await outline.boundingBox())!;
      const text = await card.evaluate((el) => {
        const r = el.getBoundingClientRect();
        // Everything the card draws, also what spills out under a height set too short.
        return r.top + el.scrollHeight * (r.height / el.offsetHeight);
      });
      return { outlineBelowText: Math.round(box.y + box.height - text), width: box.width };
    };
    const drag = async (dx: number, dy: number, name: string) => {
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 20 });
      // Still held: the outline is the card, and the text stays inside it.
      await expect.poll(async () => (await fit()).outlineBelowText).toBeGreaterThanOrEqual(-1);
      if (shots) await page.screenshot({ path: `${shots}/card-resize-${theme}-${name}-held.png` });
      await page.mouse.up();
      await expect.poll(async () => (await fit()).outlineBelowText).toBeGreaterThanOrEqual(-1);
      if (shots) await page.screenshot({ path: `${shots}/card-resize-${theme}-${name}.png` });
    };

    // Squeezed into the top left corner: as narrow and short as the handles allow.
    await drag(-400, -400, 'narrow');
    const narrow = (await fit()).width;
    // A line of the list still holds a word or two, not a few letters.
    expect(narrow).toBeGreaterThanOrEqual(160);
    const cardBox = (await card.boundingBox())!;
    const outlineBox = (await outline.boundingBox())!;
    expect(Math.abs(cardBox.height - outlineBox.height)).toBeLessThan(3);
    await expect.poll(async () => (await saved())?.w).toBeGreaterThanOrEqual(160);

    // Stretched taller than its text, the card keeps the empty space it was given.
    await drag(200, 200, 'tall');
    await expect.poll(async () => (await saved())?.h ?? 0).toBeGreaterThan(cardBox.height + 100);
    expect((await card.boundingBox())!.height).toBeGreaterThan(cardBox.height + 100);

    expect(
      await page.evaluate(() => (window as unknown as { resizeLoops: string[] }).resizeLoops),
    ).toEqual([]);
  });
}
