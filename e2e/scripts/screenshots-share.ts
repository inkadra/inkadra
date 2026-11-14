import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Screenshots of the share dialog, people and guest links (e2e/test-results/screenshots/0.9-share), desktop
 * and phone, dark and light, on an empty instance with a fictional project:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-share.ts
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../test-results/screenshots/0.9-share', import.meta.url));
const PASSWORD = 'correct-horse-battery';
const admin = { name: 'Giulia Bianchi', email: 'giulia@example.com', password: PASSWORD };
const DAY = 86_400_000;

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { cookie, origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function account(name: string, email: string) {
  const headers = { 'content-type': 'application/json', origin: base };
  let res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  if (!res.ok)
    res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  if (!res.ok) throw new Error(`${email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

const endOfDay = (at: Date) =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59).toISOString();

async function seed(cookie: string) {
  await call(cookie, 'PATCH', '/instance/settings', {
    name: 'Inkadra',
    registration: 'open',
    requireAdminTwoFactor: false,
  });
  const project = await call<{ id: string; rootBoardId: string }>(cookie, 'POST', '/projects', {
    name: 'Low Tide',
  });
  for (const title of ['Storyboard', 'Location'])
    await call(cookie, 'POST', `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind: title === 'Storyboard' ? 'storyboard' : 'board',
      title,
    });
  const anna = await account('Anna Verdi', 'anna@example.com');
  const sara = await account('Sara Conti', 'sara@example.com');
  const luca = await account('Luca Neri', 'luca@example.com');
  const now = new Date();
  await call(cookie, 'PUT', `/projects/${project.id}/members/${anna}`, {
    role: 'editor',
    expiresAt: endOfDay(new Date(now.getTime() + 20 * DAY)),
  });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${sara}`, { role: 'commenter' });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${luca}`, { role: 'viewer' });
  await call(cookie, 'POST', '/invitations', {
    kind: 'email',
    email: 'marco@studio.it',
    boardId: project.rootBoardId,
    role: 'editor',
  });
  await call(cookie, 'POST', `/boards/${project.rootBoardId}/share-links`, {
    role: 'guest_comment',
    label: 'Studio Rossi',
    includeSubBoards: true,
    allowDownload: false,
    proofing: true,
    expiresInDays: 7,
  });
  return project;
}

async function context(
  browser: Browser,
  cookie: string,
  theme: 'dark' | 'light',
  phone: boolean,
  locale = 'it-IT',
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
    locale,
    timezoneId: 'Europe/Rome',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await ctx.addCookies(
    cookie.split('; ').map((c) => {
      const [name, ...value] = c.split('=');
      return { name: name as string, value: value.join('='), url: base };
    }),
  );
  return ctx;
}

async function shot(page: Page, file: string) {
  // No leftover hover or focus ring in the picture.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, file) });
  console.log(file);
}

async function openShare(page: Page, projectId: string, share: string) {
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: share }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.share__row').first().waitFor();
  return dialog;
}

async function main() {
  const browser = await chromium.launch(
    process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {},
  );
  const cookie = await signIn(base, admin);
  const project = await seed(cookie);
  mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light'] as const)
    for (const phone of [false, true]) {
      const device = phone ? 'phone' : 'desktop';
      const ctx = await context(browser, cookie, theme, phone);
      const page = await ctx.newPage();
      const dialog = await openShare(page, project.id, 'Condividi');
      await dialog.getByText('Cosa può fare ogni ruolo').click();
      await shot(page, `share-people-${device}-${theme}.png`);
      if (phone) {
        await dialog.getByText('Link d’invito', { exact: true }).scrollIntoViewIfNeeded();
        await shot(page, `share-people-bottom-${device}-${theme}.png`);
      }

      await dialog.getByRole('tab', { name: 'Link per ospiti' }).click();
      await dialog.getByLabel('Per chi è (facoltativo)').fill('Il cliente');
      await dialog.getByRole('radio', { name: 'Può approvare' }).check();
      await dialog.getByRole('switch', { name: 'Selezione foto' }).check();
      await dialog.getByRole('switch', { name: 'Password' }).check();
      await dialog.getByLabel('Password del link').fill('correct-horse');
      const expiry = dialog.getByRole('combobox', { name: 'Scadenza' });
      await expiry.click();
      await page.getByRole('option', { name: '7 giorni' }).click();
      await dialog.getByLabel('Per chi è (facoltativo)').scrollIntoViewIfNeeded();
      await shot(page, `share-guests-${device}-${theme}.png`);
      await dialog.getByText('Link attivi').scrollIntoViewIfNeeded();
      await shot(page, `share-guests-links-${device}-${theme}.png`);
      await ctx.close();
    }

  await browser.close();
  console.log(`Screenshots in ${out}`);
}

await main();
