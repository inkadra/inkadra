import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';
import { addProduction } from '../helpers/views.ts';

// Uses the account created by first-run.spec.ts, and creates it when run on its own.
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

async function signIn(page: Page) {
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  const instance = await (await page.request.get('/api/v1/instance')).json();
  if (instance.setupRequired) {
    const created = await page.request.post('/api/auth/sign-up/email', {
      headers: { origin },
      data: admin,
    });
    expect(created.ok()).toBe(true);
    await page.goto('/');
  } else {
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();
  }
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  return origin;
}

test('home shows today’s shooting day and creates empty projects and boards', async ({ page }) => {
  const origin = await signIn(page);
  const projectName = `Home overview ${Date.now()}`;
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { origin },
      data: { name: projectName },
    })
  ).json();
  // The browser's calendar date, as Home asks for it.
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const day = await page.request.post(`/api/v1/boards/${project.rootBoardId}/schedule`, {
    headers: { origin },
    data: {
      date: today,
      callTime: '18:30',
      wrap: null,
      location: 'Stazione Centrale',
      notes: '',
      blocks: [],
    },
  });
  expect(day.status()).toBe(201);
  // The day moves to the Production board, where Home opens it (decision 0123).
  const production = await addProduction(page.request, origin, project);

  await page.reload();
  const main = page.getByRole('main');
  const todayCard = main.getByRole('region', { name: 'Oggi' });
  await expect(todayCard).toContainText('Stazione Centrale');
  await expect(todayCard).toContainText('18:30');
  await expect(main.getByText(/oggi si gira a Stazione Centrale/)).toBeVisible();
  await expect(main.getByRole('region', { name: 'Progetti recenti' })).toHaveCount(0);
  await expect(
    main
      .getByRole('region', { name: 'Recenti', exact: true })
      .getByRole('link', { name: projectName, exact: true }),
  ).toBeVisible();
  expect(await main.locator('.home__boards > a').count()).toBeLessThanOrEqual(4);

  if (process.env.HOME_SCREENSHOTS) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('inkadra.theme', value);
        window.dispatchEvent(new Event('inkadra-theme-change'));
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({
        path: `/tmp/inkadra-review/home-after-${theme}.png`,
        fullPage: true,
      });
    }
  }

  await expect(main.getByRole('region', { name: 'Inizia da un modello' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nuovo progetto', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuovo progetto' });
  await expect(dialog.locator('[name="projectTemplate"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova board', exact: true }).first().click();
  const board = page.getByRole('dialog', { name: 'Nuova board' });
  await chooseSelect(board.getByLabel('Progetto'), { label: projectName });
  await expect(board.getByRole('radio')).toHaveCount(0);
  await board.getByLabel('Nome della board').fill('Empty board');
  await board.getByRole('button', { name: 'Crea board' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/[0-9a-f-]{36}$`));
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-type="column"]')).toHaveCount(0);
  await page.goto('/');
  await expect(
    main
      .getByRole('region', { name: 'Recenti', exact: true })
      .getByRole('link', { name: /Empty board/ }),
  ).toBeVisible();
  const schedule = `/p/${project.id}/b/${production.id}?view=schedule`;
  await todayCard.locator(`a[href="${schedule}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}\\?view=schedule$`));
  await expect(page.getByRole('region', { name: 'Piano riprese', exact: true })).toBeVisible();
});
