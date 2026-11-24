// SPDX-License-Identifier: AGPL-3.0-only
// Audit F-20: password reset in the browser, with the mail the server really sends. Runs in the
// auth-providers project (E2E_AUTH_PROVIDERS=1: a local SMTP sink), after first-run.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';
import { linkInMail } from './support/mail.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const member = {
  name: 'Rita Reset',
  email: `rita-reset-${Date.now()}@example.com`,
  password: 'correct-horse-battery',
};
const newPassword = 'a-brand-new-password';

/** With mail on, the sign-in page offers a link by email first. */
async function passwordForm(page: Page, password?: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usa la password' }).click();
  await page.getByLabel('Email').fill(member.email);
  if (password !== undefined) await page.getByLabel('Password').fill(password);
}

test('password reset: the emailed link sets a new password once', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_AUTH_PROVIDERS !== '1', 'needs E2E_AUTH_PROVIDERS=1');
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `Password reset ${Date.now()}` }),
  });
  expect(created.ok).toBe(true);
  const project = (await created.json()) as { id: string };
  const oldSession = await signUpViaInvite(base, adminCookie, project.id, 'editor', member);

  // Ask for the link from the sign-in page.
  await passwordForm(page);
  await page.getByRole('button', { name: 'Password dimenticata?' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Se l’indirizzo ha un account, riceverà un link per scegliere una nuova password.',
  );
  const link = await linkInMail(member.email, '/api/auth/reset-password/');
  expect(new URL(link).origin).toBe(base);

  // The link leads to the form; the token leaves the address bar once read.
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('Nuova password').fill(newPassword);
  await page.getByRole('button', { name: 'Salva la password' }).click();
  await expect(page.getByRole('status')).toHaveText('Password cambiata. Ora puoi accedere.');
  // The sessions from before the reset are signed out.
  const before = await fetch(`${base}/api/v1/me`, { headers: { cookie: oldSession } });
  expect(before.status).toBe(401);

  // The old password is refused, the new one works.
  await passwordForm(page, member.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o password non corrette.');
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Rita$/ })).toBeVisible();
  const me = (await (await page.request.get('/api/v1/me')).json()) as { email: string };
  expect(me.email).toBe(member.email);

  // A used link is refused, signed in or not.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(
    page.getByText('Il link non è valido o è scaduto. Chiedine un altro dalla pagina di accesso.'),
  ).toBeVisible();
  await expect(page.getByLabel('Nuova password')).toHaveCount(0);
});
