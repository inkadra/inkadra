// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// The settings search: every setting is a result, and so are the people, classification values
// and received reports of the settings pages; opening one scrolls to its row and highlights it.
// Set E2E_SHOTS to a folder to capture each search at 2560, 1280 and on a phone, light and dark.
import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const stamp = Date.now();
const antonino = {
  name: 'Antonino Russo',
  email: `antonino-${stamp}@example.com`,
  password: 'correct-horse-battery',
};
const invited = `antonella.neri-${stamp}@example.com`;
const SIZES = [
  ['desktop-2560', 2560, 1600],
  ['desktop-1280', 1280, 800],
  ['phone-390', 390, 844],
] as const;

async function theme(page: Page, value: string) {
  await page.evaluate((v) => {
    localStorage.setItem('inkadra.theme', v);
    window.dispatchEvent(new Event('inkadra-theme-change'));
  }, value);
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
}

async function signedIn(browser: Browser, base: string, cookie: string) {
  const context = await browser.newContext({ baseURL: base });
  await context.addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  return context.newPage();
}

test('finds settings, people, values and reports, and opens the row of each', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(shots ? 600_000 : 180_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const call = (who: string, method: string, path: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie: who, origin: base, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  await call(cookie, 'PATCH', '/me', { locale: 'it' });
  const project = (await (
    await call(cookie, 'POST', '/projects', { name: `Ricerca ${stamp}` })
  ).json()) as { id: string };
  const antoninoCookie = await signUpViaInvite(base, cookie, project.id, 'editor', antonino);
  await call(antoninoCookie, 'PATCH', '/me', { locale: 'it' });
  // An invitation by email waits even without SMTP: it is listed under the members.
  const invitation = (await (
    await call(cookie, 'POST', '/invitations', { kind: 'email', email: invited })
  ).json()) as { invitation?: { id: string } };
  const original = (await (await call(cookie, 'GET', '/instance/classifications')).json()) as {
    revision: number;
    projectTypes: { id: string; label: string; archived: boolean }[];
  };
  const spot = { id: `spot-${stamp}`, label: 'Spot pubblicitario', archived: false };
  expect(
    (
      await call(cookie, 'PUT', '/instance/classifications', {
        ...original,
        projectTypes: [...original.projectTypes, spot],
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await call(cookie, 'PUT', '/feedback/settings', {
        destination: 'inbox',
        repository: null,
        guests: false,
      })
    ).ok,
  ).toBe(true);
  const report = await call(antoninoCookie, 'POST', '/feedback', {
    requestId: randomUUID(),
    type: 'bug',
    area: 'board',
    title: 'La board si blocca durante il caricamento',
    description: '',
    diagnostics: {},
    attachments: [],
  });
  expect(report.ok).toBe(true);

  const page = await signedIn(browser, base, cookie);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings?section=account');
    const search = page.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
    await expect(search).toBeVisible();

    // «anto»: the person, the invitation and the report; General no longer (it said «quanto»).
    await search.fill('anto');
    const listbox = page.getByRole('listbox', { name: 'Risultati della ricerca' });
    await expect(listbox.getByRole('option', { name: /Antonino Russo/ }).first()).toBeVisible();
    await expect(listbox.getByRole('group', { name: 'Persone' })).toContainText(invited);
    await expect(listbox.getByRole('group', { name: 'Segnalazioni ricevute' })).toContainText(
      'La board si blocca',
    );
    await expect(listbox.getByRole('option', { name: /^Generale/ })).toHaveCount(0);
    await expect(search).toHaveAttribute(
      'aria-activedescendant',
      (await listbox.getByRole('option').first().getAttribute('id')) as string,
    );
    // Enter opens the person's row in Members, scrolled to, highlighted and focused.
    await search.press('Enter');
    await expect(page).toHaveURL(/\/settings\/team\?setting=member%3A/);
    const row = page.locator('[data-setting^="member:"]', { hasText: antonino.email });
    await expect(row).toHaveClass(/settings-found/);
    await expect(row.locator(':focus')).toHaveCount(1);

    // «tema»: the theme setting, named with its page.
    await search.fill('tema');
    await expect(listbox.getByRole('option').first()).toContainText('Tema');
    await expect(listbox.getByRole('option').first()).toContainText('Aspetto e lingua');

    // «spot»: a classification value, with its catalog; it opens inside its catalog.
    await search.fill('spot');
    const value = listbox.getByRole('option', { name: /Spot pubblicitario/ });
    await expect(value).toContainText('Tipi di progetto');
    await value.click();
    await expect(
      page.locator(`[data-setting="classification:projectTypes:${spot.id}"]`),
    ).toHaveClass(/settings-found/);
    await expect(page.locator(':focus')).toHaveValue('Spot pubblicitario');

    await search.fill('zzz nessun risultato');
    await expect(
      page.getByRole('status').filter({ hasText: 'Nessuna impostazione trovata' }),
    ).toBeVisible();

    // A phone has the same search on the settings home, its results across the width.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    const phoneSearch = page.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
    await phoneSearch.fill('anto');
    const option = page.getByRole('option', { name: /Antonino Russo/ }).first();
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.width).toBeGreaterThan(340);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);

    if (shots) {
      for (const [size, width, height] of SIZES) {
        await page.setViewportSize({ width, height });
        for (const value of ['dark', 'light']) {
          for (const [query, name] of [
            ['anto', 'anto'],
            ['tema', 'tema'],
            ['spot', 'spot'],
            ['zzz nessun risultato', 'none'],
          ] as const) {
            await page.goto(width < 600 ? '/settings' : '/settings?section=account');
            await theme(page, value);
            const field = page.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
            await field.fill(query);
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${shots}/${size}-${name}-${value}.png` });
          }
          // The row a result opened, while it is highlighted.
          await page.goto(width < 600 ? '/settings' : '/settings?section=account');
          await theme(page, value);
          const field = page.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
          await field.fill('anto');
          await page
            .getByRole('option', { name: /Antonino Russo/ })
            .first()
            .click();
          await expect(page.locator('.settings-found')).toHaveCount(1);
          await page.waitForTimeout(450);
          await page.screenshot({ path: `${shots}/${size}-opened-member-${value}.png` });
        }
      }
    }
  } finally {
    await page.context().close();
    if (invitation.invitation)
      await call(cookie, 'DELETE', `/invitations/${invitation.invitation.id}`);
    const now = (await (await call(cookie, 'GET', '/instance/classifications')).json()) as {
      revision: number;
    };
    await call(cookie, 'PUT', '/instance/classifications', {
      ...original,
      revision: now.revision,
    });
    await call(cookie, 'PUT', '/feedback/settings', {
      destination: 'off',
      repository: null,
      guests: false,
    });
  }

  // A member finds their own settings, and nobody else: nothing admin-only is even loaded.
  const member = await signedIn(browser, base, antoninoCookie);
  try {
    const asked: string[] = [];
    member.on('request', (request) => asked.push(new URL(request.url()).pathname));
    await member.setViewportSize({ width: 1280, height: 800 });
    await member.goto('/settings?section=account');
    const search = member.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
    await search.fill('giulia');
    await expect(member.getByRole('status')).toContainText('Nessuna impostazione trovata');
    await search.fill('tema');
    await expect(member.getByRole('option').first()).toContainText('Tema');
    await member.waitForTimeout(400);
    expect(asked.filter((path) => /instance\/members|feedback\/reports/.test(path))).toEqual([]);
  } finally {
    await member.context().close();
  }
});
