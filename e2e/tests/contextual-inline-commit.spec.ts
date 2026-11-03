// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// Leaving an inline field with a canvas click or "Done" keeps what was typed (toolbar A).
for (const width of [1280, 390]) {
  test(`contextual inline commit at ${width}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    const base = baseURL as string;
    const cookie = await signIn(base, {
      name: 'Giulia',
      email: 'giulia@example.com',
      password: 'correct-horse-battery',
    });
    await page.context().addCookies(
      cookie.split('; ').map((pair) => {
        const i = pair.indexOf('=');
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
      }),
    );
    const response = await page.request.post('/api/v1/projects', {
      headers: { origin: base },
      data: { name: 'Inline commit' },
    });
    const project = await response.json();
    const doc = createBoardDoc(project.rootBoardId);
    const column = createElement(
      doc,
      'column',
      { x: 24, y: 150 },
      { w: 280, title: 'Original' },
      { userId: null },
    );
    await pushBoardDoc(base, cookie, project.rootBoardId, doc);
    await page.goto('/');
    await page.evaluate(
      (id) =>
        localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
      project.rootBoardId,
    );
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
    const card = page.locator(`[data-el="${column.id}"]`);

    // A click on empty canvas closes the field and keeps the new title.
    await card.dblclick();
    await card.locator('input').fill('Updated title');
    await page.locator('.canvas').click({ position: { x: width - 30, y: 400 } });
    await expect(card.locator('input')).toHaveCount(0);
    await expect(card).toContainText('Updated title');

    // "Done" in the contextual bar keeps it too, and common actions stay reachable while editing.
    await card.dblclick();
    await card.locator('input').fill('Second title');
    const bar = page.locator('.ctxbar');
    await bar.getByRole('button', { name: 'Altre azioni', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Elimina', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await card.dblclick();
    await card.locator('input').fill('Second title');
    await bar.getByRole('button', { name: 'Fatto', exact: true }).click();
    await expect(card.locator('input')).toHaveCount(0);
    await expect(card).toContainText('Second title');
  });
}
