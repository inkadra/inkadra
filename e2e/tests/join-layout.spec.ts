import { expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator exists.
const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const person = { name: 'Rita Sala', email: 'rita.sala@example.com', password: 'yet-another-horse' };
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

test('the invitation cards line up, with the account centred', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const invite = async (name: string) => {
    const project = await post<{ id: string }>(page, '/projects', { name });
    const { invitation } = await post<{ invitation: { url: string } }>(page, '/invitations', {
      kind: 'link',
      projectId: project.id,
      role: 'editor',
    });
    return invitation.url;
  };

  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'light' });
  const other = await context.newPage();
  await other.setViewportSize({ width: 1280, height: 800 });
  await other.goto(await invite('Primo invito'));
  await expect(other.locator('.login__invite')).toBeVisible();
  if (shots) await other.screenshot({ path: `${shots}/join-signed-out.png` });
  await other.getByLabel('Nome').fill(person.name);
  await other.getByLabel('Email').fill(person.email);
  await other.getByLabel('Password').fill(person.password);
  await other.getByRole('button', { name: 'Crea account' }).click();
  await expect(other).toHaveURL(/\/p\/[0-9a-f-]{36}$/);

  await other.goto(await invite('Secondo invito'));
  const cards = other.locator('.login__invite');
  await expect(cards).toHaveCount(2);
  const [invited, account] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(invited?.x).toBe(account?.x);
  expect(invited?.width).toBe(account?.width);
  const avatar = await cards.nth(1).locator('.ink-avatar').boundingBox();
  if (!avatar || !account) throw new Error('no account card');
  expect(Math.abs(avatar.x + avatar.width / 2 - (account.x + account.width / 2))).toBeLessThan(1);
  if (shots) {
    await other.screenshot({ path: `${shots}/join-light.png` });
    await other.emulateMedia({ colorScheme: 'dark' });
    await other.screenshot({ path: `${shots}/join-dark.png` });
    await other.setViewportSize({ width: 390, height: 844 });
    await other.screenshot({ path: `${shots}/join-phone.png` });
  }
  await context.close();
});
