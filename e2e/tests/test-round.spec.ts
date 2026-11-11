// SPDX-License-Identifier: AGPL-3.0-only
import { addTodoItem, createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const LONG =
  'Una voce molto molto lunga che deve restare leggibile per intero senza essere tagliata dalla card del to-do anche se occupa tante righe';
const shots = process.env.ROUND_SHOTS;
const shoot = async (page: Page, name: string) => {
  if (!shots) return;
  await page.mouse.move(0, 0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.screenshot({ path: `${shots}/${name}-${page.viewportSize()?.width}-${theme}.png` });
  }
};

async function start(page: Page, baseURL: string, name: string) {
  const cookie = await signIn(baseURL, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL };
    }),
  );
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name },
  });
  const project = (await response.json()) as { id: string; rootBoardId: string };
  return { cookie, project };
}

test('a cancelled upload leaves no card, for anyone, and no asset', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project } = await start(page, baseURL!, 'Cancel');
  const url = `/p/${project.id}/b/${project.rootBoardId}`;
  await page.goto(url);
  await expect(page.locator('.canvas')).toBeVisible();
  const other = await browser.newContext({ storageState: await page.context().storageState() });
  const peer = await other.newPage();
  await peer.goto(url);
  await expect(peer.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 2e6,
    uploadThroughput: 200_000,
  });
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/uploads'),
  );
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array(8 * 1024 * 1024)], 'cancel-me.mp4', { type: 'video/mp4' }),
    );
    return dt;
  });
  await page
    .locator('.canvas')
    .dispatchEvent('drop', { dataTransfer: transfer, clientX: 400, clientY: 260 });
  const assetId = (await created).headers()['inkadra-asset-id'];
  const cards = page.locator('[data-type="file"]');
  await expect(cards).toHaveCount(1);
  await expect(peer.locator('[data-type="file"]')).toHaveCount(1);

  await page.locator('.uploads').getByRole('button', { name: 'Annulla' }).click();
  await expect(cards).toHaveCount(0);
  await expect(peer.locator('[data-type="file"]')).toHaveCount(0);
  await expect(page.locator('.ctxbar')).toHaveCount(0);
  await cdp.detach();
  // Undo does not bring it back, nor does a reload.
  await page.locator('.canvas').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards).toHaveCount(0);
  await expect
    .poll(async () => (await page.request.get(`/api/v1/assets/${assetId}`)).status())
    .toBe(404);
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(cards).toHaveCount(0);
  await other.close();
});

test('the crop comes back when the angle does, and a long to-do reads in full', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { cookie, project } = await start(page, baseURL!, 'Crop');
  await page.goto('/');
  const asset = await uploadFile(baseURL!, cookie, project.id, {
    body: await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 600 } }),
    name: 'portrait.png',
    type: 'image/png',
  });
  if (!asset) throw new Error('upload failed');
  await waitForAssets(baseURL!, cookie, [asset]);
  const doc = createBoardDoc(project.rootBoardId);
  const image = createElement(
    doc,
    'image',
    { x: 80, y: 40 },
    { w: 280, assetId: asset },
    { userId: null },
  );
  const todo = createElement(
    doc,
    'todo',
    { x: 500, y: 40 },
    { w: 240, items: [] },
    { userId: null },
  );
  addTodoItem(doc, todo.id, 'Voce uno');
  addTodoItem(doc, todo.id, LONG);
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);

  // Rotation.
  await page.locator(`[data-el="${image.id}"]`).click();
  await page.keyboard.press('x');
  const stage = page.getByTestId('image-crop-stage');
  const box = page.getByTestId('image-crop-box');
  await expect(stage).toBeVisible();
  const coverage = async () => {
    const [s, b] = [await stage.boundingBox(), await box.boundingBox()];
    return s && b ? Math.round((b.width / s.width) * 100) : 0;
  };
  const slider = page.getByRole('slider', { name: 'Angolo di rotazione' });
  await expect(slider).toHaveAttribute('min', '-179');
  await expect(slider).toHaveAttribute('max', '179');
  for (const sign of [1, -1]) {
    for (const angle of [10, 20, 30]) await slider.fill(String(angle * sign));
    await expect.poll(coverage).toBeLessThan(90);
    if (sign === 1) {
      await slider.blur();
      await shoot(page, 'crop-30');
    }
    for (const angle of [20, 10, 0]) await slider.fill(String(angle * sign));
    await expect(page.getByRole('textbox', { name: 'Angolo di rotazione: valore' })).toHaveValue('0');
    await expect.poll(coverage).toBe(100);
  }
  await slider.blur();
  await shoot(page, 'crop-back-to-0');
  await page.locator('.crop-bar').getByRole('button', { name: 'Fatto' }).click();

  // The long item, read and written.
  const card = page.locator(`[data-el="${todo.id}"]`);
  const long = card.locator('.card__todo-list li').nth(1);
  const beside = async (text: string) => {
    const check = await long.locator('.ink-choice').boundingBox();
    const words = await long.locator(text).boundingBox();
    expect(words!.x).toBeGreaterThan(check!.x + check!.width - 1);
    expect(Math.abs(words!.y - check!.y)).toBeLessThan(8);
    expect(words!.height).toBeGreaterThan(40);
  };
  await beside('.card__todo-text');
  await card.click();
  await shoot(page, 'todo-read');
  await card.dblclick();
  const field = long.getByRole('textbox', { name: 'Voce' });
  await expect(field).toHaveValue(LONG);
  await beside('textarea');
  expect(await field.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await shoot(page, 'todo-edit');
  // Enter ends the item, and does not put a line break in it.
  await field.press('Enter');
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue(LONG);
});

