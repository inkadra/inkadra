// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// QA 2026-11-02 round 2, R2-01: changing the password closes the other sessions, not the board
// open in the tab that changed it.
import { expect, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const editor = {
  name: 'Marta Voce',
  email: `marta-password-${Date.now()}@example.com`,
  password: 'first-horse-battery',
};

test('changing the password keeps the open board connected and editable', async ({
  page,
  baseURL,
}) => {
  // The collaboration server re-checks every sign-in on a timer (30 s): wait for one.
  test.setTimeout(120_000);
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `Password ${Date.now()}` }),
  });
  expect(created.ok).toBe(true);
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const cookie = await signUpViaInvite(base, adminCookie, project.id, 'editor', editor);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );

  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Cambia password' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cambia password' });
  await dialog.getByLabel('Password attuale').fill(editor.password);
  await dialog.getByLabel('Nuova password').fill('second-horse-battery');
  await dialog.getByRole('button', { name: 'Cambia password' }).click();
  await expect(
    dialog.getByText('Password cambiata. Le altre sessioni sono state chiuse.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Fatto' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.settings-window')).toBeHidden();

  // Past the server's next check the board is still this person's: no "Sessione terminata".
  await page.waitForTimeout(35_000);
  await expect(page.getByText('Sessione terminata')).toHaveCount(0);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  const canvas = page.getByTestId('canvas');
  await canvas.dblclick({ position: { x: 300, y: 250 } });
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Ancora collegata');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-type="note"]')).toHaveText('Ancora collegata');
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  // The edit reached the server, not just this tab.
  await page.reload();
  await expect(page.locator('[data-type="note"]')).toHaveText('Ancora collegata');
});
