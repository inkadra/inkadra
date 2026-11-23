// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Audit F-20: two-factor authentication in the browser. A member turns it on from Settings,
// signs in with an app code and with a backup code (once), and turns it off again.
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const member = {
  name: 'Tea Doppia',
  email: `tea-2fa-${Date.now()}@example.com`,
  password: 'correct-horse-battery',
};

/** RFC 6238 with the authenticator defaults (SHA-1, 6 digits, 30 s), `step` periods from now. */
function totp(base32: string, step = 0): string {
  let bits = '';
  for (const c of base32.replace(/=+$/, '').toUpperCase())
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signInWithPassword(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByText('Scrivi il codice di 6 cifre')).toBeVisible();
}

const home = (page: Page) => expect(page.getByRole('heading', { name: /Tea$/ })).toBeVisible();

test('two-factor authentication: turn on, sign in with a code and a backup code, turn off', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `Two factor ${Date.now()}` }),
  });
  expect(created.ok).toBe(true);
  const project = (await created.json()) as { id: string };
  const cookie = await signUpViaInvite(base, adminCookie, project.id, 'editor', member);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );

  // Turn it on: password, then the key and the backup codes, then a code from the "app".
  await page.goto('/settings?section=account');
  const row = page.locator('[data-setting="account.twoFactor"]');
  await row.getByRole('button', { name: 'Attiva', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Verifica in due passaggi' });
  await dialog.getByLabel('Password attuale').fill(member.password);
  await dialog.getByRole('button', { name: 'Attiva', exact: true }).click();
  const secret = ((await dialog.locator('.settings__secret code').textContent()) ?? '').replace(
    /\s/g,
    '',
  );
  const backupCodes = await dialog.locator('.settings__codes code').allTextContents();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  expect(backupCodes.length).toBeGreaterThan(1);
  await dialog.getByLabel('Codice').fill(totp(secret));
  await dialog.getByRole('button', { name: 'Conferma e attiva' }).click();
  await expect(dialog).toBeHidden();

  // A new sign-in asks for a code: a wrong one is refused, the current one lets the person in.
  await page.context().clearCookies();
  await signInWithPassword(page);
  const valid = [-1, 0, 1].map((step) => totp(secret, step));
  const wrong = ['000000', '111111', '222222', '333333'].find((c) => !valid.includes(c)) ?? '';
  await page.getByLabel('Codice', { exact: true }).fill(wrong);
  await page.getByRole('button', { name: 'Verifica' }).click();
  await expect(page.getByRole('alert')).toHaveText('Codice non valido. Riprova.');
  await page.getByLabel('Codice', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verifica' }).click();
  await home(page);

  // A backup code works once.
  for (const accepted of [true, false]) {
    await page.context().clearCookies();
    await signInWithPassword(page);
    await page.getByRole('button', { name: 'Usa un codice di riserva' }).click();
    await page.getByLabel('Codice di riserva').fill(backupCodes[0] ?? '');
    await page.getByRole('button', { name: 'Verifica' }).click();
    if (accepted) await home(page);
    else await expect(page.getByRole('alert')).toHaveText('Codice non valido. Riprova.');
  }
  await page.getByRole('button', { name: 'Usa l’app di autenticazione' }).click();
  await page.getByLabel('Codice', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verifica' }).click();
  await home(page);

  // Turn it off: the next sign-in needs the password only.
  await page.goto('/settings?section=account');
  await row.getByRole('button', { name: 'Disattiva', exact: true }).click();
  await dialog.getByLabel('Password attuale').fill(member.password);
  await dialog.getByRole('button', { name: 'Disattiva', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await home(page);
});
