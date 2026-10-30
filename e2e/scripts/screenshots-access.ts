import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Screenshots of expiring access and project creation rights (docs/screenshots/0.6-access),
 * desktop and phone, dark and light, on an empty instance with open registration and a
 * fictional project:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-access.ts
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../../docs/screenshots/0.6-access', import.meta.url));
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
  return (await res.json()) as T;
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
  const body = (await res.json()) as { user: { id: string } };
  return {
    id: body.user.id,
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}

/** The end of a local day, as the date picker sends it. */
const endOfDay = (at: Date) =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59).toISOString();

async function seed(cookie: string) {
  const project = await call<{ id: string; rootBoardId: string }>(cookie, 'POST', '/projects', {
    name: 'Last Train',
  });
  for (const title of ['Storyboard', 'Locations'])
    await call(cookie, 'POST', `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind: title === 'Storyboard' ? 'storyboard' : 'board',
      title,
    });
  const anna = await account('Anna Verdi', 'anna@example.com');
  const luca = await account('Luca Neri', 'luca@example.com');
  const sara = await account('Sara Conti', 'sara@example.com');
  const marco = await account('Marco Gallo', 'marco@example.com');
  const now = new Date();
  // Within three days: the label turns to the warning colour.
  await call(cookie, 'PUT', `/projects/${project.id}/members/${anna.id}`, {
    role: 'editor',
    expiresAt: endOfDay(new Date(now.getTime() + 2 * DAY)),
  });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${luca.id}`, {
    role: 'viewer',
    expiresAt: endOfDay(new Date(now.getFullYear(), 11, 15)),
  });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${sara.id}`, { role: 'commenter' });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${marco.id}`, { role: 'owner' });
  // Only some people create projects: Luca is the exception.
  await call(cookie, 'PATCH', '/instance/settings', { membersCanCreateProjects: false });
  await call(cookie, 'PATCH', `/instance/members/${luca.id}`, { canCreateProjects: true });
  return { project, sara };
}

async function context(
  browser: Browser,
  cookie: string,
  theme: 'dark' | 'light',
  phone: boolean,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
    locale: 'en-GB',
    timezoneId: 'Europe/Rome',
    colorScheme: theme,
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
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, file) });
  console.log(file);
}

async function main() {
  const browser = await chromium.launch(
    process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {},
  );
  const cookie = await signIn(base, admin);
  const { project, sara } = await seed(cookie);
  mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light'] as const)
    for (const phone of [false, true]) {
      const device = phone ? 'phone' : 'desktop';
      const ctx = await context(browser, cookie, theme, phone);
      const page = await ctx.newPage();

      await page.goto(`/p/${project.id}`);
      await page.getByRole('button', { name: 'Share' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Share “Last Train”' });
      await dialog.getByText('Luca Neri').waitFor();
      await shot(page, `share-expiry-${device}-${theme}.png`);
      await dialog.getByRole('button', { name: 'End of access for Luca Neri' }).click();
      await dialog.getByText('Access until').waitFor();
      await shot(page, `share-expiry-picker-${device}-${theme}.png`);
      await page.keyboard.press('Escape');

      await page.goto('/settings/team');
      await page.getByText('Members can create projects').waitFor();
      await shot(page, `members-create-projects-${device}-${theme}.png`);
      await ctx.close();

      const member = await context(browser, sara.cookie, theme, phone);
      const off = await member.newPage();
      await off.goto('/projects');
      await off.getByText('only people an administrator allows create projects').waitFor();
      await shot(off, `new-project-off-${device}-${theme}.png`);
      await member.close();
    }
  await browser.close();
  console.log(`Screenshots in ${out}`);
}

await main();
