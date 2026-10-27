import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';

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

/**
 * "Deploys" a new /sw.js: `change` rewrites the script in the server's copy of the build
 * (playwright.config.ts), then the page checks for an update. Playwright cannot route the
 * browser's own update check of the worker script, so the file itself has to change.
 */
const served = () => join(process.env.E2E_WEB_DIST ?? '', 'sw.js');
let original: string | null = null;

async function deploy(page: Page, change: (sw: string) => string) {
  original ??= readFileSync(served(), 'utf8');
  writeFileSync(served(), change(original));
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
}

test.afterAll(() => {
  if (original !== null) writeFileSync(served(), original);
});

/** A new build: the precache of the next /sw.js no longer has this page's entry script. */
async function newBuild(page: Page) {
  const entry = await page.locator('script[type="module"][src]').getAttribute('src');
  expect(entry).toMatch(/^\/assets\/index-[\w-]+\.js$/);
  return (sw: string) => {
    // The list is a JSON array or, minified, one comma-separated string; it starts with
    // the offline page, so the entry always follows a comma.
    const pattern = `,"?${(entry ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`;
    const next = sw.replace(new RegExp(pattern), '');
    expect(next).not.toContain(entry);
    return `${next}\n// e2e new build ${Date.now()}\n`;
  };
}

const hasWaiting = (page: Page) =>
  page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

test('a new version is offered, and applied only when asked', async ({ page }) => {
  await signIn(page);
  await activeWorker(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const prompt = page.getByRole('status').filter({ hasText: 'Nuova versione disponibile' });

  // A new worker for the build this page already runs: it takes over quietly, no prompt.
  // Compare identity rather than waiting for an edge: activation can finish while
  // deploy() is returning. Acquiring the old controller also arms the check before deploy.
  const previous = await page.evaluateHandle(() => navigator.serviceWorker.controller);
  await deploy(page, (sw) => `${sw}\n// e2e same build ${Date.now()}\n`);
  await page.waitForFunction(
    (controller) => navigator.serviceWorker.controller !== controller,
    previous,
  );
  await previous.dispose();
  expect(await hasWaiting(page)).toBe(false);
  await expect(prompt).toHaveCount(0);

  // A new build, which this page does not run.
  await deploy(page, await newBuild(page));
  await expect(prompt).toBeVisible();
  // Nothing changes until the user asks.
  expect(await hasWaiting(page)).toBe(true);

  const reloaded = page.waitForEvent('load');
  await prompt.getByRole('button', { name: 'Aggiorna' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  expect(await hasWaiting(page)).toBe(false);
});

test('the update waits while the board has changes the server does not have', async ({ page }) => {
  // The collaboration socket goes through a route, so the test can drop it.
  let blocked = false;
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/collab/, (ws) => {
    if (blocked) return void ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  await signIn(page);
  await activeWorker(page);
  await page.reload();
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  const status = page.getByRole('status');
  await expect(status.getByText('Sincronizzato')).toBeVisible();

  await deploy(page, await newBuild(page));
  const prompt = page.getByRole('status').filter({ hasText: 'Nuova versione disponibile' });
  await expect(prompt).toBeVisible();

  // The socket drops: the board may have edits the server has not seen.
  blocked = true;
  for (const ws of sockets) await ws.close();
  await expect(status.getByText(/^Offline/)).toBeVisible();
  let reloads = 0;
  page.on('load', () => {
    reloads += 1;
  });
  await prompt.getByRole('button', { name: 'Aggiorna' }).click();
  const waiting = page
    .getByRole('status')
    .filter({ hasText: 'Si aggiorna quando le modifiche sono salvate e i caricamenti finiti' });
  await expect(waiting).toBeVisible();
  await page.waitForTimeout(500);
  expect(reloads).toBe(0);
  expect(await hasWaiting(page)).toBe(true);

  // Back online the board syncs, and only then the page switches and reloads.
  const reloaded = page.waitForEvent('load');
  blocked = false;
  await reloaded;
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(waiting).toHaveCount(0);
  expect(await hasWaiting(page)).toBe(false);
});
