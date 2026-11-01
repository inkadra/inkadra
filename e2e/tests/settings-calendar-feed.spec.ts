import { expect, test } from '@playwright/test';

// Keep this file after first-run.spec.ts: the shared suite starts with onboarding.
// Bearer links must never enter test traces or failure screenshots.
test.use({ trace: 'off', screenshot: 'off' });
test('copy a private feed and revoke the previous link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  const account = {
    name: 'Giulia Bianchi',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  };
  const instance = await (await page.request.get('/api/v1/instance')).json();
  if (instance.setupRequired) {
    expect(
      (
        await page.request.post('/api/auth/sign-up/email', { headers: { origin }, data: account })
      ).ok(),
    ).toBe(true);
  } else {
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Accedi', exact: true }).click();
    await expect(page).toHaveURL('/');
  }
  let releaseMetadata: (() => void) | undefined;
  const metadata = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  await page.route('**/api/v1/me/calendar-feed', async (route) => {
    if (route.request().method() === 'GET') await metadata;
    await route.continue();
  });
  await page.goto('/settings?section=notifications');
  const section = page.getByRole('region', { name: 'Calendario', exact: true });
  await expect(section.getByRole('button', { name: 'Rigenera…', exact: true })).toBeDisabled();
  releaseMetadata?.();
  await expect(section.getByRole('button', { name: 'Copia', exact: true })).toBeEnabled();
  const old = await section.getByLabel('Link del tuo calendario').inputValue();
  await section.getByRole('button', { name: 'Copia', exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())) === old).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Link copiato' })).toBeVisible();
  const feed = await page.request.get(old);
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('BEGIN:VCALENDAR');
  await section.getByRole('button', { name: 'Rigenera…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Rigenera link', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Rigenerare il link del calendario?' }),
  ).toHaveCount(0);
  expect((await page.request.get(old)).status()).toBe(404);
  expect((await section.getByLabel('Link del tuo calendario').inputValue()) !== old).toBe(true);
  if (process.env.CALENDAR_SCREENSHOTS) {
    for (const phone of [false, true]) {
      await page.setViewportSize(
        phone ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
      );
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          localStorage.setItem('inkadra.theme', value);
          window.dispatchEvent(new Event('inkadra-theme-change'));
        }, theme);
        await section.scrollIntoViewIfNeeded();
        // Use a visibly fake credential in saved screenshots.
        await section.getByLabel('Link del tuo calendario').evaluate((input: HTMLInputElement) => {
          input.value = 'https://inkadra.example/calendar/example-private-link.ics';
        });
        // No hover or focus state in the saved pictures.
        await page.mouse.move(0, 0);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.screenshot({
          path: `${process.env.CALENDAR_SCREENSHOTS}/${theme}-${phone ? 'phone' : 'desktop'}.png`,
        });
      }
    }
    await expect(section.getByRole('link', { name: 'Apri nel calendario' })).toBeVisible();
  }
});
