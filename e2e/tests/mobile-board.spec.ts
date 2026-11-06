import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { pushBoardDoc } from './perf/seed.ts';

test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

const width = 360;

/** The element sits inside the screen, left to right. */
async function inside(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  return box!;
}

test('a card on a phone: selection bar, menu and inline editor fit the screen', async ({
  page,
  baseURL,
}) => {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    {
      headers: { origin: baseURL! },
      data: {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      },
    },
  );
  expect(auth.ok()).toBe(true);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: `Mobile board ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.locator('.canvas .toolbar').getByRole('button', { name: 'Nota', exact: true }).tap();
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Ultimo treno');
  await page.keyboard.press('Escape');
  const card = page.locator('.card[data-type="note"]', { hasText: 'Ultimo treno' });
  await expect(card).toHaveCount(1);

  // The selection bar stays on screen with finger-sized buttons (40 px wide, so eight fit).
  await page.keyboard.press('Escape');
  await card.tap();
  const bar = page.getByRole('toolbar', { name: 'Azioni sulla selezione' });
  await expect(bar).toBeVisible();
  await inside(bar);
  for (const button of await bar.locator('.ctxbar__btn').all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  // A long press or ⋯ opens the card's sheet from the bottom edge (#110), with every action of
  // the menu and finger-sized rows; Escape closes it and gives the focus back.
  await card.click({ button: 'right' });
  const sheet = page.getByRole('dialog', { name: 'Nota · Ultimo treno', exact: true });
  await expect(sheet).toBeVisible();
  await inside(sheet);
  const sheetBox = await sheet.boundingBox();
  expect(Math.round(sheetBox!.y + sheetBox!.height)).toBeGreaterThanOrEqual(779);
  for (const name of ['Modifica', 'Commenta', 'Colore', 'Collega', 'Duplica', 'Blocca posizione'])
    await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of ['Sposta in…', 'Tag…', 'Porta in primo piano', 'Elimina']) {
    const row = sheet.getByRole('button', { name, exact: true });
    await row.scrollIntoViewIfNeeded();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(sheet.getByRole('switch', { name: 'Mostra al cliente' })).toBeChecked();
  await sheet.getByRole('button', { name: 'Colore', exact: true }).tap();
  await sheet.getByRole('button', { name: 'Blu', exact: true }).tap();
  await expect(card).toHaveClass(/card--tint-blue/);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // ⋯ on the selection bar opens the same sheet.
  await bar.getByRole('button', { name: 'Altre azioni', exact: true }).tap();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Duplica', exact: true }).tap();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.card[data-type="note"]', { hasText: 'Ultimo treno' })).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(card).toHaveCount(1);

  // Editing transforms the same bar and keeps the note on the canvas.
  await card.dblclick();
  await expect(card.locator('[contenteditable=true]')).toBeVisible();
  await inside(page.locator('.ctxbar'));
  await expect(page.getByRole('button', { name: 'Fatto', exact: true })).toBeVisible();
  await expect(page.locator('.note-sidesheet')).toHaveCount(0);
});

/** Signs in and makes a new project. */
async function newProject(page: Page, baseURL: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    {
      headers: { origin: baseURL },
      data: {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      },
    },
  );
  expect(auth.ok()).toBe(true);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: `Mobile sheet ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

/** Opens a new project with one note; returns the note and the board's id. */
async function noteOnBoard(page: Page, baseURL: string) {
  const project = await newProject(page, baseURL);
  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.locator('.canvas .toolbar').getByRole('button', { name: 'Nota', exact: true }).tap();
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Logline');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const card = page.locator('.card[data-type="note"]', { hasText: 'Logline' });
  await expect(card).toHaveCount(1);
  return { card, boardId: project.rootBoardId as string };
}

test('the card sheet answers a thread with the comments panel closed', async ({
  page,
  baseURL,
}) => {
  const { card, boardId } = await noteOnBoard(page, baseURL!);
  const elementId = await card.getAttribute('data-el');
  const comment = await page.request.post(`/api/v1/boards/${boardId}/comments`, {
    headers: { origin: baseURL! },
    data: { elementId, body: 'Più corta?', visibility: 'everyone' },
  });
  expect(comment.ok()).toBe(true);
  // The panel was never opened: the threads come from the board's own load.
  await page.reload();
  await expect(card).toBeVisible();
  await expect(page.locator('.comments-panel')).toHaveCount(0);
  await card.tap();
  await page
    .getByRole('toolbar', { name: 'Azioni sulla selezione' })
    .getByRole('button', { name: 'Altre azioni' })
    .tap();
  const reply = page.locator('.card-sheet__reply');
  await expect(reply.locator('.card-sheet__comment')).toContainText('Più corta?');
  // A thread guests read: it says so, and Enter does not send.
  await expect(reply.locator('.comment-audience')).toBeVisible();
  let sent = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/boards/${boardId}/comments`)) sent++;
  });
  const field = reply.locator('textarea');
  await field.tap();
  await field.pressSequentially('Sì');
  await field.press('Enter');
  await field.press('Control+Enter');
  await page.waitForTimeout(300);
  expect(sent).toBe(0);
  await reply.getByRole('button', { name: 'Rispondi', exact: true }).tap();
  await expect.poll(() => sent).toBe(1);
  await expect(field).toHaveValue('');
  await expect(reply.locator('.card-sheet__comment')).toContainText('Sì');
});

test('a list opened from the card sheet shows only that list', async ({ page, baseURL }) => {
  const project = await newProject(page, baseURL!);
  const me = await (await page.request.get('/api/v1/me')).json();
  const doc = createBoardDoc(project.rootBoardId);
  createElement(
    doc,
    'scene',
    { x: 40, y: 40 },
    { number: '3', title: 'Binario', w: 420 },
    { userId: me.id },
  );
  createElement(doc, 'todo', { x: 40, y: 400 }, { items: [] }, { userId: me.id });
  const cookies = await page.context().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}`);
  const todo = page.locator('.card[data-type="todo"]');
  await expect(todo).toHaveCount(1);
  await todo.tap();
  await page
    .getByRole('toolbar', { name: 'Azioni sulla selezione' })
    .getByRole('button', { name: 'Altre azioni' })
    .tap();
  const sheet = page.locator('.card-sheet');
  await expect(sheet.locator('.card-sheet__quick-btn').first()).toBeVisible();
  await sheet.getByRole('button', { name: /^Scena:/ }).tap();
  await expect(sheet.getByRole('button', { name: 'Nessuna scena', exact: true })).toBeVisible();
  await expect(sheet.locator('.card-sheet__quick-btn')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Sposta in…', exact: true })).toHaveCount(0);
});
