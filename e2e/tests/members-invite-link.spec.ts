// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Settings › Members: an invite link for someone whose email nobody knows signs up one account,
// then refuses a second. Set E2E_SHOTS to a folder to also capture the dialog, phone and desktop,
// light and dark, with the token masked.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const stamp = Date.now();

async function shoot(page: Page, name: string) {
  if (!shots) return;
  // The link grants an account: never in a picture.
  await page.locator('input[data-feedback-secret]').evaluateAll((els) =>
    els.forEach((el) => {
      const input = el as HTMLInputElement;
      input.value = input.value.replace(/\/join\/.*/, '/join/••••••••••••');
    }),
  );
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      localStorage.setItem('inkadra.theme', value);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
}

test('a members invite link signs up one person, then refuses a second', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(shots ? 240_000 : 120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.setViewportSize({ width: shots ? 390 : 1280, height: shots ? 844 : 900 });
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Invita membri' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invita membri' });
  await expect(dialog.getByText('Non hai l’email? Crea un link')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Scadenza del link' })).toHaveText('2 giorni');
  await shoot(page, 'invite-link-phone-form');
  if (shots) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await shoot(page, 'invite-link-desktop-form');
  }
  await dialog.getByRole('button', { name: 'Crea un link d’invito' }).click();
  await expect(dialog.getByText(/vale una volta sola, per una persona, e scade il/)).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Link di invito' });
  await expect(field).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  const url = await field.inputValue();
  await expect(dialog.getByRole('button', { name: 'Copia link' })).toBeVisible();
  if (shots) {
    await shoot(page, 'invite-link-desktop-created');
    await page.setViewportSize({ width: 390, height: 844 });
    await shoot(page, 'invite-link-phone-created');
  }
  await dialog.getByRole('button', { name: 'Fatto' }).click();
  // Pending until used, with what it allows.
  const row = page.locator('.team-pending').filter({ hasText: 'Vale una volta' }).last();
  await expect(row).toBeVisible();
  if (shots) {
    await row.scrollIntoViewIfNeeded();
    await shoot(page, 'invite-link-phone-pending');
    await page.setViewportSize({ width: 1280, height: 900 });
    await row.scrollIntoViewIfNeeded();
    await shoot(page, 'invite-link-desktop-pending');
  }

  const first = await (await browser.newContext({ locale: 'it-IT' })).newPage();
  await first.goto(url);
  await expect(first.locator('.login__invite')).toBeVisible();
  await first.getByLabel('Nome').fill('Nadia Senzamail');
  await first.getByLabel('Email').fill(`invite-link-${stamp}@example.com`);
  await first.getByLabel('Password').fill('correct-horse-battery');
  await first.getByRole('button', { name: 'Crea account' }).click();
  await expect(first).not.toHaveURL(/\/join\//);
  await first.context().close();

  // The same link makes no second account.
  const second = await (await browser.newContext({ locale: 'it-IT' })).newPage();
  await second.goto(url);
  await expect(second.getByText('Questo invito è già stato usato.')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Crea account' })).toHaveCount(0);
  await second.context().close();

  // Used: gone from the pending invitations.
  const pending = (await (
    await fetch(`${base}/api/v1/invitations`, { headers: { cookie, origin: base } })
  ).json()) as { items: { url: string | null }[] };
  expect(pending.items.some((i) => i.url === url)).toBe(false);
});
