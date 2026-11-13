import { expect, type Page, test } from '@playwright/test';
import { addProduction } from '../helpers/views.ts';

// Decision 0089, phases 2 and 3: a block drawn on empty time and a whole day moved by its
// heading. Uses the account created by first-run.spec.ts, with its own project and storyboard.

const block = (title: string, duration: number) => ({
  id: crypto.randomUUID(),
  type: 'setup',
  title,
  start: null,
  duration,
  shotId: null,
  cast: [],
  departments: [],
});

/** A board with Monday 1 and Wednesday 3 March 2027 planned, opened on its schedule. */
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
  const day = async (date: string, blocks: object[]) => {
    const response = await page.request.post(`/api/v1/boards/${board.id}/schedule`, {
      headers,
      data: { date, callTime: '08:00', wrap: null, location: '', notes: '', blocks },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).id as string;
  };
  const monday = await day('2027-03-01', [block('Luci', 60)]);
  const wednesday = await day('2027-03-03', [block('Trucco', 30)]);
  await page.goto(`/p/${project.id}/b/${board.id}`);
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  const dates = async () =>
    Object.fromEntries(
      (await (await page.request.get(`/api/v1/boards/${board.id}/schedule`)).json()).items.map(
        (item: { id: string; date: string }) => [item.id, item.date],
      ),
    );
  return { schedule, monday, wednesday, dates };
}
const edited = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/schedule/edit') && response.request().method() === 'POST',
  );
const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      /\/schedule\/[^/]+$/.test(response.url()) && response.request().method() === 'PUT',
  );

