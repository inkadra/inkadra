import { expect, type Locator, test } from '@playwright/test';

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

test('a card on a phone: selection bar, menu and note sheet fit the screen', async ({
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

  // The card menu stays inside the board, above the phone navigation, and scrolls if it must.
  await card.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const menuBox = await inside(menu);
  const nav = await page
    .getByRole('navigation', { name: 'Navigazione principale', exact: true })
    .boundingBox();
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(nav!.y);
  const item = await menu.getByRole('menuitem').first().boundingBox();
  expect(item!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The note opens as a full-screen sheet, without a Full page toggle that would do nothing.
  await card.dblclick();
  const sheet = page.locator('.note-sidesheet');
  await expect(sheet).toBeVisible();
  // It slides in from the right: measure once it has arrived.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return { x: box?.x, width: box?.width };
    })
    .toEqual({ x: 0, width });
  await expect(sheet.getByRole('button', { name: 'A tutta pagina' })).toBeHidden();
});
