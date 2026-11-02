import { expect, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
test('QA 0.8 settings: provider identity, profile, pending invitations, layout and stalled registration', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (process.env.QA_THEME)
    await page.addInitScript(
      (theme) => localStorage.setItem('inkadra.theme', theme),
      process.env.QA_THEME,
    );
  const cookie = await signIn(baseURL!, account);
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL! };
    }),
  );
  await page.route('**/api/v1/instance', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.auth.oidc = [{ id: 'oidc', name: 'Google OIDC' }];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/v1/instance/members', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items[0].email = 'a.very.long.email.address.for.layout.regression@example.com';
    body.items[0].name = 'A very long administrator name for the member list';
    await route.fulfill({ response, json: body });
  });
  const shots = process.env.QA_SHOTS;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings?section=account');
    await expect(page.locator('.settings-provider').first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/06-account-${width}.png` });
    expect.soft(await page.locator('.settings-provider--oidc').count()).toBe(1);
    await page.goto('/settings?section=providers');
    await expect(page.locator('.settings-provider').first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/06-access-${width}.png` });
    expect.soft(await page.locator('.settings-provider--oidc').count()).toBe(1);
    await page.goto('/settings/team');
    await expect(page.locator('.team-table')).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/05-members-${width}.png` });
    const overflow = await page
      .locator('.settings-window__body')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect.soft(overflow).toBe(false);
  }
  const email = `qa-${Date.now()}@example.com`;
  const invite = () =>
    page.request.post('/api/v1/invitations', {
      headers: { origin: baseURL! },
      data: { kind: 'email', email },
    });
  expect((await invite()).status()).toBe(201);
  expect.soft((await invite()).status()).toBe(409);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page
    .locator('.ink-sidebar__user')
    .getByRole('button', { name: 'Account', exact: true })
    .click();
  await expect(page).toHaveURL(/section=account/);
  await page.route('**/api/v1/instance/settings', () => {});
  await page.goto('/settings?section=registration');
  await expect.soft(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  if (shots) await page.screenshot({ path: `${shots}/07-registration.png` });
});
