import { expect, test } from '@playwright/test';

// Uses the account created by first-run.spec.ts, with its own project and storyboard.
test('a shooting day saves itself, takes a dropped shot at a time and undoes', async ({ page }) => {
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
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await schedule.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  // The day view has the day panel beside the calendar.
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  const inspector = schedule.getByRole('complementary', { name: 'Dettagli del giorno di riprese' });
  const saved = schedule.locator('.schedule__status');
  await inspector.getByLabel('Data', { exact: true }).fill('2026-11-02');
  await inspector.getByLabel('Convocazione', { exact: true }).fill('09:00');
  await inspector.getByLabel('Location', { exact: true }).fill('Stazione');
  // No save button: it saves on its own.
  await expect(saved).toHaveText(/Salvato alle/);
  await expect(schedule.getByRole('heading', { level: 2 }).first()).toContainText('2 novembre');
  const day = schedule.locator('.schedule__day');
  await expect(day).toHaveCount(1);
  const shot = schedule.locator('.schedule__queue .schedule__shot').first();
  await expect(shot).toContainText('1A');
  await shot.dragTo(day, { targetPosition: { x: 60, y: 9 * 60 + 40 } });
  const block = day.locator('.schedule__block');
  await expect(block).toContainText('1A');
  await expect(schedule.locator('.schedule__queue .schedule__shot')).toHaveCount(0);
  await expect(saved).toHaveText(/Salvato alle/);

  // The bottom edge makes it longer, by five-minute steps.
  const box = await block.boundingBox();
  if (!box) throw new Error('block not drawn');
  await block.hover();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 12, { steps: 4 });
  await page.mouse.up();
  await expect(block.locator('.schedule__block-time')).toHaveText('09:00 – 09:45');
  // Ctrl+Z puts the length back, and that is saved too.
  await schedule.locator('.schedule__block-select').focus();
  await page.keyboard.press('Control+z');
  // Half an hour is a low block: one line, its start; the name still says both times.
  await expect(block.locator('.schedule__block-time')).toHaveText('09:00');
  await expect(block.locator('.schedule__block-select')).toHaveAttribute(
    'aria-label',
    /09:00 – 09:30/,
  );
  await expect(saved).toHaveText(/Salvato alle/);

  await page.reload();
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  await expect(inspector.getByLabel('Data', { exact: true })).toHaveValue('2026-11-02');
  await expect(inspector.getByLabel('Location', { exact: true })).toHaveValue('Stazione');
  await expect(day.locator('.schedule__block')).toContainText('1A');
  await expect(day.locator('.schedule__block-select')).toHaveAttribute(
    'aria-label',
    /^1A.*09:00 – 09:30/,
  );
  await expect(page.locator('.schedule .film-shell__badge')).toHaveCount(0);
});
