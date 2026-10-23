import { type Browser, expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator and the project "Ultima corsa" exist.
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const guest = {
  name: 'Paolo Bassi',
  email: 'paolo@example.com',
  password: 'another-horse-battery',
};
let inviteUrl = '';

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function openProject(page: Page) {
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText(/Sincronizzato|Sola lettura/)).toBeVisible();
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  return context.newPage();
}

test('the owner makes an invitation link for the project', async ({ page }) => {
  await signIn(page, admin);
  await openProject(page);
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog', { name: 'Condividi “Ultima corsa”' });
  await expect(dialog.getByText('Giulia Bianchi (tu)')).toBeVisible();
  await expect(dialog.getByText('Chi inviti qui entra in tutto il progetto.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Crea link' }).click();
  const link = dialog.getByRole('textbox', { name: 'Link d’invito' });
  await expect(link).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  inviteUrl = await link.inputValue();
  await expect(dialog.getByText(/Lettore · scade il/)).toBeVisible();
});

test('a new person signs up from the link, even with invite-only registration', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(inviteUrl);
  await expect(page.getByText('Giulia Bianchi ti invita nel progetto Ultima corsa')).toBeVisible();
  await expect(page.getByText('come Lettore')).toBeVisible();
  await page.getByLabel('Nome').fill(guest.name);
  await page.getByLabel('Email').fill(guest.email);
  await page.getByLabel('Password').fill(guest.password);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').getByText('Sola lettura')).toBeVisible();
  await page.context().close();
});

test('people on the board see each other, and a viewer cannot edit', async ({ page, browser }) => {
  await signIn(page, admin);
  await openProject(page);
  const other = await newPage(browser);
  await signIn(other, guest);
  await openProject(other);

  // Each sees the other in the header; the viewer is marked read-only.
  await expect(page.locator(`.peers__one[title="${guest.name} (sola lettura)"]`)).toBeVisible();
  await expect(other.locator('.peers__one[title="Giulia Bianchi"]')).toBeVisible();

  // The owner's pointer shows up on the viewer's board with a name tag.
  const canvas = page.getByTestId('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.move(box.x + 420, box.y + 320);
  await expect(other.locator('.peer-cursor', { hasText: 'Giulia Bianchi' })).toBeVisible();

  // A double click makes no note for a viewer, and the owner's notes arrive live.
  const notes = other.locator('[data-type="note"]');
  const before = await notes.count();
  await other.getByTestId('canvas').dblclick({ position: { x: 600, y: 500 } });
  await expect(notes).toHaveCount(before);
  await canvas.dblclick({ position: { x: 600, y: 520 } });
  await page.keyboard.type('Scaletta riprese');
  await page.keyboard.press('Escape');
  await expect(other.locator('[data-type="note"]', { hasText: 'Scaletta riprese' })).toBeVisible();

  // The viewer sees who has access but cannot change it.
  await other.getByRole('button', { name: 'Condividi' }).click();
  const dialog = other.getByRole('dialog');
  await expect(dialog.getByText('Solo editor e proprietari possono invitare')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Invita' })).toHaveCount(0);
  await other.context().close();
});

test('the owner raises the role, and the person can edit', async ({ page, browser }) => {
  await signIn(page, admin);
  await openProject(page);
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: `Ruolo di ${guest.name}` }).selectOption('editor');
  await expect(dialog.getByRole('combobox', { name: `Ruolo di ${guest.name}` })).toHaveValue(
    'editor',
  );

  const other = await newPage(browser);
  await signIn(other, guest);
  await openProject(other);
  await expect(other.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await other.getByTestId('canvas').dblclick({ position: { x: 300, y: 600 } });
  await other.keyboard.type('Nota di Paolo');
  await other.keyboard.press('Escape');
  await expect(page.locator('[data-type="note"]', { hasText: 'Nota di Paolo' })).toBeVisible();
  await other.context().close();
});

test('account settings make a personal token shown once', async ({ page }) => {
  await signIn(page, guest);
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await page.getByLabel('Nome del token').fill('Script di backup');
  await page.getByRole('button', { name: 'Crea token' }).click();
  await expect(page.getByText('Token “Script di backup” creato.')).toBeVisible();
  await expect(page.locator('.settings__token')).toHaveText(/^ink_/);
  await page.getByRole('button', { name: 'Fatto' }).click();
  await expect(page.getByText('Script di backup')).toBeVisible();
  await expect(page.getByText('mai usato')).toBeVisible();
});