test('draws a block on empty time and moves or swaps whole days', async ({ page }) => {
  test.setTimeout(90_000);
  const { schedule, monday, wednesday, dates } = await openSchedule(page, 'Schedule phases 2-3');
  const heads = schedule.locator('[data-day-head]');
  await expect(heads).toHaveCount(2);

  // A working week fits at 1280 px with the navigation open: no sideways scroll, every heading whole.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.ink-sidebar')).toBeVisible();
  const calendar = schedule.locator('.schedule__calendar');
  await expect(schedule.locator('.schedule__head')).toHaveCount(5);
  expect(await calendar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const area = await calendar.boundingBox();
  const friday = await schedule.locator('.schedule__head').last().boundingBox();
  if (!area || !friday) throw new Error('no calendar');
  expect(friday.x + friday.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
  await expect(schedule.locator('.schedule__head-number').last()).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Phase 2: drawn from 16:55 to 17:25 after the end of Monday, then a type from the menu.
  const column = schedule.locator('.schedule__day').first();
  await schedule.locator('.schedule__grid').evaluate((el) => {
    el.scrollTop = 16 * 60;
  });
  const box = await column.boundingBox();
  if (!box) throw new Error('no day column');
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 16 * 60 + 55);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 17 * 60 + 25, { steps: 6 });
  await expect(schedule.locator('.schedule__placeholder.is-new')).toBeVisible();
  await expect(
    schedule.locator('.schedule__floating-note, .schedule__annotation-cell > span'),
  ).toHaveText('16:55 – 17:25');
  await page.mouse.up();
  const menu = page.getByRole('menu', { name: 'Tipo del nuovo blocco' });
  await expect(menu).toContainText('Nuovo blocco · 16:55 – 17:25');
  await expect(menu.getByRole('menuitem')).toHaveCount(5);
  const put = saved(page);
  await page.keyboard.press('3');
  await expect(menu).toHaveCount(0);
  const drawn = column.getByRole('button', { name: /^Pausa, 16:55 – 17:25, Pausa, Orario fisso/ });
  await expect(drawn).toBeVisible();
  expect((await put).status()).toBe(200);
  // One undo takes it away, redo brings it back.
  await page.keyboard.press('Control+z');
  await expect(drawn).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(drawn).toBeVisible();
  // Escape on the menu draws nothing.
  await page.mouse.move(x, box.y + 18 * 60);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 18 * 60 + 40, { steps: 4 });
  await page.mouse.up();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(column.locator('.schedule__block')).toHaveCount(2);

  // Phase 3: Monday's heading onto Wednesday's swaps the two days, in one request.
  const mondayHead = schedule.locator(`[data-day-head="${monday}"]`);
  const target = schedule.locator('.schedule__head:has([data-day-drop="2027-03-03"])');
  const from = await mondayHead.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('no headings');
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 30, { steps: 8 });
  await expect(schedule.locator('.schedule__floating-note')).toHaveText('Lun 1 ⇄ Mer 3 · scambio');
  await expect(target).toHaveClass(/is-drop/);
  // The label sits under the target heading, not over its text.
  const note = await schedule.locator('.schedule__floating-note').boundingBox();
  if (!note) throw new Error('no label');
  expect(note.y).toBeGreaterThanOrEqual(to.y + to.height);
  expect(note.x).toBeGreaterThanOrEqual(to.x);
  const swap = edited(page);
  await page.mouse.up();
  expect((await swap).status()).toBe(200);
  await expect(mondayHead).toHaveAttribute('data-day-drop', '2027-03-03');
  await expect(schedule.locator(`[data-day-head="${wednesday}"]`)).toHaveAttribute(
    'data-day-drop',
    '2027-03-01',
  );
  expect(await dates()).toEqual({ [monday]: '2027-03-03', [wednesday]: '2027-03-01' });
  // One undo puts both back, again in one transaction.
  const back = edited(page);
  await page.keyboard.press('Control+z');
  expect((await back).status()).toBe(200);
  expect(await dates()).toEqual({ [monday]: '2027-03-01', [wednesday]: '2027-03-03' });

  // Escape drops the drag; releasing on the heading then neither moves nor opens the day.
  const start = await mondayHead.boundingBox();
  if (!start) throw new Error('no heading');
  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 4 });
  await expect(schedule.locator('.schedule__floating-note')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(schedule.locator('.schedule__floating-note')).toHaveCount(0);
  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.up();
  await expect(schedule.getByRole('radio', { name: 'Settimana', exact: true })).toBeChecked();
  await expect(mondayHead).toHaveAttribute('data-day-drop', '2027-03-01');

  // Nothing waits in the queue, so the month and the queue start folded to their rail; the
  // period's title opens the month as a popover (option 2).
  const rail = schedule.locator('.schedule__rail');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Da pianificare: 0', exact: true })).toBeVisible();
  await expect(schedule.locator('.schedule__month')).toHaveCount(0);
  const title = schedule.getByRole('button', { name: /· Mese$/ });
  await title.click();
  const popover = page.getByRole('dialog', { name: 'Mese', exact: true });
  await expect(popover.locator('.schedule__month-day[data-day-drop="2027-03-10"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  // The rail opens the column; the choice is remembered after a reload, and folds back.
  await rail.getByRole('button', { name: 'Mostra mese e coda', exact: true }).click();
  await expect(rail).toHaveCount(0);
  await page.reload();
  await expect(schedule.locator('.schedule__month')).toBeVisible();
  await schedule.getByRole('button', { name: 'Nascondi mese e coda', exact: true }).click();
  await expect(rail).toBeVisible();
  await page.reload();
  await expect(rail).toBeVisible();
  await rail.getByRole('button', { name: 'Mese', exact: true }).click();
  await expect(schedule.locator('.schedule__month-day[aria-pressed="true"]')).toBeFocused();

  // Onto a free date of the month in the queue: the day moves with its blocks.
  const fifth = schedule.locator('.schedule__month-day[data-day-drop="2027-03-05"]');
  const head = await mondayHead.boundingBox();
  const cell = await fifth.boundingBox();
  if (!head || !cell) throw new Error('no month');
  await page.mouse.move(head.x + 20, head.y + 20);
  await page.mouse.down();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, { steps: 8 });
  await expect(schedule.locator('.schedule__floating-note')).toHaveText('Lun 1 → Ven 5');
  await expect(fifth).toHaveClass(/is-drop/);
  const moved = saved(page);
  await page.mouse.up();
  expect((await moved).status()).toBe(200);
  await expect(mondayHead).toHaveAttribute('data-day-drop', '2027-03-05');
  await expect(
    schedule.locator('.schedule__column[data-day-drop="2027-03-05"] .schedule__block'),
  ).toHaveCount(2);

  // With the keys: Alt+← one date back, from the heading.
  await mondayHead.focus();
  const keyed = saved(page);
  await page.keyboard.press('Alt+ArrowLeft');
  expect((await keyed).status()).toBe(200);
  await expect(mondayHead).toHaveAttribute('data-day-drop', '2027-03-04');
  await expect(mondayHead).toBeFocused();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('moves a day from its sheet with “Move to another date…”, swapping a taken date', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { schedule, monday, wednesday, dates } = await openSchedule(page, 'Schedule phone');
    await schedule.locator('.schedule__summary-card').click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'Giorno 1 di 2' });
    await sheet.getByRole('button', { name: /^Sposta a un.altra data…$/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Sposta / });
    // A phone chooses from the calendar sheet: the field takes no typing there.
    await dialog.getByLabel('Data', { exact: true }).click();
    await dialog.getByRole('gridcell', { name: /^mercoledì 3 marzo 2027/ }).click();
    await expect(dialog).toContainText('i due giorni si scambiano');
    const swap = edited(page);
    await dialog.getByRole('button', { name: 'Scambia', exact: true }).click();
    expect((await swap).status()).toBe(200);
    expect(await dates()).toEqual({ [monday]: '2027-03-03', [wednesday]: '2027-03-01' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The phone follows the day to its new date.
    await expect(schedule.getByRole('button', { name: /^mercoledì 3 marzo/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
