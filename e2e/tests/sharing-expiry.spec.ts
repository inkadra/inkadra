import { type Browser, expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator exists. Works in its own project and puts
// the instance settings back, so the specs after it see what they expect (decision 0041).
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const marta = { name: 'Marta Ferri', email: 'marta@example.com', password: 'treno-di-notte-42' };
const projectName = `Treno di notte ${Date.now()}`;
let projectId = '';
let martaPage: Page;

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // Signed in once the app leaves the login page: API calls below need the session.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  return context.newPage();
}

const origin = (page: Page) => new URL(page.url()).origin;
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('an invitation with an end date gives a membership that ends', async ({ page, browser }) => {
  await signIn(page, admin);
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: origin(page) },
    data: { name: projectName },
  });
  expect(created.status()).toBe(201);
  const project = await created.json();
  projectId = project.id;
  const until = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const invited = await page.request.post('/api/v1/invitations', {
    headers: { origin: origin(page) },
    data: { kind: 'email', email: marta.email, projectId, role: 'editor', accessExpiresAt: until },
  });
  expect(invited.status()).toBe(201);
  const { invitation } = await invited.json();
  expect(invitation.accessExpiresAt).toBe(until);

  martaPage = await newPage(browser);
  await martaPage.goto(invitation.url);
  await martaPage.getByLabel('Nome').fill(marta.name);
  await martaPage.getByLabel('Password').fill(marta.password);
  await martaPage.getByRole('button', { name: 'Crea account' }).click();
  await expect(martaPage.getByRole('status').getByText(/Sincronizzato/)).toBeVisible();
});

test('the owner sees the end date, moves it closer and removes it', async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog', { name: `Condividi “${projectName}”` });
  const row = dialog.locator('.share__row', { hasText: marta.name });
  await expect(row.locator('.share__expiry')).toContainText('Scade il');
  await expect(row.locator('.share__expiry--soon')).toHaveCount(0);
  // Owners never expire: no control on the owner's own row.
  await expect(
    dialog.locator('.share__row', { hasText: 'Giulia Bianchi' }).locator('.share__expiry-btn'),
  ).toHaveCount(0);

  await row.getByRole('button', { name: `Scadenza dell’accesso di ${marta.name}` }).click();
  await row.getByLabel('Accesso fino al').fill(day(1));
  await row.getByRole('button', { name: 'Imposta' }).click();
  // Within three days: the warning colour.
  await expect(row.locator('.share__expiry--soon')).toBeVisible();

  await row.getByRole('button', { name: `Scadenza dell’accesso di ${marta.name}` }).click();
  await row.getByRole('button', { name: 'Togli la scadenza' }).click();
  await expect(row.locator('.share__expiry')).toHaveCount(0);
  // The role did not change.
  await expect(row.getByRole('combobox')).toHaveValue('editor');
});

test('only allowed people create projects; exceptions per person', async ({ page }) => {
  await signIn(page, admin);
  await page.goto('/settings/team');
  const option = page.getByLabel('I membri possono creare progetti');
  await expect(option).toBeChecked();
  await option.uncheck();
  await expect(option).not.toBeChecked();

  await martaPage.goto('/projects');
  const create = martaPage.getByRole('button', { name: 'Nuovo progetto' });
  await expect(create).toBeDisabled();
  await expect(martaPage.getByText(/i progetti li crea solo chi è autorizzato/)).toBeVisible();
  await expect(martaPage.getByRole('button', { name: 'Importa progetto…' })).toHaveCount(0);
  // She still works in the project she was invited to.
  await expect(martaPage.getByRole('heading', { name: projectName })).toBeVisible();
  const refused = await martaPage.request.post('/api/v1/projects', {
    headers: { origin: origin(martaPage) },
    data: { name: 'Prova' },
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.details.reason).toBe('project_creation_disabled');

  await page
    .getByRole('combobox', { name: `Può creare progetti: ${marta.name}` })
    .selectOption('yes');
  await martaPage.reload();
  await expect(martaPage.getByRole('button', { name: 'Nuovo progetto' }).first()).toBeEnabled();

  // Back as it was for the specs that follow.
  await page
    .getByRole('combobox', { name: `Può creare progetti: ${marta.name}` })
    .selectOption('default');
  await option.check();
  await expect(option).toBeChecked();
  await martaPage.context().close();
});
