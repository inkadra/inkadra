import { expect, type Page, test } from '@playwright/test';

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

test('home shows today’s shooting day and starts from templates', async ({ page }) => {
  const origin = await signIn(page);
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { origin },
      data: { name: 'Home overview' },
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

  await page.reload();
  const main = page.getByRole('main');
  const todayCard = main.getByRole('region', { name: 'Oggi' });
  await expect(todayCard).toContainText('Stazione Centrale');
  await expect(todayCard).toContainText('18:30');
  await expect(main.getByText(/oggi si gira a Stazione Centrale/)).toBeVisible();
  // The project's own board shows as the project, not again among the recent boards.
  await expect(
    main
      .getByRole('region', { name: 'Progetti recenti' })
      .getByRole('link', { name: /Home overview/ }),
  ).toBeVisible();
  await expect(
    main
      .getByRole('region', { name: 'Board recenti' })
      .getByRole('link', { name: /Home overview/ }),
  ).toHaveCount(0);

  // The same templates and form as New project and the guided setup.
  await main
    .getByRole('region', { name: 'Inizia da un modello' })
    .getByRole('button', { name: /Moodboard/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Nuovo progetto' });
  await expect(dialog.getByRole('radio', { name: /Moodboard/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Salta per ora' }).click();
  await expect(dialog).toBeHidden();

  // Board layouts stay in New board.
  await page.getByRole('button', { name: 'Nuova board' }).click();
  const board = page.getByRole('dialog', { name: 'Nuova board' });
  await board.getByLabel('Progetto').selectOption({ label: 'Home overview' });
  await board.getByRole('radio', { name: /Produzione/ }).check();
  await expect(board.getByLabel('Nome della board')).toHaveValue('Produzione');
  await board.getByRole('button', { name: 'Crea board' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/[0-9a-f-]{36}$`));
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-type="column"]')).toHaveCount(3);

  await page.goto('/');
  await expect(
    main.getByRole('region', { name: 'Board recenti' }).getByRole('link', { name: /Produzione/ }),
  ).toBeVisible();
  await todayCard.getByRole('link', { name: 'Apri piano riprese' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}\\?view=schedule$`));
});
