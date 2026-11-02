// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Members settings on a phone: one tidy card per person. Set E2E_SHOTS to a folder to also
// capture the page on a phone and on a desktop, light and dark.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const stamp = Date.now();
const people = ['Marta Rossi', 'Luca Verdi'].map((name, i) => ({
  name,
  email: `members-layout-${i}-${stamp}@example.com`,
  password: 'correct-horse-battery',
}));

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

test('each member is a tidy card on a phone: the columns line up and Disattiva ends the first line', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `Membri ${stamp}` }),
  });
  const project = (await created.json()) as { id: string };
  for (const person of people) await signUpViaInvite(base, cookie, project.id, 'editor', person);

  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/team');
  const rows = page.locator('.team-table tbody:first-of-type tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(3);

  const cards = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const box = (el: Element | null) => el?.getBoundingClientRect();
      const person = box(tr.querySelector('th'));
      const create = box(tr.querySelector('.team-col--create'));
      const role = box(tr.querySelector('.team-col--role'));
      const action = box(tr.querySelector('.team-col--actions button'));
      return { tr: box(tr), person, role, create, action };
    }),
  );
  const first = cards[0];
  if (!first?.role || !first.create || !first.action) throw new Error('missing cell');
  for (const c of cards) {
    if (!c.tr || !c.person || !c.role || !c.create || !c.action) throw new Error('missing cell');
    // Role and project creation side by side, in the same two columns on every row.
    expect(Math.abs(c.role.left - first.role.left)).toBeLessThan(1);
    expect(Math.abs(c.create.left - first.create.left)).toBeLessThan(1);
    expect(Math.abs(c.create.width - first.create.width)).toBeLessThan(1);
    // Wide enough for "Come l’istanza (sì)", the longest choice.
    expect(c.create.width).toBeGreaterThan(170);
    expect(Math.abs(c.create.top - c.role.top)).toBeLessThan(1);
    // Disattiva at the end of the first line, the same place on every row, inside the card.
    expect(Math.abs(c.action.right - first.action.right)).toBeLessThan(1);
    expect(c.action.right).toBeLessThanOrEqual(c.tr.right);
    expect(c.action.bottom).toBeLessThanOrEqual(c.person.bottom);
    expect(c.action.left).toBeGreaterThanOrEqual(c.person.left);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('.team-tools').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shoot(page, 'members-phone');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.team-table thead')).toBeVisible();
  await shoot(page, 'members-desktop');
});
