import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Screenshots of the activity log and the verified backups (#806, #794) in
 * e2e/test-results/screenshots/audit, desktop and phone, dark and light, on an empty instance
 * that lets people sign up (`REGISTRATION=open`):
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-audit.ts
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../test-results/screenshots/audit', import.meta.url));
const admin = { name: 'Giulia Bianchi', email: 'giulia@example.com', password: 'correct-horse-battery' };
const member = { name: 'Marco Rossi', email: 'marco@example.com', password: 'correct-horse-battery' };

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { cookie, origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function seed(cookie: string) {
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(member),
  });
  const { user } = (await signUp.json()) as { user: { id: string } };
  await call(cookie, 'PATCH', `/instance/members/${user.id}`, { canCreateProjects: false });
  await call(cookie, 'PATCH', `/instance/members/${user.id}`, { role: 'admin' });
  const project = await call<{ id: string; rootBoardId: string }>(cookie, 'POST', '/projects', {
    name: 'Last Train',
  });
  await call(cookie, 'PUT', `/projects/${project.id}/members/${user.id}`, { role: 'editor' });
  await call(cookie, 'POST', `/boards/${project.rootBoardId}/share-links`, {
    role: 'viewer',
    label: 'Client review',
  });
  await call(cookie, 'POST', '/invitations', { kind: 'email', email: 'sara@example.com' });
  await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: member.email, password: 'not-the-password' }),
  });
  await call(cookie, 'POST', '/instance/backups');
  const deadline = Date.now() + 120_000;
  while (
    (await call<{ items: Array<{ status: string }> }>(cookie, 'GET', '/instance/backups')).items.some(
      (b) => b.status === 'running',
    )
  ) {
    if (Date.now() > deadline) throw new Error('Backup timed out');
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  const browser = await chromium.launch(
    process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {},
  );
  const cookie = await signIn(base, admin);
  await seed(cookie);
  mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light'] as const)
    for (const phone of [false, true]) {
      const device = phone ? 'phone' : 'desktop';
      const ctx = await browser.newContext({
        baseURL: base,
        viewport: phone ? { width: 390, height: 1100 } : { width: 1280, height: 900 },
        deviceScaleFactor: 2,
        isMobile: phone,
        hasTouch: phone,
        locale: 'en-US',
        timezoneId: 'Europe/Rome',
        colorScheme: theme,
      });
      await ctx.addCookies(
        cookie.split('; ').map((c) => {
          const [name, ...value] = c.split('=');
          return { name: name as string, value: value.join('='), url: base };
        }),
      );
      const page = await ctx.newPage();
      for (const [section, wait] of [
        ['audit', 'Sign-in failed'],
        ['backups', 'verified'],
      ] as const) {
        await page.goto(`/settings?section=${section}`);
        await page.getByText(wait).first().waitFor();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(600);
        const file = `${section}-${device}-${theme}.png`;
        await page.screenshot({ path: join(out, file) });
        console.log(file);
      }
      await ctx.close();
    }
  await browser.close();
}

await main();
