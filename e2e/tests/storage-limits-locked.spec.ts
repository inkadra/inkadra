// SPDX-License-Identifier: AGPL-3.0-only
// Storage limits set by the server environment (decision 0081): run with STORAGE_LIMIT and
// STORAGE_LIMIT_PER_USER set, after first-run.spec.ts. Skipped otherwise, as in CI.
import { expect, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

test('limits of the server environment are read-only in Settings', async ({ page, baseURL }) => {
  test.skip(!process.env.STORAGE_LIMIT, 'needs STORAGE_LIMIT');
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const refused = await fetch(`${base}/api/v1/instance/storage-limits`, {
    method: 'PATCH',
    headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ total: null }),
  });
  expect(refused.status).toBe(403);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.goto('/settings?section=workspace');
  const card = page.locator('.settings-card', { hasText: 'Limiti di spazio' });
  await expect(card.getByText('Decisi dal gestore del server')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Spazio totale dell’istanza' })).toHaveAttribute(
    'readonly',
    '',
  );
  if (!shots) return;
  for (const size of [
    { width: 1280, height: 860 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await card.scrollIntoViewIfNeeded();
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((v) => {
        localStorage.setItem('inkadra.theme', v);
        window.dispatchEvent(new Event('inkadra-theme-change'));
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${shots}/storage-limits-locked-${size.width < 600 ? 'phone' : 'desktop'}-${theme}.png`,
        fullPage: true,
      });
    }
  }
});
