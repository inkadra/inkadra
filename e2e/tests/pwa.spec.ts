import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator and the project "Ultima corsa" exist.
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

/** Waits for the service worker to be active and returns its script URL. */
const activeWorker = (page: Page) =>
  page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null);

test('the app is installable: manifest, icons and head links', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()['content-type']).toMatch(/^application\/manifest\+json/);
  const body = await manifest.json();
  expect(body).toMatchObject({
    name: 'Inkadra',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  for (const icon of body.icons as Array<{ src: string; type: string }>) {
    const res = await request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()['content-type'], icon.src).toBe(icon.type);
  }

  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    'content',
    /^#[0-9A-F]{6}$/i,
  );
});

test('the service worker registers, and signing in and boards still work', async ({ page }) => {
  await signIn(page);
  expect(await activeWorker(page)).toMatch(/\/sw\.js$/);
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.some((name) => name.startsWith('inkadra-'))).toBe(true);

  // From here the page is controlled by the worker.
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();

  // The board opens and its collaboration socket connects through a controlled page.
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  // Pages the worker must leave alone keep working under it.
  await page.goto('/diagnostics');
  await expect(page).toHaveURL(/\/diagnostics$/);
  const session = await page.evaluate(async () => (await fetch('/api/auth/get-session')).status);
  expect(session).toBe(200);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = await Promise.all(
      keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)),
    );
    return urls.flat();
  });
  expect(cached.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([]);
  expect(cached.some((url) => url.endsWith('/offline.html'))).toBe(true);

  // Without a network, a navigation shows the offline page instead of the browser's error.
  await page.context().setOffline(true);
  await page.goto('/').catch(() => {});
  await expect(page.getByRole('heading', { name: 'Sei offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();
  // Back online, the page reloads by itself.
  await page.context().setOffline(false);
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
});

test('a new version is offered, and applied only when asked', async ({ page }) => {
  await signIn(page);
  await activeWorker(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();

  // Deploy a "new version": any change to /sw.js makes the browser install it.
  const file = fileURLToPath(new URL('../../apps/web/dist/sw.js', import.meta.url));
  const original = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, `${original}\n// e2e ${Date.now()}\n`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const prompt = page.getByRole('status').filter({ hasText: 'Nuova versione disponibile' });
    await expect(prompt).toBeVisible();
    // Nothing changes until the user asks.
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);

    const reloaded = page.waitForEvent('load');
    await prompt.getByRole('button', { name: 'Aggiorna' }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
    await expect(prompt).toHaveCount(0);
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(false);
  } finally {
    writeFileSync(file, original);
  }
});
