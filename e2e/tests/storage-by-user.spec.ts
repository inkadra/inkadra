import { expect, test } from '@playwright/test';
import { signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts: the administrator exists.
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.REPORT_SCREENSHOTS;

test('an administrator sees the storage of each user', async ({ page, baseURL }) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Spazio' }),
  });
  const project = (await res.json()) as { id: string };
  const body = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const id = await uploadFile(base, cookie, project.id, {
    body,
    name: 'pixel.png',
    type: 'image/png',
  });
  if (!id) throw new Error('upload failed');
  await waitForAssets(base, cookie, [id]);

  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.goto('/settings?section=workspace');
  // One usage card with a choice of breakdown (0124).
  await page.locator('.storage-chart').getByRole('radio', { name: 'Per persona' }).click();
  const card = page.locator('.storage-chart', { hasText: 'Utilizzo per utente' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('rowheader', { name: /Giulia/ })).toBeVisible();
  if (shots) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/storage-dark.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: `${shots}/storage-light.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${shots}/storage-phone.png`, fullPage: true });
  }
});
