import { expect, test } from '@playwright/test';

// Only the account, project and board story are prerequisites of other specs.
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
  await expect(page.getByText('Ancora nessuna board. Creane una.')).toBeVisible();
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

test('the board takes notes and columns, with undo', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Da dove partiamo?' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Da dove partiamo?' })).toBeVisible();
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

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}
