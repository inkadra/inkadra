// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists).
// Settings (#677): no two controls of a page share role and accessible name, on every page at
// 1280px and on the home list and Members on a 390px phone. Radios are named by their group and
// links that share a name share their destination, so only the controls below are compared.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const ROLES = new Set([
  'button',
  'combobox',
  'checkbox',
  'switch',
  'textbox',
  'searchbox',
  'slider',
]);
// Sessions of the same browser, address and minute look the same on screen too: their "Sign
// out" buttons are named after the row, which is enough.
const SAME_SESSION = /^button "Esci .+ Ultima attività/;

async function duplicates(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: Array<{ ignored: boolean; role?: { value: string }; name?: { value: string } }>;
  };
  await cdp.detach();
  const seen = new Map<string, number>();
  for (const n of nodes) {
    if (n.ignored || !ROLES.has(n.role?.value ?? '')) continue;
    const key = `${n.role?.value} "${n.name?.value ?? ''}"`;
    if (SAME_SESSION.test(key)) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

test('settings controls have distinct accessible names', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  // Two members, so the Members list has more than one row.
  const project = (await (
    await fetch(`${base}/api/v1/projects`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ name: `A11y ${Date.now()}` }),
    })
  ).json()) as { id: string };
  for (const i of [0, 1])
    await signUpViaInvite(base, cookie, project.id, 'editor', {
      name: `Persona ${i}`,
      email: `settings-a11y-${i}-${Date.now()}@example.com`,
      password: 'correct-horse-battery',
    });
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );

  // Desktop: every page, moving through the navigation without reloading the app.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/settings?section=account');
  const nav = page.locator('.settings-nav__item');
  await expect(nav.first()).toBeVisible();
  const count = await nav.count();
  expect(count).toBeGreaterThanOrEqual(16);
  const found: string[] = [];
  for (let i = 0; i < count; i++) {
    const item = nav.nth(i);
    const title = (await item.locator('.settings-nav__label').textContent()) ?? '';
    await item.click();
    await expect(page.locator('.settings-window__head h2')).toHaveText(title);
    await page.waitForLoadState('networkidle').catch(() => {});
    for (const d of await duplicates(page)) found.push(`${title}: ${d}`);
  }

  // Phone: the home list and Members.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await expect(page.locator('.settings-home')).toBeVisible();
  for (const d of await duplicates(page)) found.push(`home (phone): ${d}`);
  await page.goto('/settings/team');
  await expect(page.locator('.settings-window__head h2')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  for (const d of await duplicates(page)) found.push(`Members (phone): ${d}`);

  expect(found).toEqual([]);
});
