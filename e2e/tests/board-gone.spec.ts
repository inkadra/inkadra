// SPDX-License-Identifier: AGPL-3.0-only
// #951: a board deleted while it is open, with its project or on its own (to the trash), says so
// at once instead of staying "Synced" until the next access check, and stops taking edits.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
// Well under the server's periodic access check (30 s): only the delete itself can be this quick.
const AT_ONCE = { timeout: 10_000 };

test.use({ viewport: { width: 1280, height: 800 } });

async function newProject(page: Page, base: string) {
  const cookie = await signIn(base, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: `Board gone ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string; rootBoardId: string };
}

let spot = 0;
/** A double click on empty canvas starts a note, away from the empty board's choices. */
async function addNote(page: Page, text: string) {
  await page.getByTestId('canvas').dblclick({ position: { x: 320, y: 250 + 350 * (spot++ % 2) } });
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas [data-el]').filter({ hasText: text })).toHaveCount(1);
}

const sidebar = (page: Page) => page.locator('.ink-shell > .ink-sidebar');

test('a board whose project is deleted says so, keeps unsaved edits and leads back to Projects', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  // The socket goes through a route, so an edit can stay unconfirmed when the project goes.
  let hold = false;
  await page.routeWebSocket(/\/collab/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (!hold) server.send(message);
    });
  });
  const project = await newProject(page, base);
  // At the project's own address, which the sidebar leaves once the project is gone.
  await page.goto(`/p/${project.id}`);
  const status = page.locator('.sync');
  await expect(status).toHaveAttribute('data-status', 'synced');
  await addNote(page, 'Confirmed');
  await expect(status).toContainText('Sincronizzato');
  hold = true;
  await addNote(page, 'Not confirmed');

  const deleted = await page.request.delete(`/api/v1/projects/${project.id}`, {
    headers: { origin: base },
  });
  expect(deleted.status()).toBe(204);

  const state = page.locator('.board-state');
  await expect(state.getByText('Questa board è stata eliminata')).toBeVisible(AT_ONCE);
  await expect(state).toContainText('La board o il suo progetto è stato eliminato');
  await expect(state).toContainText('restano su questo dispositivo');
  await expect(status).toHaveAttribute('data-status', 'denied');
  await expect(status).toHaveText('Board eliminata');
  // Nothing to edit any more, and the project is gone from the sidebar.
  await expect(page.locator('.canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Condividi' })).toHaveCount(0);
  await expect(sidebar(page).getByText(project.name)).toHaveCount(0);

  const download = page.waitForEvent('download');
  await state.getByRole('button', { name: 'Scarica le modifiche' }).click();
  await download;
  await expect(state.getByRole('button', { name: 'Scarica le modifiche' })).toHaveCount(0);
  await state.getByRole('button', { name: 'Torna ai progetti' }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('a board moved to the trash says it can be restored, with nothing set aside', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const project = await newProject(page, base);
  const created = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin: base },
    data: { title: 'Sopralluoghi', parentBoardId: project.rootBoardId },
  });
  expect(created.ok()).toBe(true);
  const board = (await created.json()) as { id: string };
  await page.goto(`/p/${project.id}/b/${board.id}`);
  const status = page.locator('.sync');
  await expect(status).toHaveAttribute('data-status', 'synced');
  await addNote(page, 'Saved before the trash');
  await expect(status).toContainText('Sincronizzato');
  await expect(sidebar(page).getByRole('link', { name: 'Sopralluoghi' })).toHaveCount(1);

  const trashed = await page.request.delete(`/api/v1/boards/${board.id}`, {
    headers: { origin: base },
  });
  expect(trashed.status()).toBe(204);

  const state = page.locator('.board-state');
  await expect(state.getByText('Questa board è nel cestino')).toBeVisible(AT_ONCE);
  await expect(state).toContainText('Chi gestisce il progetto può ripristinarla');
  await expect(status).toHaveText('Board nel cestino');
  await expect(state.getByRole('button')).toHaveText(['Torna ai progetti']);
  // The project stays; the board leaves its tree.
  await expect(sidebar(page).getByText(project.name)).toHaveCount(1);
  await expect(sidebar(page).getByRole('link', { name: 'Sopralluoghi' })).toHaveCount(0);
});
