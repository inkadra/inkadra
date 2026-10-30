import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';

/**
 * Screenshots of project export, import and instance backups (docs/screenshots/0.5-backup),
 * desktop and phone, dark and light, on an empty instance with a fictional project:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-backup.ts
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../../docs/screenshots/0.5-backup', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { cookie, origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Night stills drawn here, so the screenshots carry no third-party images. */
async function stills(browser: Browser): Promise<Buffer[]> {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const skies = [
    ['#0B1A2A', '#1E3A4C', '#E07A3F'],
    ['#06121C', '#12324A', '#2D6F86'],
    ['#2B2A4C', '#B66E7A', '#F6C98A'],
  ];
  const result: Buffer[] = [];
  for (const [a, b, c] of skies) {
    await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg"
      width="800" height="450"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/></linearGradient></defs>
      <rect width="800" height="450" fill="url(#s)"/>
      <rect y="300" width="800" height="150" fill="#05080B"/>
      <rect x="0" y="310" width="800" height="6" fill="#F2A65A" opacity=".8"/></svg></body>`);
    result.push(await page.screenshot({ type: 'jpeg', quality: 85 }));
  }
  await page.close();
  return result;
}

async function seed(browser: Browser, cookie: string) {
  const project = await call<{ id: string; rootBoardId: string }>(cookie, 'POST', '/projects', {
    name: 'Last Train',
  });
  for (const title of ['Storyboard', 'Locations'])
    await call(cookie, 'POST', `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind: title === 'Storyboard' ? 'storyboard' : 'board',
      title,
    });
  const ids: string[] = [];
  for (const [i, body] of (await stills(browser)).entries()) {
    const id = await uploadFile(base, cookie, project.id, {
      body,
      name: `platform-${i + 1}.jpg`,
      type: 'image/jpeg',
    });
    if (!id) throw new Error('This instance does not take uploads');
    ids.push(id);
  }
  await waitForAssets(base, cookie, ids);
  const doc = new Y.Doc();
  initBoardDoc(doc, project.rootBoardId);
  doc.transact(() => {
    for (const [i, assetId] of ids.entries())
      createElement(doc, 'image', { x: i * 340, y: 0 }, { assetId, w: 320 }, opts);
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  // A ready export, so Export project… opens on its result, and two backups for the history.
  const exported = await call<{ id: string }>(cookie, 'POST', `/projects/${project.id}/exports`);
  await until(
    () => call<{ status: string }>(cookie, 'GET', `/transfers/${exported.id}`),
    (t) => t.status === 'ready' || t.status === 'failed',
  );
  const archive = Buffer.from(
    await (
      await fetch(`${base}/api/v1/transfers/${exported.id}/download`, { headers: { cookie } })
    ).arrayBuffer(),
  );
  for (let i = 0; i < 2; i++) {
    await call(cookie, 'POST', '/instance/backups');
    await until(
      () => call<{ items: Array<{ status: string }> }>(cookie, 'GET', '/instance/backups'),
      (b) => b.items.every((x) => x.status !== 'running'),
    );
  }
  return { archive };
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
  return ctx;
}

async function shot(page: Page, file: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, file) });
  console.log(file);
}

async function openProjectMenu(page: Page) {
  await page.goto('/projects');
  await page.locator('.project-card__options').first().click();
  await page.getByRole('menuitem', { name: 'Export project…' }).waitFor();
}

async function main() {
  const browser = await chromium.launch(
    process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {},
  );
  const cookie = await signIn(base, account);
  const { archive } = await seed(browser, cookie);
  mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light'] as const)
    for (const phone of [false, true]) {
      const device = phone ? 'phone' : 'desktop';
      const ctx = await context(browser, cookie, theme, phone);
      const page = await ctx.newPage();

      await openProjectMenu(page);
      if (!phone) await shot(page, `export-menu-${device}-${theme}.png`);
      await page.getByRole('menuitem', { name: 'Export project…' }).click();
      // The first card may be a copy imported by an earlier pass: export it here.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      const start = page.getByRole('button', { name: 'Export', exact: true });
      if (await start.isVisible().catch(() => false)) await start.click();
      await page.getByText('The archive is ready').waitFor({ timeout: 120_000 });
      await shot(page, `export-ready-${device}-${theme}.png`);
      await page.keyboard.press('Escape');

      await page.goto('/projects');
      await page.getByRole('button', { name: 'Import project…' }).click();
      await page.getByText('Drop the archive here').waitFor();
      await shot(page, `import-pick-${device}-${theme}.png`);
      await page.locator('.transfer-drop__input').setInputFiles({
        name: 'Last Train 2026-11-02.inkadra.zip',
        mimeType: 'application/zip',
        buffer: archive,
      });
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await page.getByRole('link', { name: 'Open project' }).waitFor({ timeout: 120_000 });
      await shot(page, `import-done-${device}-${theme}.png`);
      await page.keyboard.press('Escape');

      await page.goto('/settings?section=backups');
      await page.getByText('Last backup').waitFor();
      await shot(page, `backups-${device}-${theme}.png`);
      await ctx.close();
    }
  await browser.close();
  console.log(`Screenshots in ${out}`);
}

await main();
