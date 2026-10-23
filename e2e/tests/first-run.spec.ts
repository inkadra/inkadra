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

  // A double click starts a note; what is typed right away lands in it.
  await canvas.dblclick({ position: { x: 300, y: 250 } });
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
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}
