import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const member = {
  name: 'Paola Rossi',
  email: `paola-backups-${Date.now()}@example.com`,
  password: 'yet-another-horse-battery',
};

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const isBackupSettings = (r: { url(): string; request(): { method(): string } }) =>
  r.url().endsWith('/instance/backups/settings') && r.request().method() === 'PATCH';

test('the administrator backs up now and finds the backup in the history', async ({ page }) => {
  await login(page, admin);
  await page.goto('/settings?section=backups');
  await expect(page.getByRole('button', { name: 'Esegui backup ora' })).toBeEnabled();

  const started = page.waitForResponse(
    (r) => r.url().endsWith('/instance/backups') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Esegui backup ora' }).click();
  const response = await started;
  expect(response.status()).toBe(202);
  const { id } = (await response.json()) as { id: string };
  await expect
    .poll(
      async () => {
        const { items } = (await (await page.request.get('/api/v1/instance/backups')).json()) as {
          items: { id: string; status: string }[];
        };
        return items.find((b) => b.id === id)?.status;
      },
      { timeout: 90_000 },
    )
    .toBe('ready');

  // The page shows it as the newest one: Completed, with a size.
  const item = page.locator('.backup-list__item').first();
  await expect(item.getByText('Completato')).toBeVisible({ timeout: 15_000 });
  await expect(item).toContainText('Manuale');
  await expect(item).toContainText(/\d+(,\d+)?\s?(B|KB|MB|GB)/);
  await expect(item.locator('.backup-list__file')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Esegui backup ora' })).toBeEnabled();
  // The summary row says the same of the last backup.
  await expect(page.getByText('Ultimo backup')).toBeVisible();
});

test('the nightly schedule, its time and the retention persist after a reload', async ({
  page,
}) => {
  await login(page, admin);
  await page.goto('/settings?section=backups');
  const nightly = page.getByRole('checkbox', { name: 'Backup notturno' });
  const time = page.getByLabel('Ora', { exact: true });
  const keep = page.getByLabel('Conserva', { exact: true });
  await expect(time).toBeVisible();
  // Start from off, whatever the default is: the time is off limits until the backup is on.
  if (await nightly.isChecked()) {
    const off = page.waitForResponse(isBackupSettings);
    await nightly.uncheck();
    expect((await off).ok()).toBe(true);
  }
  await expect(time).toBeDisabled();

  let saved = page.waitForResponse(isBackupSettings);
  await nightly.check();
  expect((await saved).ok()).toBe(true);
  await expect(time).toBeEnabled();
  await expect(page.getByText(/^Prossimo:/)).toBeVisible();

  saved = page.waitForResponse(isBackupSettings);
  await time.fill('03:45');
  expect((await saved).ok()).toBe(true);

  saved = page.waitForResponse(isBackupSettings);
  await keep.selectOption('3');
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(nightly).toBeChecked();
  await expect(time).toHaveValue('03:45');
  await expect(keep).toHaveValue('3');
  await expect(page.getByText(/^Prossimo:/)).toContainText('03:45');

  // Off again: the time is locked and the page says backups only start when asked.
  saved = page.waitForResponse(isBackupSettings);
  await nightly.uncheck();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(nightly).not.toBeChecked();
  await expect(time).toBeDisabled();
  await expect(time).toHaveValue('03:45');
  await expect(keep).toHaveValue('3');
  await expect(page.getByText('Disattivato: i backup partono solo quando li avvii tu.')).toBeVisible();
});

test.describe('whoever is not an administrator', () => {
  test.beforeAll(async ({ baseURL }) => {
    const base = baseURL as string;
    const cookie = await signIn(base, admin);
    const res = await fetch(`${base}/api/v1/projects`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ name: 'Progetto per Paola' }),
    });
    const project = (await res.json()) as { id: string };
    await signUpViaInvite(base, cookie, project.id, 'editor', member);
  });

  test('has no Backups section and cannot reach the page', async ({ page }) => {
    await login(page, member);
    await page.goto('/settings');
    const nav = page.getByRole('navigation').filter({ hasText: 'Preferenze' });
    await expect(nav.getByRole('link', { name: 'Preferenze' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Backup', exact: true })).toHaveCount(0);
    await page.goto('/settings?section=backups');
    await expect(page.getByRole('button', { name: 'Esegui backup ora' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Backup notturno' })).toHaveCount(0);

    // And the server refuses them, whatever the page shows.
    for (const [method, path] of [
      ['GET', '/instance/backups'],
      ['POST', '/instance/backups'],
      ['PATCH', '/instance/backups/settings'],
    ] as const) {
      const res = await page.request.fetch(`/api/v1${path}`, {
        method,
        ...(method === 'PATCH' ? { data: { retention: 3 } } : {}),
      });
      expect(res.status(), `${method} ${path}`).toBe(403);
    }
  });
});

test('backup routes are refused with a personal access token, even the administrator’s', async ({
  baseURL,
}) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/me/tokens`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'e2e backups' }),
  });
  expect(created.status).toBe(201);
  const { token } = (await created.json()) as { token: string };
  const bearer = { authorization: `Bearer ${token}`, origin: base };

  // The token itself works, so the refusal below is about the routes, not a bad token.
  expect((await fetch(`${base}/api/v1/projects`, { headers: bearer })).status).toBe(200);
  for (const [method, path] of [
    ['GET', '/instance/backups'],
    ['POST', '/instance/backups'],
    ['PATCH', '/instance/backups/settings'],
  ] as const) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...bearer, 'content-type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ retention: 3 }) } : { body: '{}' }),
    });
    expect(res.status, `${method} ${path}`).toBe(403);
  }
  // The session of the same administrator still gets in.
  const own = await fetch(`${base}/api/v1/instance/backups`, { headers: { cookie } });
  expect(own.status).toBe(200);
});
