// SPDX-License-Identifier: AGPL-3.0-only
// Consecutive blocks of a shooting day never touch: every card leaves the same breathing space
// inside its slot, while the slot still starts on its minute. Uses the account created by
// first-run.spec.ts. Set E2E_SHOTS to a folder to capture the views.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { addProduction } from '../helpers/views.ts';

const shots = process.env.E2E_SHOTS;
const CALL = 8 * 60;
const blocks = [
  ['setup', 'Luci', 30],
  ['shot', 'Ciak breve', 15],
  ['break', 'Pausa', 45],
  ['move', 'Spostamento', 15],
  ['note', 'Nota per la troupe', 30],
] as const;

async function openSchedule(page: Page, name: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const headers = { origin: new URL(page.url()).origin };
  const project = await (
    await page.request.post('/api/v1/projects', { headers, data: { name } })
  ).json();
  // The schedule is the Production board's (decision 0123).
  const board = await addProduction(page.request, headers.origin, project);
  const response = await page.request.post(`/api/v1/boards/${board.id}/schedule`, {
    headers,
    data: {
      date: '2027-03-01',
      callTime: '08:00',
      wrap: null,
      location: '',
      notes: '',
      blocks: blocks.map(([type, title, duration]) => ({
        id: crypto.randomUUID(),
        type,
        title,
        start: null,
        duration,
        shotId: null,
        cast: [],
        departments: [],
      })),
    },
  });
  expect(response.status()).toBe(201);
  await page.goto(`/p/${project.id}/b/${board.id}`);
  return page.getByRole('region', { name: 'Piano riprese', exact: true });
}

/**
 * Each slot starts on its minute; each card sits inside it, `top` px below its minute and
 * `bottom` px above the next one (the approved mockup), so back-to-back cards never touch.
 * A 15-minute card stays inside its slot too.
 */
async function expectSeams(day: Locator, top: number, bottom: number, scale = 1) {
  const slots = day.locator('.schedule__block');
  await expect(slots).toHaveCount(blocks.length);
  const column = (await day.boundingBox())!;
  let minute = CALL;
  let previous = 0;
  for (const [i, [, , duration]] of blocks.entries()) {
    const slot = (await slots.nth(i).boundingBox())!;
    const card = (await slots.nth(i).locator('.schedule__block-select').boundingBox())!;
    expect(slot.y - column.y).toBeCloseTo(minute * scale, 0);
    expect(slot.height).toBeCloseTo(duration * scale, 0);
    expect(card.y - slot.y).toBeCloseTo(top, 0);
    expect(slot.y + slot.height - (card.y + card.height)).toBeCloseTo(bottom, 0);
    if (i > 0) expect(card.y - previous).toBeCloseTo(top + bottom, 0);
    previous = card.y + card.height;
    minute += duration;
  }
}

async function capture(page: Page, day: Locator, name: string) {
  if (!shots) return;
  await page.mouse.move(0, 0);
  await day.locator('.schedule__block').first().scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((v) => {
      localStorage.setItem('inkadra.theme', v);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
    // The seam between the first two blocks, up close.
    const first = (await day.locator('.schedule__block').first().boundingBox())!;
    await page.screenshot({
      path: `${shots}/${name}-${theme}-seam.png`,
      clip: { x: first.x - 8, y: first.y + first.height - 16, width: 120, height: 32 },
    });
  }
}

test('consecutive blocks leave the same space between their cards', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const schedule = await openSchedule(page, 'Schedule block gap');
  const day = schedule.locator('.schedule__day');
  const view = (name: string) => schedule.getByRole('radio', { name, exact: true }).check();
  // Both views are captured before the first check, so a failing run still shows them.
  await capture(page, day, 'week-1280');
  await view('Giorno');
  await capture(page, day, 'day-1280');
  await expectSeams(day, 1, 2);
  await view('Settimana');
  await expectSeams(day, 1, 2);

  // "Comodo" (option 5): 1.6 px a minute, the same seams; the choice stays in this browser.
  const density = schedule.getByRole('group', { name: 'Densità', exact: true });
  await expect(density.getByRole('radio', { name: 'Compatto', exact: true })).toBeChecked();
  await density.getByRole('radio', { name: 'Comodo', exact: true }).check();
  await expectSeams(day, 1, 2, 1.6);
  const hour = schedule.locator('.schedule__grid .schedule__hour', { hasText: /^09:00$/ });
  const canvas = (await schedule.locator('.schedule__canvas').boundingBox())!;
  expect((await hour.boundingBox())!.y + (await hour.boundingBox())!.height / 2 - canvas.y).toBeCloseTo(
    9 * 60 * 1.6,
    0,
  );
  await capture(page, day, 'week-1280-comfy');
  await page.reload();
  await expect(density.getByRole('radio', { name: 'Comodo', exact: true })).toBeChecked();
  await expectSeams(day, 1, 2, 1.6);
  await view('Giorno');
  await expectSeams(day, 1, 2, 1.6);
  await density.getByRole('radio', { name: 'Compatto', exact: true }).check();
  await expectSeams(day, 1, 2);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('lists the day in time order, rows apart, with no density choice', async ({ page }) => {
    test.setTimeout(60_000);
    const schedule = await openSchedule(page, 'Schedule block gap phone');
    const rows = schedule.locator('.schedule__list .schedule__row');
    await expect(rows.locator('.schedule__row-title')).toHaveText(blocks.map(([, title]) => title));
    await expect(schedule.getByRole('group', { name: 'Densità', exact: true })).toHaveCount(0);
    let previous = 0;
    for (const row of await rows.all()) {
      const { y, height } = (await row.boundingBox())!;
      expect(height).toBeGreaterThanOrEqual(44);
      if (previous) expect(y - previous).toBeCloseTo(4, 0);
      previous = y + height;
    }
  });
});
