// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Members settings: one row per person, tidy on a phone. Set E2E_SHOTS to a folder to also
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

test('each member is one row: on a phone the controls line up under the name, ⋯ ends the first line', async ({
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
  // One row of the card per person (decision 0124).
  const rows = page.locator('.team-member');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(3);

  const measure = () =>
    rows.evaluateAll((els) =>
      els.map((el) => {
        const box = (node: Element | null) => node?.getBoundingClientRect();
        return {
          row: box(el),
          text: box(el.querySelector('.settings-row__text')),
          role: box(el.querySelector('.team-role')),
          action: box(el.querySelector('.team-col--actions button')),
        };
      }),
    );
  const cards = await measure();
  const first = cards[0];
  if (!first?.role || !first.action) throw new Error('missing control');
  for (const c of cards) {
    if (!c.row || !c.text || !c.role || !c.action) throw new Error('missing control');
    // Role and right to create go under who the person is, lined up on every row.
    expect(c.role.top).toBeGreaterThanOrEqual(c.text.bottom - 1);
    expect(Math.abs(c.role.left - first.role.left)).toBeLessThan(1);
    // The ⋯ menu ends the first line, the same place on every row, inside the card.
    expect(Math.abs(c.action.right - first.action.right)).toBeLessThan(1);
    expect(c.action.right).toBeLessThanOrEqual(c.row.right);
    expect(c.action.top).toBeLessThan(c.text.top + 12);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('.team-tools').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shoot(page, 'members-phone');

  // On a desktop who the person is keeps a readable width; the controls end the row, or drop
  // right-aligned to a line of their own when both do not fit.
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktop = await measure();
  for (const c of desktop) {
    if (!c.row || !c.text || !c.role || !c.action) throw new Error('missing control');
    expect(c.text.width).toBeGreaterThanOrEqual(230);
    expect(c.action.right).toBeLessThanOrEqual(c.row.right);
    expect(Math.abs(c.action.right - (desktop[0]?.action?.right ?? 0))).toBeLessThan(1);
    if (c.role.top < c.text.bottom) expect(c.role.left).toBeGreaterThanOrEqual(c.text.right - 1);
  }
  await shoot(page, 'members-desktop');
});