test('a failed address search is readable over the empty board', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project } = await start(page, baseURL!, 'Map');
  await page.route('**/api/v1/map-search', (route) =>
    route.fulfill({ status: 400, json: { error: { code: 'bad_request', message: 'x' } } }),
  );
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await page
    .getByRole('button', { name: /^Mappa/ })
    .first()
    .click();
  await page.locator('.canvas').click({ position: { x: 280, y: 280 } });
  const input = page.getByRole('combobox');
  await input.fill('Piazza del Duomo, Milano');
  const message = page.locator('.map-draft > p');
  await expect(message).toHaveText(/Ricerca non disponibile/);
  const color = await message.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).not.toBe('rgba(0, 0, 0, 0)');
  await shoot(page, 'map-error');
});

// Only for the pull request's screenshots: ROUND_SHOTS=<folder>.
test('screenshots of the other screens', async ({ page, baseURL }) => {
  test.skip(!shots);
  test.setTimeout(90_000);
  const { cookie, project } = await start(page, baseURL!, 'Shots');
  await page.goto('/');
  const asset = await uploadFile(baseURL!, cookie, project.id, {
    body: await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 600 } }),
    name: 'portrait.png',
    type: 'image/png',
  });
  if (!asset) throw new Error('upload failed');
  await waitForAssets(baseURL!, cookie, [asset]);
  const doc = createBoardDoc(project.rootBoardId);
  const at = (x: number, y: number) => ({ x, y });
  const options = { userId: null };
  const note = createElement(doc, 'note', at(40, 40), { w: 240 }, options);
  const image = createElement(doc, 'image', at(40, 200), { w: 240, assetId: asset }, options);
  const plan = createElement(
    doc,
    'plan',
    at(340, 40),
    {
      w: 300,
      scale: 100,
      grid: '0.5',
      rulers: true,
      icons: [
        {
          id: 'iconAAAAAAAAA',
          kind: 'camera',
          color: '#9DB8F2',
          x: 500,
          y: 300,
          steps: [
            { x: 200, y: 200 },
            { x: 500, y: 300 },
          ],
        },
      ],
    },
    options,
  );
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  const board = `/p/${project.id}/b/${project.rootBoardId}`;

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(board);
  await page.locator(`[data-el="${note.id}"]`).click();
  await page.locator('.ctxbar').getByRole('button', { name: 'Tag', exact: true }).click();
  const tag = page.getByRole('textbox', { name: 'Aggiungi un tag' });
  await tag.fill('Nuovo');
  await tag.press('Enter');
  await expect(page.getByRole('alert')).toContainText('non è nel catalogo');
  await shoot(page, 'tag-not-in-catalog');
  await page.keyboard.press('Escape');
  await page.goto(board);
  await page.locator(`[data-el="${plan.id}"]`).dblclick();
  await expect(page.locator('.plan-ruler--top')).toBeVisible();
  await page.waitForTimeout(500); // The editor's entrance.
  await shoot(page, 'plan-rulers-route');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(board);
  await page.locator(`[data-el="${note.id}"]`).click();
  await expect(page.locator('.ctxbar').getByRole('button', { name: 'Elimina' })).toBeInViewport();
  await expect(
    page.locator('.ctxbar').getByRole('button', { name: 'Altre azioni' }),
  ).toBeInViewport();
  await shoot(page, 'note-bar');
  await page.locator(`[data-el="${image.id}"]`).click();
  await page.keyboard.press('x');
  await expect(page.getByTestId('image-crop-stage')).toBeVisible();
  await shoot(page, 'crop');
});
