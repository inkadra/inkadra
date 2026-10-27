import { expect, test } from '@playwright/test';

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
  const bounds = await canvas.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(390);
  expect(bounds?.height).toBeGreaterThan(600);
  await expect(page.locator('.mobile-view-switcher')).toBeVisible();
  await page.locator('.mobile-view-switcher').selectOption('shotlist');
  await expect(page).toHaveURL(/view=shotlist/);
  await page.locator('.mobile-view-switcher').selectOption('canvas');
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
  const zoomBounds = await page.locator('.canvas__corner .zoom').boundingBox();
  expect(zoomBounds!.y + zoomBounds!.height).toBeLessThanOrEqual(toolbarBounds!.y);
  await toolbar.getByRole('button', { name: 'Nota', exact: true }).tap();
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: /^(Inbox|Notifications:)/ }).click();
  await expect(page.locator('.notifications--fixed')).toBeVisible();
  expect((await page.locator('.notifications--fixed').boundingBox())?.width).toBe(390);
  await nav.getByRole('button', { name: /^(Inbox|Notifications:)/ }).click();
  await expect(page.locator('.notifications--fixed')).toBeHidden();
  await nav.getByRole('button', { name: /^(Inbox|Notifications:)/ }).click();
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('button', { name: /^(Inbox|Notifications:)/ })).toBeFocused();
  await nav.getByRole('button', { name: 'Nuovo progetto', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Profilo', exact: true }).click();
  await expect(page).toHaveURL('/settings');
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
