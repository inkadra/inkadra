import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// One story, in order: the instance starts empty, so these steps share state.
test.describe.configure({ mode: 'serial' });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

test('first visit asks to create the administrator', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Crea l’account amministratore')).toBeVisible();
  await page.getByLabel('Nome').fill(admin.name);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Crea account e accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await expect(page.getByText('Nessun progetto')).toBeVisible();
});

test('the shell creates a project and lists it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Nuovo progetto' }).first().click();
  await page.getByLabel('Nome del progetto').fill('Ultima corsa');
  await page.getByRole('button', { name: 'Crea progetto' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  const nav = page.getByRole('complementary', { name: 'Navigazione' });
  await expect(nav.getByRole('link', { name: 'Ultima corsa' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

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

test('the board takes notes and columns, with undo', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.getByText('Board vuota')).toBeVisible();
  const canvas = page.getByTestId('canvas');

  // A double click starts a note and puts the cursor in it.
  await canvas.dblclick({ position: { x: 300, y: 250 } });
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Sopralluogo al porto');
  await page.keyboard.press('Escape');
  const note = page.locator('[data-type="note"]');
  await expect(note).toHaveText('Sopralluogo al porto');

  // Shortcuts add a column and select everything; Delete removes both, undo brings them back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  // A new column asks for its title first.
  await page.keyboard.type('Location');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-type="column"]')).toContainText('Location');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-el]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(note).toHaveText('Sopralluogo al porto');
  await expect(page.locator('[data-type="column"]')).toHaveCount(1);

  // The board is the shared document: a reload shows the same content.
  await page.reload();
  await expect(page.locator('[data-type="note"]')).toHaveText('Sopralluogo al porto');

  // A board inside the board: open it, then go back through the breadcrumb.
  await page.keyboard.press('b');
  const sub = page.locator('[data-type="board"]');
  await expect(sub).toHaveCount(1);
  await page.keyboard.type('Sopralluoghi');
  // Escape ends editing and keeps the name, as in every card field.
  await page.keyboard.press('Escape');
  await expect(sub).toContainText('Sopralluoghi');
  await sub.dblclick();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}\/b\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Board vuota')).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Ultima corsa' }).click();
  await expect(page.locator('[data-type="board"]')).toContainText('Sopralluoghi');

  const renames: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/api\/v1\/(boards|projects)\//.test(request.url())) {
      renames.push(request.postData() ?? '');
    }
  });
  // Leaving a card rename unchanged sends no request.
  await sub.click();
  await page.keyboard.press('F2');
  await expect(sub.locator('input')).toBeFocused();
  await sub.locator('input').press('Escape');
  await expect(sub.locator('input')).toHaveCount(0);
  await expect(sub).toContainText('Sopralluoghi');
  expect(renames).toHaveLength(0);

  // Rename via F2 shortcut on single selected board card.
  await sub.click();
  await page.keyboard.press('F2');
  const cardInput = sub.locator('input');
  await expect(cardInput).toBeVisible();
  await cardInput.fill('Location Scout');
  await page.keyboard.press('Enter');
  await expect(sub).toContainText('Location Scout');
  expect(renames).toHaveLength(1);

  // Rename via context menu on board card.
  await sub.click({ button: 'right' });
  const renameMenu = page.getByRole('menuitem', { name: 'Rinomina' });
  await expect(renameMenu).toBeVisible();
  await renameMenu.click();
  await expect(sub.locator('input')).toBeVisible();
  await sub.locator('input').fill('Sopralluoghi');
  await page.keyboard.press('Enter');
  await expect(sub).toContainText('Sopralluoghi');

  // Rename via breadcrumb click-to-rename.
  await sub.dblclick();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}\/b\/[0-9a-f-]{36}$/);
  const crumbButton = page.getByRole('banner').getByRole('button', { name: 'Sopralluoghi' });
  await expect(crumbButton).toBeVisible();

  // Escape cancels without saving.
  await crumbButton.click();
  const crumbInput = page.getByRole('banner').getByRole('textbox', { name: 'Titolo della board' });
  await expect(crumbInput).toBeVisible();
  await crumbInput.fill('Annullato');
  await crumbInput.press('Escape');
  await expect(crumbInput).not.toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Sopralluoghi' }),
  ).toBeVisible();

  // Enter saves the new title.
  await page.getByRole('banner').getByRole('button', { name: 'Sopralluoghi' }).click();
  const crumbInputSave = page
    .getByRole('banner')
    .getByRole('textbox', { name: 'Titolo della board' });
  await crumbInputSave.fill('Scouting Finale');
  await crumbInputSave.press('Enter');
  await expect(crumbInputSave).not.toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Scouting Finale' }),
  ).toBeVisible();

  expect(renames).toHaveLength(3);
  // Blur saves once; unchanged/empty values make no requests.
  const banner = page.getByRole('banner');
  for (const value of ['', 'Scouting Finale', 'Scouting Blur']) {
    await banner.getByRole('button', { name: 'Scouting Finale', exact: true }).click();
    const field = banner.getByRole('textbox', { name: 'Titolo della board' });
    await field.fill(value);
    await field.press('Tab');
    await expect(field).toHaveCount(0);
  }
  await expect(banner.getByRole('button', { name: 'Scouting Blur', exact: true })).toBeVisible();
  expect(renames).toHaveLength(4);
  await banner.getByRole('button', { name: 'Scouting Blur', exact: true }).click();
  await banner.getByRole('textbox', { name: 'Titolo della board' }).fill('Scouting Finale');
  await banner.getByRole('textbox', { name: 'Titolo della board' }).press('Enter');
  await expect(banner.getByRole('button', { name: 'Scouting Finale', exact: true })).toBeVisible();
  expect(renames).toHaveLength(5);

  // Root crumb is a navigation link (not an inline rename button) while viewing a sub-board.
  await expect(page.getByRole('banner').getByRole('button', { name: 'Ultima corsa' })).toHaveCount(
    0,
  );
  await page.getByRole('banner').getByRole('link', { name: 'Ultima corsa' }).click();

  // Live title update reflects on parent board card.
  await expect(page.locator('[data-type="board"]')).toContainText('Scouting Finale');

  // Rename project via root crumb click-to-rename.
  const rootCrumb = page.getByRole('banner').getByRole('button', { name: 'Ultima corsa' });
  await expect(rootCrumb).toBeVisible();

  // Escape cancels without saving.
  await rootCrumb.click();
  const rootInput = page.getByRole('banner').getByRole('textbox', { name: 'Nome del progetto' });
  await expect(rootInput).toBeVisible();
  await rootInput.fill('Annullato');
  await rootInput.press('Escape');
  await expect(rootInput).not.toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Ultima corsa' }),
  ).toBeVisible();

  // Enter saves the new project name.
  await page.getByRole('banner').getByRole('button', { name: 'Ultima corsa' }).click();
  const rootInputSave = page
    .getByRole('banner')
    .getByRole('textbox', { name: 'Nome del progetto' });
  await rootInputSave.fill('Ultima corsa - Rinomina');
  await rootInputSave.press('Enter');
  await expect(rootInputSave).not.toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Ultima corsa - Rinomina' }),
  ).toBeVisible();

  // Live title update reflects in the sidebar.
  await expect(
    page.locator('.ink-sidebar').getByRole('link', { name: 'Ultima corsa - Rinomina' }),
  ).toBeVisible();

  // Sub-board breadcrumb root link also reflects the updated project name.
  await sub.dblclick();
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Ultima corsa - Rinomina' }),
  ).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Ultima corsa - Rinomina' }).click();

  // Rename back to original name so later tests continue cleanly.
  await page.getByRole('banner').getByRole('button', { name: 'Ultima corsa - Rinomina' }).click();
  const rootInputRestore = page
    .getByRole('banner')
    .getByRole('textbox', { name: 'Nome del progetto' });
  await rootInputRestore.fill('Ultima corsa');
  await rootInputRestore.press('Enter');
  await expect(rootInputRestore).not.toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Ultima corsa' }),
  ).toBeVisible();
});

test('keys typed while the new note is not focused still land in it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByTestId('canvas').dblclick({ position: { x: 900, y: 120 } });
  const editor = page.locator('[data-type="note"] [contenteditable="true"]');
  await expect(editor).toBeFocused();
  // The gap between creating the note and its editor taking focus, made deterministic.
  await editor.evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.type('Casting comparse');
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
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
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
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
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

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

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
