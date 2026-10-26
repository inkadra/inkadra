import { expect, test } from '@playwright/test';

// Uses the account created by first-run.spec.ts, with its own project and storyboard.
test('a shooting day persists a dropped storyboard shot after reload', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: new URL(page.url()).origin },
    data: { name: 'Schedule persistence' },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  const boardResponse = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin: new URL(page.url()).origin },
    data: { parentBoardId: project.rootBoardId, title: 'Schedule storyboard', kind: 'storyboard' },
  });
  expect(boardResponse.status()).toBe(201);
  const board = await boardResponse.json();
  await page.goto(`/p/${project.id}/b/${board.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova scena' }).first().click();
  await page.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  await page
    .getByRole('complementary', { name: 'Dettagli' })
    .getByLabel('Azione', { exact: true })
    .fill('Schedule shot');
  await page.getByRole('tab', { name: 'Piano riprese', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  const day = page.locator('.schedule__day');
  await expect(day).toHaveCount(1);
  await day.getByLabel('Data', { exact: true }).fill('2026-11-02');
  await day.getByLabel('Convocazione', { exact: true }).fill('09:00');
  await day.getByLabel('Location', { exact: true }).fill('Stazione');
  await day.getByRole('button', { name: 'Salva giorno', exact: true }).click();
  await expect(day.getByRole('button', { name: 'Salva giorno', exact: true })).toBeEnabled();
  const shot = page.locator('.schedule__queue .film-shell__card').first();
  await expect(shot).toContainText('1A');
  await shot.dragTo(day);
  await expect(day.locator('.schedule__block')).toContainText('1A');
  await expect(page.locator('.schedule__queue .film-shell__card')).toHaveCount(0);
  await page.reload();
  await expect(day.getByLabel('Data', { exact: true })).toHaveValue('2026-11-02');
  await expect(day.getByLabel('Location', { exact: true })).toHaveValue('Stazione');
  await expect(day.locator('.schedule__block')).toContainText('1A');
  await expect(day.locator('.schedule__block strong')).toHaveText('09:00 – 09:30');
  await expect(page.locator('.schedule .film-shell__badge')).toHaveCount(0);
});
