import { expect, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('mobile shell gives the canvas full width and keeps shell actions reachable', async ({
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
    data: { name: `Mobile shell ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  // Something waiting in Unsorted, so its chip shows on the canvas.
  const clip = await page.request.post('/api/v1/clip', {
    headers: { origin: baseURL! },
    data: { boardId: project.rootBoardId, text: 'To place later' },
  });
  expect(clip.ok()).toBe(true);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  await expect(nav).toBeVisible();
  await expect(page.locator('.ink-shell > .ink-sidebar')).toBeHidden();
  await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigazione', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Chiudi navigazione' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(nav.getByRole('button', { name: 'Progetti', exact: true })).toBeFocused();
  await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
  await drawer.getByRole('link', { name: project.name, exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(`/p/${project.id}`);
  const canvas = page.getByTestId('canvas');
  await expect(canvas).toBeVisible();
  // The lazy board stylesheet can commit after the canvas becomes visible. Wait for
  // the responsive layout before measuring it.
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return { x: box?.x, width: box?.width };
    })
    .toEqual({ x: 0, width: 390 });
  const bounds = await canvas.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(390);
  expect(bounds?.height).toBeGreaterThan(600);
  await expect(page.locator('.mobile-view-switcher')).toBeVisible();
  await chooseSelect(page.locator('.mobile-view-switcher'), 'shotlist');
  await expect(page).toHaveURL(/view=shotlist/);
  await chooseSelect(page.locator('.mobile-view-switcher'), 'canvas');
  await expect(canvas).toBeVisible();
  const toolbar = page.locator('.canvas .toolbar');
  await expect(toolbar).toBeVisible();
  const toolbarBounds = await toolbar.boundingBox();
  expect(toolbarBounds!.x).toBeGreaterThanOrEqual(0);
  expect(toolbarBounds!.x + toolbarBounds!.width).toBeLessThanOrEqual(390);
  const lastTool = toolbar.getByRole('button').last();
  await lastTool.scrollIntoViewIfNeeded();
  const target = await lastTool.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  // One row of tools that scrolls sideways, not two rows over the canvas.
  expect(toolbarBounds!.height).toBeLessThan(70);
  const zoomBounds = await page.locator('.canvas__corner .zoom').boundingBox();
  expect(zoomBounds!.y + zoomBounds!.height).toBeLessThanOrEqual(toolbarBounds!.y);
  const unsortedBounds = await page.locator('.canvas .unsorted__toggle').boundingBox();
  expect(unsortedBounds!.y + unsortedBounds!.height).toBeLessThanOrEqual(zoomBounds!.y);
  expect(unsortedBounds!.height).toBeGreaterThanOrEqual(44);
  await toolbar.getByRole('button', { name: 'Nota', exact: true }).tap();
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: /^(Inbox|Notifiche:)/ }).click();
  await expect(page.locator('.notifications--fixed')).toBeVisible();
  expect((await page.locator('.notifications--fixed').boundingBox())?.width).toBe(390);
  await nav.getByRole('button', { name: /^(Inbox|Notifiche:)/ }).click();
  await expect(page.locator('.notifications--fixed')).toBeHidden();
  await nav.getByRole('button', { name: /^(Inbox|Notifiche:)/ }).click();
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('button', { name: /^(Inbox|Notifiche:)/ })).toBeFocused();
  // New offers a project, or a board in the open project.
  await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Crea', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: `Nuova board in ${project.name}`, exact: true }).click();
  const boardDialog = page.getByRole('dialog', { name: 'Nuova board', exact: true });
  await expect(boardDialog).toBeVisible();
  await expect(boardDialog.getByLabel('Progetto')).toHaveAttribute('data-value', project.id);
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
  await sheet.getByRole('button', { name: 'Nuovo progetto', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // A DOM marker survives only if opening settings keeps this canvas instance mounted.
  await canvas.evaluate((el) => el.setAttribute('data-settings-mount-probe', 'alive'));
  await nav.getByRole('button', { name: 'Profilo', exact: true }).click();
  await expect(page).toHaveURL('/settings');
  await expect(canvas).toHaveAttribute('data-settings-mount-probe', 'alive');
  // Settings slide up as a full-screen sheet: the list first, then one page with a way back.
  const settings = page.locator('dialog.settings-window');
  await expect(settings.getByRole('heading', { name: 'Profilo', exact: true })).toBeVisible();
  expect((await settings.boundingBox())?.width).toBe(390);
  await settings.getByRole('link', { name: /^Notifiche email/ }).click();
  await expect(page).toHaveURL('/settings?section=notifications');
  await expect(settings.getByRole('heading', { name: 'Notifiche', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Indietro', exact: true }).click();
  await expect(page).toHaveURL('/settings');
  // Closing returns to the board, which stayed open underneath.
  await settings.getByRole('button', { name: 'Chiudi impostazioni', exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(canvas).toHaveAttribute('data-settings-mount-probe', 'alive');
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}`));
  await expect(canvas).toBeVisible();
  await page.goto(`/p/${project.id}`);
  await page.getByRole('button', { name: 'Indietro', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto(`/p/${project.id}`);
  await page.setViewportSize({ width: 767, height: 390 });
  await expect(nav).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(767);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toBeHidden();
  await expect(page.locator('.ink-shell > .ink-sidebar')).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())?.x).toBeGreaterThanOrEqual(240);
});
