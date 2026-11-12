// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Members settings: one row per person in aligned columns, tidy on a phone. Set E2E_SHOTS to a
// folder to also capture the page and the «Crea progetti» menu, phone and desktop, light and dark.
import { expect, type Page, test } from '@playwright/test';
import { signIn, uploadFile } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const stamp = Date.now();
const KB = 1000;
const person = (name: string, email: string) => ({
  name,
  email,
  password: 'correct-horse-battery',
});
const near = person('Marta Rossi', `members-layout-0-${stamp}@example.com`);
const long = person(
  'Maria Alessandra Lucrezia Bevilacqua-Fontanarossa',
  `maria.alessandra.bevilacqua.fontanarossa-${stamp}@produzioni-esempio.example.com`,
);
const idle = person('Luca Verdi', `members-layout-2-${stamp}@example.com`);

async function shoot(page: Page, name: string) {
  if (!shots) return;
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

test('each member is one row of aligned columns; on a phone the controls wrap under the name', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(shots ? 240_000 : 120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const call = (who: string, method: string, path: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie: who, origin: base, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const project = (await (
    await call(cookie, 'POST', '/projects', { name: `Membri ${stamp}` })
  ).json()) as { id: string };
  const cookies = [];
  for (const person of [near, long, idle])
    cookies.push(await signUpViaInvite(base, cookie, project.id, 'editor', person));
  // 850 KB of a 1 MB limit of her own: past the warning share.
  const nearId = ((await (await call(cookies[0] ?? '', 'GET', '/me')).json()) as { id: string })
    .id;
  expect(
    await uploadFile(base, cookies[0] ?? '', project.id, {
      body: Buffer.alloc(850 * KB, 7),
      name: 'Sopralluogo.mov',
      type: 'application/octet-stream',
    }),
  ).not.toBeNull();
  expect((await call(cookie, 'PATCH', `/instance/members/${nearId}`, { storageLimit: 1000 * KB })).ok).toBe(true);
  // Never active: the session made by signing up is gone.
  await fetch(`${base}/api/auth/sign-out`, {
    method: 'POST',
    headers: { cookie: cookies[2] ?? '', origin: base, 'content-type': 'application/json' },
    body: '{}',
  });
  // A pending invitation to the instance.
  const invite = (await (await call(cookie, 'POST', '/invitations', { kind: 'link' })).json()) as {
    invitation?: { id: string };
  };

  try {
    await page.context().addCookies(
      cookie.split('; ').map((pair) => {
        const index = pair.indexOf('=');
        return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/team');
    // One row of the card per person (decision 0124), under column headers.
    const rows = page.locator('.team-member');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole('columnheader', { name: 'Crea progetti' })).toHaveCount(1);
    const nearRow = rows.filter({ hasText: near.email });
    await expect(nearRow.getByRole('meter')).toHaveClass(/space-meter--warn/);
    await expect(rows.filter({ hasText: idle.email })).toContainText('Nessuna attività registrata');
    // The default is short: the column names the setting.
    await expect(
      nearRow.getByRole('combobox', { name: `Può creare progetti: ${near.name}` }),
    ).toHaveText(/^Predefinito · (sì|no)$/);

    const measure = () =>
      rows.evaluateAll((els) =>
        els.map((el) => {
          const box = (node: Element | null) => node?.getBoundingClientRect();
          return {
            row: box(el),
            text: box(el.querySelector('.settings-row__text')),
            meta: box(el.querySelector('.team-member__meta')),
            role: box(el.querySelector('.team-role')),
            create: box(el.querySelector('.team-col--create')),
            action: box(el.querySelector('.team-col--actions button')),
          };
        }),
      );
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cards = await measure();
    const first = cards[0];
    if (!first?.role || !first.action) throw new Error('missing control');
    for (const c of cards) {
      if (!c.row || !c.text || !c.meta || !c.role || !c.action) throw new Error('missing control');
      // Role and right to create go under who the person is, lined up on every row.
      expect(c.role.top).toBeGreaterThanOrEqual(c.text.bottom - 1);
      expect(Math.abs(c.role.left - first.role.left)).toBeLessThan(1);
      // The ⋯ menu ends the first line, the same place on every row, inside the card.
      expect(Math.abs(c.action.right - first.action.right)).toBeLessThan(1);
      expect(c.action.right).toBeLessThanOrEqual(c.row.right);
      expect(c.action.top).toBeLessThan(c.text.top + 12);
      // Long names and emails end with an ellipsis, never past the ⋯.
      expect(c.meta.right).toBeLessThanOrEqual(c.action.left);
    }
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.locator('.team-tools').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shoot(page, 'members-phone');
    if (shots) {
      await nearRow.getByRole('combobox', { name: `Può creare progetti: ${near.name}` }).click();
      await expect(page.getByRole('option', { name: /Sempre, anche se/ })).toBeVisible();
      await shoot(page, 'members-phone-create-menu');
      await page.keyboard.press('Escape');
    }

    // On a desktop every column lines up on every row and each row is one line.
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktop = await measure();
    const top = desktop[0];
    if (!top?.role || !top.create || !top.action) throw new Error('missing control');
    for (const c of desktop) {
      if (!c.row || !c.text || !c.role || !c.create || !c.action) throw new Error('missing control');
      expect(c.text.width).toBeGreaterThanOrEqual(200);
      expect(Math.abs(c.role.left - top.role.left)).toBeLessThan(1);
      expect(Math.abs(c.create.left - top.create.left)).toBeLessThan(1);
      expect(Math.abs(c.action.right - top.action.right)).toBeLessThan(1);
      expect(c.action.right).toBeLessThanOrEqual(c.row.right);
      expect(c.role.left).toBeGreaterThanOrEqual(c.text.right - 1);
      expect(c.row.height).toBeLessThan(80);
    }
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shoot(page, 'members-desktop');
    if (shots) {
      await nearRow.getByRole('combobox', { name: `Può creare progetti: ${near.name}` }).click();
      await expect(page.getByRole('option', { name: /Sempre, anche se/ })).toBeVisible();
      await shoot(page, 'members-desktop-create-menu');
      await page.keyboard.press('Escape');
    }
  } finally {
    await call(cookie, 'PATCH', `/instance/members/${nearId}`, { storageLimit: null });
    if (invite.invitation) await call(cookie, 'DELETE', `/invitations/${invite.invitation.id}`);
  }
});
