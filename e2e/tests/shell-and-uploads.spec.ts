import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };

test('the theme switches and is remembered', async ({ page }) => {
  await signIn(page);
  const html = page.locator('html');
  const before = (await html.getAttribute('data-theme')) ?? 'dark';
  await page.getByRole('button', { name: /Passa al tema/ }).click();
  const after = before === 'dark' ? 'light' : 'dark';
  await expect(html).toHaveAttribute('data-theme', after);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after);
});

test('sign out, wrong password, sign in again', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Solo su invito')).toBeVisible();
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o password non corrette.');
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
});

test('keys typed while the new note is not focused still land in it', async ({ page }) => {
  await signIn(page);
  await openOwnProject(page);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByTestId('canvas').dblclick({ position: { x: 900, y: 120 } });
  const editor = page.locator('[data-type="note"] [contenteditable="true"]');
  await expect(editor).toBeFocused();
  // The gap between creating the note and its editor taking focus, made deterministic: the
  // letters and then the space each arrive while the editor does not have focus.
  await editor.evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.type('Casting');
  await expect(editor).toBeFocused();
  await editor.evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.type(' comparse');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-type="note"]', { hasText: 'Casting comparse' })).toHaveText(
    'Casting comparse',
  );
});

test('an upload cut by a network outage resumes by itself', async ({ page, context }) => {
  test.setTimeout(120_000);
  // Three tus chunks of 50 MiB, sent slowly enough to cut the network in the middle.
  const file = join(tmpdir(), 'inkadra-e2e-riprese.mov');
  writeFileSync(file, Buffer.alloc(120 * 1024 * 1024, 7));
  await signIn(page);
  await openOwnProject(page);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 15 * 1024 * 1024,
  });

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(file);
  const panel = page.getByRole('region', { name: 'Caricamenti' });
  const row = panel.locator('.uploads__item', { hasText: 'inkadra-e2e-riprese.mov' });
  await expect(row).toContainText(/[1-9]\d?%/, { timeout: 30_000 });

  // Cut the network well into the file, past the first chunk.
  await expect(row).toContainText(/(4[5-9]|[5-9]\d)%/, { timeout: 30_000 });
  await context.setOffline(true);
  await expect(row).toContainText('In attesa di rete', { timeout: 30_000 });
  // Adding the same file again does not start a second upload or a second card.
  await input.setInputFiles(file);
  await expect(panel.locator('.uploads__item')).toHaveCount(1);

  await context.setOffline(false);
  // It resumes where the server stopped, not from the start.
  await expect(row).toContainText(/([4-9]\d|100)%|Fatto/, { timeout: 30_000 });
  await expect(row).toContainText('Fatto', { timeout: 60_000 });
  const cards = page.locator('[data-type="file"]', { hasText: 'inkadra-e2e-riprese.mov' });
  await expect(cards).toHaveCount(1);
  // A finished upload leaves the panel.
  await expect(row).toHaveCount(0, { timeout: 10_000 });
});

test('an upload whose requests fail while online says it is reconnecting', async ({ page }) => {
  test.setTimeout(120_000);
  const file = join(tmpdir(), 'inkadra-e2e-ciak.mov');
  writeFileSync(file, Buffer.alloc(120 * 1024 * 1024, 3));
  await signIn(page);
  await openOwnProject(page);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  // The server drops every chunk for a while, as when a proxy restarts; the browser stays online.
  await page.route('**/api/v1/uploads/**', (route) =>
    route.request().method() === 'PATCH' ? route.abort('connectionreset') : route.continue(),
  );
  await page.locator('input[type="file"]').setInputFiles(file);
  const row = page
    .getByRole('region', { name: 'Caricamenti' })
    .locator('.uploads__item', { hasText: 'inkadra-e2e-ciak.mov' });
  await expect(row).toContainText('Riconnessione…', { timeout: 30_000 });
  await page.unroute('**/api/v1/uploads/**');
  await expect(row).toContainText('Fatto', { timeout: 60_000 });
});

test('search from home suggests shared project tags and preserves multiword selections', async ({
  page,
}) => {
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/shared-boards', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'shared-board',
            projectId: 'shared-project',
            title: 'Shared board',
            kind: 'board',
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/projects/shared-project/tags', (route) =>
    route.fulfill({
      json: { items: [{ tag: 'blue hour', count: 2 }] },
    }),
  );
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/search?*', (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { items: [] } });
  });
  await signIn(page);
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox');
  await input.fill('#');
  await page.getByRole('option', { name: /#blue hour/ }).click();
  await expect.poll(() => queries.length).toBe(1);
  expect(queries[0]!.get('tag')).toBe('blue hour');
  expect(queries[0]!.has('q')).toBe(false);
  await expect(page.getByRole('option')).toHaveCount(0);
  await input.fill('#blue hour station');
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1]!.get('tag')).toBe('blue hour');
  expect(queries[1]!.get('q')).toBe('station');
});

test('real board restores canvas controls after the sidebar Inbox closes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: new URL(page.url()).origin },
    data: { name: 'Inbox layout regression' },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto(`/p/${project.id}?view=canvas`);
  const canvas = page.getByTestId('canvas');
  await expect(canvas).toBeVisible();
  await canvas.dblclick({ position: { x: 350, y: 220 } });
  await page.keyboard.type('Inbox layout regression');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const sidebar = (await page.locator('.ink-sidebar').boundingBox())!;
  const toolbar = page.locator('.toolbar');
  const before = (await toolbar.boundingBox())!;
  const inbox = page.locator('.ink-sidebar').getByRole('button', { name: 'Inbox', exact: true });
  await inbox.click();
  // Keep the real Canvas laid out so ResizeObserver sees sidebar changes while covered.
  await expect
    .poll(() => page.getByTestId('canvas').evaluate((el) => el.clientWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.notifications--fixed')).toBeVisible();
  // A page of the shell: the navigation stays where it was, with nothing opened yet.
  expect(await page.locator('.ink-sidebar').boundingBox()).toEqual(sidebar);
  await expect(inbox).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.inbox-header__title')).toHaveText('Inbox');
  await expect(page.getByText('Scegli una notifica', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.notifications--fixed')).toHaveCount(0);
  const minimap = (await page.locator('.minimap').boundingBox())!;
  const zoom = (await page.getByRole('button', { name: 'Riduci', exact: true }).boundingBox())!;
  const after = (await toolbar.boundingBox())!;
  console.log(JSON.stringify({ sidebar, minimap, zoom, before, after }));
  expect(minimap.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(zoom.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 0);
  await expect(inbox).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await page.screenshot({ path: testInfo.outputPath(`inbox-${theme}.png`) });
  }
});
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

async function openOwnProject(page: import('@playwright/test').Page) {
  // Each regression owns its board, independent of the setup story and other specs.
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: new URL(page.url()).origin },
    data: { name: 'Shell and uploads regression' },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto(`/p/${project.id}?view=canvas`);
}
