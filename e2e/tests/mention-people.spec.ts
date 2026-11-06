import { expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator exists.
const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const person = {
  name: 'Nora Vitali',
  email: 'nora.vitali@example.com',
  password: 'one-more-horse',
};
const shots = process.env.REPORT_SCREENSHOTS;

async function post<T>(page: Page, path: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    },
    { path, body },
  );
}

test('someone who joins while the board is open can be mentioned', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const project = await post<{ id: string; rootBoardId: string }>(page, '/projects', {
    name: 'Menzioni',
  });
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: /^Commenti/ }).click();
  const field = page.locator('.comment-composer textarea').first();

  await field.fill('Guarda @Nora');
  await expect(page.getByText('Nessuno con questo nome')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/mention-none.png` });
  await field.fill('');

  const { invitation } = await post<{ invitation: { url: string } }>(page, '/invitations', {
    kind: 'link',
    projectId: project.id,
    role: 'editor',
  });
  const context = await browser.newContext({ locale: 'it-IT' });
  const other = await context.newPage();
  await other.goto(invitation.url);
  await other.getByLabel('Nome').fill(person.name);
  await other.getByLabel('Email').fill(person.email);
  await other.getByLabel('Password').fill(person.password);
  await other.getByRole('button', { name: 'Crea account' }).click();
  await expect(other).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await context.close();

  await field.fill('Guarda @Nora');
  const option = page.getByRole('option', { name: person.name });
  await expect(option).toBeVisible();
  await option.click();
  await page.getByRole('button', { name: 'Commenta', exact: true }).first().click();
  const mention = page.locator('.comment-mention', { hasText: person.name });
  await expect(mention).toBeVisible();
  const colours = await mention.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ink-accent-soft-fg)';
    el.append(probe);
    const wanted = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(el).color, wanted };
  });
  expect(colours.actual).toBe(colours.wanted);
  if (shots) {
    await page.screenshot({ path: `${shots}/mention-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: `${shots}/mention-light.png` });
  }
});
