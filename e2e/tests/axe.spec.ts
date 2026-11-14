// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists).
// Automated accessibility check (#853): axe-core on the key pages, in light and dark, fails on
// serious and critical violations. It does not replace the review by hand (AGENTS.md).
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** The serious and critical violations of the page, in both themes, one line each. */
async function violations(page: Page, name: string): Promise<string[]> {
  const found: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    // The theme follows the system unless chosen in Settings; guest pages only follow the system.
    await page.emulateMedia({ colorScheme: theme });
    if (await page.locator('html[data-theme]').count())
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const { violations } = await new AxeBuilder({ page }).analyze();
    for (const v of violations) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      const where = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(', ');
      found.push(`${name} (${theme}): ${v.id} on ${v.nodes.length} node(s): ${where}`);
    }
  }
  return found;
}

test('key pages have no serious or critical axe violations', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL as string;
  const found: string[] = [];

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
  found.push(...(await violations(page, 'sign-in')));

  const cookie = await signIn(base, admin);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  const headers = { cookie, origin: base, 'content-type': 'application/json' };
  const project = (await (
    await fetch(`${base}/api/v1/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `Axe ${Date.now()}` }),
    })
  ).json()) as { id: string; rootBoardId: string };

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  found.push(...(await violations(page, 'home')));

  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  await expect(page.locator('.canvas')).toBeVisible({ timeout: 20_000 });
  found.push(...(await violations(page, 'board')));

  await page.goto('/settings');
  await expect(page.locator('.settings-block').first()).toBeVisible();
  found.push(...(await violations(page, 'settings')));

  const link = await fetch(`${base}/api/v1/boards/${project.rootBoardId}/share-links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'guest_approve', label: 'Regia' }),
  });
  expect(link.ok).toBe(true);
  const { url } = (await link.json()) as { url: string };
  const context = await browser.newContext({ locale: 'it-IT' });
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(guest.getByRole('main').first()).toBeVisible({ timeout: 20_000 });
  found.push(...(await violations(guest, 'guest review')));
  await context.close();

  expect(found).toEqual([]);
});
