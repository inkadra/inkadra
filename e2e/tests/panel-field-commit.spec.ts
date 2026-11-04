// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// Side-panel fields save on blur: a click that closes or switches the panel must not lose them.
test('text typed in a side panel survives a click on the board', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const cookie = await signIn(baseURL!, {
    name: 'Giulia Bianchi',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseURL! };
    }),
  );
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { origin: baseURL! },
      data: { name: 'Panel fields' },
    })
  ).json();
  const doc = createBoardDoc(project.rootBoardId);
  const first = createElement(doc, 'frame', { x: 60, y: 80 }, { w: 200 }, { userId: null });
  const second = createElement(doc, 'frame', { x: 60, y: 300 }, { w: 200 }, { userId: null });
  const person = createElement(doc, 'character', { x: 320, y: 300 }, { name: 'Marta' }, { userId: null });
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  const card = (id: string) => page.locator(`[data-el="${id}"]`);
  const action = page.locator('.film-panel').getByLabel('Azione', { exact: true });
  // Far from every card; the board's own panels stay on the left and on top.
  const emptyBoard = () => page.mouse.click(700, 600);

  await test.step('empty board closes the frame panel', async () => {
    await card(first.id).dblclick();
    await action.fill('Marta accende il braciere');
    await emptyBoard();
    await expect(page.locator('.film-panel')).toHaveCount(0);
    await expect(card(first.id).locator('.card__caption')).toHaveText('Marta accende il braciere');
  });

  await test.step('another frame takes the panel, the text stays on the first', async () => {
    await card(first.id).dblclick();
    await action.fill('Testo della prima');
    await card(second.id).click();
    await expect(page.locator('.film-panel__label')).toHaveText('2');
    await expect(action).toHaveValue('');
    await expect(card(first.id).locator('.card__caption')).toHaveText('Testo della prima');
    await expect(card(second.id).locator('.card__caption')).toHaveCount(0);
  });

  await test.step('another kind of card closes the panel', async () => {
    await action.fill('Testo della seconda');
    await card(person.id).click();
    await expect(page.locator('.film-panel')).toHaveCount(0);
    await expect(card(second.id).locator('.card__caption')).toHaveText('Testo della seconda');
  });

  await test.step('any panel with these fields: the character sheet', async () => {
    await card(person.id).dblclick();
    const actor = page.locator('.story-panel').getByLabel('Interprete', { exact: true });
    await actor.fill('Anna Rossi');
    await emptyBoard();
    await expect(page.locator('.story-panel')).toHaveCount(0);
    await card(person.id).dblclick();
    await expect(actor).toHaveValue('Anna Rossi');
  });
});
