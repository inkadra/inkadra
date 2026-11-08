// SPDX-License-Identifier: AGPL-3.0-only
// The public demo (decision 0084), against the second server playwright.config.ts starts in
// demo mode: "Try the demo", the pill in the header, the warning five minutes before the end,
// the one export, the toast of its limits, "Start over" with its confirmation and the end. Set E2E_SHOTS to a folder to capture
// every state, desktop and phone, dark and light.
import { expect, type Page, test } from '@playwright/test';

const shots = process.env.E2E_SHOTS;
const demo = process.env.E2E_DEMO_URL ?? 'http://localhost:3110';

test.use({ baseURL: demo });

async function theme(page: Page, value: 'dark' | 'light') {
  await page.evaluate((v) => {
    localStorage.setItem('inkadra.theme', v);
    window.dispatchEvent(new Event('inkadra-theme-change'));
  }, value);
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
}

/** Dark and light of what is on screen, at the size given; nothing without E2E_SHOTS. */
async function shoot(page: Page, name: string, sizes: Array<'wide' | 'desktop' | 'phone'>) {
  if (!shots) return;
  for (const size of sizes) {
    await page.setViewportSize(
      size === 'phone'
        ? { width: 390, height: 844 }
        : size === 'wide'
          ? { width: 1600, height: 900 }
          : { width: 1280, height: 860 },
    );
    for (const value of ['dark', 'light'] as const) {
      await theme(page, value);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/demo-${name}-${size}-${value}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await theme(page, 'dark');
}

/** Makes the sandbox end `ms` from now, as far as the page knows. */
async function endIn(page: Page, ms: number) {
  // One moment for every answer, as the server's own expiry.
  const expiresAt = new Date(Date.now() + ms).toISOString();
  await page.unroute('**/api/v1/demo/sandbox');
  await page.route('**/api/v1/demo/sandbox', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({
      response: res,
      json: { ...body, expiresAt },
    });
  });
}

test('the demo: try it, work, get warned, download, see the end', async ({ page }) => {
  test.setTimeout(shots ? 360_000 : 120_000);
  await page.setViewportSize({ width: 1280, height: 860 });

  // The sign-in page is the demo's: one button, the rules above it.
  await page.goto('/login');
  const start = page.getByRole('button', { name: 'Prova la demo' });
  await expect(page.getByRole('heading', { name: 'Prova Inkadra senza account' })).toBeVisible();
  await expect(page.getByText('Dura 1 ora')).toBeVisible();
  await expect(page.getByText(/Fino a 100 MB di file/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Installa sul tuo server' })).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await shoot(page, 'signin', ['desktop', 'phone']);

  // Too many sandboxes open: the button goes off and says why.
  await page.route('**/api/v1/instance', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, demo: { ...body.demo, full: true } } });
  });
  await page.reload();
  await expect(
    page.getByText('Ci sono già 50 demo aperte. Riprova tra qualche minuto.'),
  ).toBeVisible();
  await expect(start).toBeDisabled();
  await shoot(page, 'signin-full', ['desktop', 'phone']);
  await page.unroute('**/api/v1/instance');
  await page.reload();

  // In: the sample project, signed in, with the pill in the header.
  await start.click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]+/);
  const pill = page.getByRole('group', { name: /^Demo: restano/ });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAccessibleName(/^Demo: restano (59|60) min, usati .+ \/ 100 MB$/);
  await expect(page.getByText('Last Train').first()).toBeVisible();
  await shoot(page, 'pill', ['wide', 'desktop', 'phone']);

  // Sharing, members and the instance are not there to reach.
  const shared = await page.evaluate(async () => {
    const res = await fetch('/api/v1/users/search?q=a');
    return res.status;
  });
  expect(shared).toBe(403);

  // Its limits, as a toast, when an upload does not fit.
  await page.route('**/api/v1/uploads', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'storage_full',
            scope: 'user',
            remaining: 120_000,
            limit: 100_000_000,
          }),
        })
      : route.fallback(),
  );
  const url = page.url();
  await page.goto(`${url.split('?')[0]}?view=canvas`);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: 'Sopralluogo_porto.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
  });
  const toast = page.getByText('Nella demo i file arrivano a 10 MB e 100 MB in tutto.');
  await expect(toast).toBeVisible();
  if (shots) {
    await page.setViewportSize({ width: 1280, height: 860 });
    for (const value of ['dark', 'light'] as const) {
      await theme(page, value);
      await page.screenshot({ path: `${shots}/demo-toast-desktop-${value}.png` });
    }
    await theme(page, 'dark');
  }
  await page.unroute('**/api/v1/uploads');

  // Five minutes before the end: orange, a download, and a warning once.
  await endIn(page, 4 * 60 * 1000 + 30_000);
  await page.reload();
  const warning = page.getByRole('dialog', { name: 'Mancano 5 minuti' });
  await expect(warning).toBeVisible();
  await expect(pill).toHaveClass(/demo-pill--warn/);
  await expect(pill.getByText(/^[45] min$/)).toBeVisible();
  if (shots) {
    for (const value of ['dark', 'light'] as const) {
      await theme(page, value);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/demo-warning-desktop-${value}.png` });
    }
    await theme(page, 'dark');
  }
  await warning.getByRole('button', { name: 'Continua' }).click();
  await expect(warning).toBeHidden();
  await page.reload();
  await expect(pill).toHaveClass(/demo-pill--warn/);
  await expect(warning).toBeHidden();
  await shoot(page, 'pill-warn', ['wide', 'desktop', 'phone']);
  if (shots) {
    // The warning on a phone, once more for the picture.
    await page.evaluate(() => localStorage.removeItem('inkadra.demo.warned'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(warning).toBeVisible();
    for (const value of ['dark', 'light'] as const) {
      await theme(page, value);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/demo-warning-phone-${value}.png` });
    }
    await warning.getByRole('button', { name: 'Continua' }).click();
    await page.setViewportSize({ width: 1280, height: 860 });
    await theme(page, 'dark');
  }

  // "Download the project": the one export of the sandbox.
  await pill.getByRole('button', { name: 'Scarica il progetto' }).click();
  const exporting = page.getByRole('dialog', { name: /Esporta/ });
  await exporting.getByRole('button', { name: 'Esporta' }).click();
  await expect(exporting.getByRole('link', { name: 'Scarica' })).toBeVisible({ timeout: 30_000 });
  await expect(exporting.getByRole('button', { name: 'Esporta di nuovo' })).toHaveCount(0);
  const again = await page.evaluate(
    async (projectId) => {
      const res = await fetch(`/api/v1/projects/${projectId}/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return res.status;
    },
    /\/p\/([0-9a-f-]+)/.exec(page.url())?.[1],
  );
  expect(again).toBe(429);
  await page.keyboard.press('Escape');
  await expect(exporting).toBeHidden();

  // "Start over" deletes the sandbox: it asks first, and cancelling keeps everything.
  await pill.getByRole('button', { name: 'Altro: ricomincia, regole della demo' }).click();
  await page.getByRole('menuitem', { name: 'Ricomincia da capo' }).click();
  const restart = page.getByRole('dialog', { name: 'Ricominciare da capo?' });
  await expect(restart).toBeVisible();
  await expect(restart.getByText(/nessuno la può recuperare/)).toBeVisible();
  await shoot(page, 'restart', ['desktop', 'phone']);
  await restart.getByRole('button', { name: 'Annulla' }).click();
  await expect(restart).toBeHidden();
  expect(await page.evaluate(async () => (await fetch('/api/v1/me')).status)).toBe(200);

  // The end: the sandbox goes, and the page says so.
  await endIn(page, 3000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'La tua ora di demo è finita' })).toBeVisible({
    timeout: 15_000,
  });
  const gone = await page.evaluate(async () => (await fetch('/api/v1/me')).status);
  expect(gone).toBe(401);
  await shoot(page, 'ended', ['desktop', 'phone']);

  // A new demo starts from the button again.
  await page.getByRole('button', { name: 'Nuova demo' }).click();
  await expect(start).toBeEnabled();

  // Confirmed, "Start over" ends the new sandbox at once (with its real hour this time).
  await page.unroute('**/api/v1/demo/sandbox');
  await start.click();
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: 'Altro: ricomincia, regole della demo' }).click();
  await page.getByRole('menuitem', { name: 'Ricomincia da capo' }).click();
  await restart.getByRole('button', { name: 'Cancella e ricomincia' }).click();
  await expect(pill).toBeHidden();
  expect(await page.evaluate(async () => (await fetch('/api/v1/me')).status)).toBe(401);
});
