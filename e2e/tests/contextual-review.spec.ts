// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

async function setup(page: Page, base: string, type: 'column' | 'section') {
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
    data: { name: 'Review regressions' },
  });
  const project = await response.json();
  const doc = createBoardDoc(project.rootBoardId);
  const card = createElement(
    doc,
    type,
    { x: 24, y: 150 },
    { title: 'Original', w: 280 },
    { userId: null },
  );
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  await page.goto('/');
  await page.evaluate(
    (id) => localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
    project.rootBoardId,
  );
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  return page.locator(`[data-el="${card.id}"]`);
}
test('Tab reaches Done and opening Search keeps keyboard focus outside the canvas', async ({
  page,
  baseURL,
}) => {
  const card = await setup(page, baseURL as string, 'column');
  await card.dblclick();
  const input = card.locator('input');
  await input.fill('New title');
  const more = page.locator('.ctxbar').getByRole('button', { name: 'Altre azioni', exact: true });
  await more.focus();
  await expect(input).toBeVisible();
  await more.press('Tab');
  await expect(page.getByRole('button', { name: 'Fatto', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  await card.dblclick();
  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  const search = page.locator('.search__input');
  await expect(search).toBeFocused();
  await page.keyboard.type('N');
  await expect(search).toHaveValue('N');
  await expect(page.locator('.card--note')).toHaveCount(0);
});
// Hocuspocus encodes a document name, sync-message type (0), then update subtype (2).
function isUpdate(payload: Buffer | string) {
  if (typeof payload === 'string') return false;
  let offset = 0;
  const read = () => {
    let value = 0,
      shift = 0;
    while (offset < payload.length) {
      const b = payload[offset++]!;
      value |= (b & 127) << shift;
      if (!(b & 128)) break;
      shift += 7;
    }
    return value;
  };
  const length = read();
  offset += length;
  return read() === 0 && read() === 2;
}
test('section title stays local until blur and commits once', async ({ page, baseURL }) => {
  let updates = 0;
  page.on('websocket', (socket) =>
    socket.on('framesent', (event) => {
      if (isUpdate(event.payload)) updates++;
    }),
  );
  const card = await setup(page, baseURL as string, 'section');
  await card.dblclick();
  updates = 0;
  await card.locator('input').pressSequentially('Updated section');
  expect(updates).toBe(0);
  await page.locator('.ctxbar').getByRole('button', { name: 'Fatto', exact: true }).click();
  await expect(card).toContainText('Updated section');
  expect(updates).toBe(1);
});

test('a newer live document opens read-only with an update-app notice', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const card = await setup(page, base, 'column');
  const boardId = new URL(page.url()).pathname.split('/').at(-1)!;
  const cookie = await signIn(base, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  const future = await readBoard(base, cookie, boardId);
  future.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
  await pushBoardDoc(base, cookie, boardId, future, CURRENT_SCHEMA_VERSION + 1);
  await expect(page.getByRole('alert').filter({ hasText: 'Aggiorna l’app' })).toBeVisible();
  await card.dblclick();
  await expect(card.locator('input')).toHaveCount(0);
  await expect(page.locator('.toolbar__btn--note')).toHaveCount(0);
  if (process.env.CONTEXTUAL_SHOTS) {
    mkdirSync(process.env.CONTEXTUAL_SHOTS, { recursive: true });
    for (const width of [1280, 390])
      for (const theme of ['dark', 'light']) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(process.env.CONTEXTUAL_SHOTS, `review-schema-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
  }
});
