import { expect, test } from '@playwright/test';
import { addProduction } from '../helpers/views.ts';

// Uses the account created by first-run.spec.ts, with its own project and storyboard.
test('a shooting day saves itself, takes a dropped shot at a time and undoes', async ({ page }) => {
  test.setTimeout(60_000);
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
  // Its frames are scheduled on the Production board (decision 0123).
  const production = await addProduction(page.request, new URL(page.url()).origin, project);
  await page.goto(`/p/${project.id}/b/${board.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova scena' }).first().click();
  await page.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  await page
    .getByRole('complementary', { name: 'Dettagli' })
    .getByLabel('Azione', { exact: true })
    .fill('Schedule shot');
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.goto(`/p/${project.id}/b/${production.id}`);
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
  const shot = schedule
    .locator('.schedule__queue .schedule__shot:not(.schedule__shot--scene)')
    .first();
  await expect(shot).toContainText('1A');
  await shot.dragTo(day, { targetPosition: { x: 60, y: 9 * 60 + 40 } });
  const block = day.locator('.schedule__block');
  await expect(block).toContainText('1A');
  await expect(
    schedule.locator('.schedule__queue .schedule__shot:not(.schedule__shot--scene)'),
  ).toHaveCount(0);
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
  // Free text durations validate locally and normalize on blur.
  await schedule.getByRole('radio', { name: 'Settimana', exact: true }).check();
  await schedule.locator('.schedule__block-select').click();
  const duration = page.getByLabel('Durata', { exact: true });
  await duration.fill('1h 30');
  await duration.blur();
  await expect(duration).toHaveValue('1h 30');
  await duration.fill('0');
  await expect(duration).toHaveAttribute('aria-invalid', 'true');
  await duration.fill('1h');
  await duration.blur();
  await expect(duration).toHaveValue('1h');
  await page.keyboard.press('Escape');
  await expect(saved).toHaveText(/Salvato alle/);
  // Alt-drag stays full width until release; a free date is created atomically.
  const moving = schedule.locator('.schedule__block-select');
  const initial = await moving.boundingBox();
  const free = schedule.locator('.schedule__column.is-free').first();
  const empty = await free.boundingBox();
  if (!initial || !empty) throw new Error('calendar columns missing');
  await page.mouse.move(initial.x + 30, initial.y + 10);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(initial.x + 30, initial.y + 20, { steps: 4 });
  expect(
    Math.abs(
      (await schedule.locator('.schedule__block.is-dragging').boundingBox())!.width - initial.width,
    ),
  ).toBeLessThan(1);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await page.mouse.move(empty.x + empty.width / 2, initial.y + 20, { steps: 6 });
  const moved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/schedule/edit') && response.request().method() === 'POST',
  );
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect((await moved).status()).toBe(200);
  await expect(schedule.locator('.schedule__day')).toHaveCount(2);
  await expect(schedule.locator('.schedule__block')).toHaveCount(1);
  const undone = page.waitForResponse(
    (response) =>
      response.url().endsWith('/schedule/edit') && response.request().method() === 'POST',
  );
  await page.keyboard.press('Control+z');
  expect((await undone).status()).toBe(200);
  await expect(schedule.locator('.schedule__day')).toHaveCount(1);
  await expect(schedule.locator('.schedule__block')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(schedule.locator('.schedule__day')).toHaveCount(2);
  await expect(saved).toHaveText(/Salvato alle/);
  // Returning the shot to the queue also exercises dropping a queued shot on a free date.
  await schedule.locator('.schedule__block-select').focus();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(
    schedule.locator('.schedule__queue .schedule__shot:not(.schedule__shot--scene)'),
  ).toHaveCount(1);
  await expect(saved).toHaveText(/Salvato alle/);
  const queued = schedule.locator('.schedule__queue .schedule__shot:not(.schedule__shot--scene)');
  const freeDate = schedule.locator('.schedule__column.is-free').first();
  await queued.dragTo(freeDate, { targetPosition: { x: 60, y: 9 * 60 + 40 } });
  await expect(schedule.locator('.schedule__day')).toHaveCount(3);
  await expect(schedule.locator('.schedule__block')).toHaveCount(1);
  await expect(saved).toHaveText(/Salvato alle/);
  await page.keyboard.press('Control+z');
  await expect(schedule.locator('.schedule__day')).toHaveCount(2);
  await expect(
    schedule.locator('.schedule__queue .schedule__shot:not(.schedule__shot--scene)'),
  ).toHaveCount(1);
  await expect(saved).toHaveText(/Salvato alle/);
  // A wrapped overnight notice fits entirely in its column; phone notices have their own row.
  const night = await page.request.post(`/api/v1/boards/${production.id}/schedule`, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      date: '2026-11-05',
      callTime: '18:30',
      wrap: '04:00',
      location: 'Night',
      notes: '',
      blocks: [
        {
          id: crypto.randomUUID(),
          type: 'setup',
          title: 'Night setup',
          start: null,
          duration: 360,
          shotId: null,
          cast: [],
          departments: [],
        },
        {
          id: crypto.randomUUID(),
          type: 'note',
          title: 'After midnight',
          start: null,
          duration: 90,
          shotId: null,
          cast: [],
          departments: [],
        },
        {
          id: crypto.randomUUID(),
          type: 'note',
          title: 'Before wrap',
          start: null,
          duration: 120,
          shotId: null,
          cast: [],
          departments: [],
        },
      ],
    },
  });
  expect(night.status()).toBe(201);
  await page.reload();
  const pill = schedule.locator('.schedule__more').first();
  await expect(pill).toBeVisible();
  const pillRect = await pill.boundingBox();
  const gridRect = await schedule.locator('.schedule__grid').boundingBox();
  if (!pillRect || !gridRect) throw new Error('overflow notice missing');
  expect(pillRect.y + pillRect.height).toBeLessThanOrEqual(gridRect.y + gridRect.height);
  await page.setViewportSize({ width: 390, height: 844 });
  await schedule.getByRole('button', { name: /^giovedì 5 novembre/ }).click();
  const notice = schedule.locator('.schedule__edge-notices');
  await expect(notice).toBeVisible();
  const noticeRect = await notice.boundingBox();
  const footerRect = await schedule.locator('.schedule__phone-foot').boundingBox();
  if (!noticeRect || !footerRect) throw new Error('phone overflow notice missing');
  expect(noticeRect.y + noticeRect.height).toBeLessThanOrEqual(footerRect.y);
});
