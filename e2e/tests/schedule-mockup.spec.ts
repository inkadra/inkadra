// SPDX-License-Identifier: AGPL-3.0-only
// The shooting schedule as in its approved mockup, on a Production board that plans the frames
// of two storyboards and a scene (decision 0123): the week fits at 1280 px with its free day
// narrow and the month folded, "N conflitti" names who is double-booked, a version conflict is
// resolved from the week, and a phone lists the day under a strip that shows a whole week. Uses the account created by first-run.spec.ts. Set E2E_SHOTS to a folder to
// capture every state, light and dark.
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';

const shots = process.env.E2E_SHOTS;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

/** Opens a storyboard and draws its scenes, each with a frame of each action. */
async function drawScenes(page: Page, projectId: string, boardId: string, scenes: string[][]) {
  await page.goto(`/p/${projectId}/b/${boardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  for (const [i, actions] of scenes.entries()) {
    await page.getByRole('button', { name: 'Nuova scena', exact: true }).last().click();
    const scene = page.getByRole('region', { name: `Scena ${i + 1}`, exact: true });
    await expect(scene).toBeVisible();
    for (const action of actions) {
      await scene.getByRole('button', { name: 'Nuova inquadratura', exact: true }).last().click();
      const field = page
        .getByRole('complementary', { name: 'Dettagli' })
        .getByLabel('Azione', { exact: true });
      await field.fill(action);
      await field.press('Tab');
      await page.keyboard.press('Escape');
    }
    await expect(scene.locator('.story__tile')).toHaveCount(actions.length);
  }
}

type Block = Record<string, unknown>;
const item = (type: string, title: string, duration: number, extra: Block = {}): Block => ({
  id: crypto.randomUUID(),
  type,
  title,
  start: null,
  duration,
  shotId: null,
  cast: [],
  departments: [],
  ...extra,
});
const PLACE = 'Stazione di Ponte Rotto https://www.openstreetmap.org/#map=17/45.0703/7.5210';

/** A Production board with a week: Monday to Saturday, Tuesday free. */
async function plan(page: Page) {
  await login(page);
  const headers = { origin: new URL(page.url()).origin };
  const project = (await (
    await page.request.post('/api/v1/projects', { headers, data: { name: 'Schedule mockup' } })
  ).json()) as { id: string; rootBoardId: string };
  const storyboard = async (title: string) =>
    (
      (await (
        await page.request.post(`/api/v1/projects/${project.id}/boards`, {
          headers,
          data: { parentBoardId: project.rootBoardId, title, kind: 'storyboard' },
        })
      ).json()) as { id: string }
    ).id;
  const teaser = await storyboard('Teaser');
  const film = await storyboard('Ultimo treno');
  await drawScenes(page, project.id, teaser, [['Il treno entra']]);
  await drawScenes(page, project.id, film, [['Elena scende dal vagone'], []]);
  const made = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers,
    data: { parentBoardId: project.rootBoardId, title: 'Produzione', kind: 'production' },
  });
  expect(made.status()).toBe(201);
  const production = ((await made.json()) as { id: string }).id;
  const url = `/p/${project.id}/b/${production}`;

  // A frame of each storyboard and the scene still without frames, from the queue.
  await page.goto(url);
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await schedule.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  await expect(schedule.locator('.schedule__day')).toHaveCount(1);
  const queue = schedule.locator('.schedule__queue');
  for (const label of ['1A', '1A'])
    await queue
      .locator('.schedule__shot:not(.schedule__shot--scene):not(:disabled)', { hasText: label })
      .first()
      .click();
  await queue.locator('.schedule__shot--scene', { hasText: 'Ancora senza inquadrature' }).click();
  await expect(schedule.locator('.schedule__day .schedule__block')).toHaveCount(3);
  await expect(schedule.locator('.schedule__status')).toHaveText(/Salvato alle/);

  const path = `/api/v1/boards/${production}/schedule`;
  const [first] = (
    (await (await page.request.get(path)).json()) as {
      items: Array<{ id: string; revision: number; blocks: Block[] }>;
    }
  ).items;
  if (!first) throw new Error('no day');
  const [a, b, scene] = first.blocks as [Block, Block, Block];
  const day = (date: string, callTime: string, location: string, blocks: Block[]) => ({
    date,
    callTime,
    wrap: null,
    location,
    notes: '',
    blocks,
  });
  const monday = day('2027-03-01', '07:00', PLACE, [
    item('setup', 'Luci binario e nebbia', 60, { departments: ['Fotografia'] }),
    { ...a, duration: 45, cast: ['Elena'] },
    { ...b, duration: 40, cast: ['Elena'] },
    item('shot', 'Il biglietto stropicciato', 20, { cast: ['Elena'] }),
    item('move', 'Spostamento in sala d’attesa', 20),
    item('break', 'Pranzo', 60),
    { ...scene, duration: 90, cast: ['Elena', 'Marco'] },
    item('note', 'Riserva pioggia: la seconda unità gira gli inserti sul binario 3', 62),
  ]);
  const put = await page.request.put(`${path}/${first.id}`, {
    headers,
    data: { ...monday, revision: first.revision },
  });
  expect(put.ok(), await put.text()).toBe(true);
  for (const next of [
    day('2027-03-03', '18:30', '', [
      item('setup', 'Luci piazzale', 60),
      item('shot', 'La piazza vuota nella nebbia', 60),
      item('break', 'Cena', 45),
      item('shot', 'Marco attraversa la piazza', 120, { cast: ['Marco'] }),
      item('shot', 'Il treno riparte', 60, { cast: ['Elena'] }),
    ]),
    day('2027-03-04', '08:00', PLACE, [
      item('setup', 'Allestimento bar', 60),
      item('shot', 'Il barista accende la macchina', 60, { cast: ['Barista'] }),
      item('shot', 'Elena al telefono', 70, { start: '14:00', cast: ['Elena'] }),
      item('shot', 'Inserti tazzine', 50, { start: '14:00', cast: ['Elena'] }),
      item('shot', 'Esterno bar, pioggia', 60),
    ]),
    day('2027-03-05', '06:30', '', [
      item('setup', 'Trucco e costumi', 30, { cast: ['Elena'] }),
      item('shot', 'Alba sul binario 3', 60, { cast: ['Elena'] }),
      item('move', 'Rientro in base', 30),
      item('note', 'Riserva pioggia', 45),
    ]),
    day('2027-03-06', '09:00', '', [item('shot', 'Titoli di coda sul binario vuoto', 60)]),
  ]) {
    const res = await page.request.post(path, { headers, data: next });
    expect(res.status(), await res.text()).toBe(201);
  }
  return { url, headers, path, mondayId: first.id };
}

async function theme(page: Page, value: 'light' | 'dark') {
  await page.evaluate((v) => {
    localStorage.setItem('inkadra.theme', v);
    window.dispatchEvent(new Event('inkadra-theme-change'));
  }, value);
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await page.waitForTimeout(300);
}

/** Both themes of the page as it is now. */
async function capture(page: Page, name: string) {
  if (!shots) return;
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    await page.screenshot({ path: `${shots}/${name}-${value}.png` });
  }
}

/** The week opens on the first call; the morning blocks of Monday are in view. */
async function openWeek(page: Page, url: string, side: 'open' | 'closed' = 'closed') {
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('inkadra.schedule.side', value), side);
  await page.reload();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await expect(schedule.locator('.schedule__day')).toHaveCount(5);
  await page.mouse.move(0, 0);
  return schedule;
}

const box = async (locator: Locator) => {
  const value = await locator.boundingBox();
  if (!value) throw new Error('not visible');
  return value;
};

async function phone(browser: Browser, url: string) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'it-IT',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await login(page);
  await page.goto(url);
  return { context, page };
}

test('the schedule calendar matches its mockup on the Production board', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { url, headers, path, mondayId } = await plan(page);
  let schedule = await openWeek(page, url);
  const calendar = schedule.locator('.schedule__calendar');

  // Every state is captured before the first check, so a failing run still shows them.
  await capture(page, 'week-1280');
  const thursday = schedule.locator('.schedule__head', { hasText: 'G3' });
  await thursday.getByRole('button', { name: '2 conflitti', exact: true }).click();
  await capture(page, 'week-1280-conflicts');
  await page.keyboard.press('Escape');
  const density = schedule.getByRole('group', { name: 'Densità', exact: true });
  await density.getByRole('radio', { name: 'Comodo', exact: true }).check();
  await capture(page, 'week-1280-comfy');
  await density.getByRole('radio', { name: 'Compatto', exact: true }).check();
  await schedule.getByRole('button', { name: 'Mostra mese e coda', exact: true }).click();
  await capture(page, 'week-1280-open');
  const sceneCard = schedule.locator('.schedule__block--scene .schedule__block-select');
  await page.keyboard.press('Tab');
  await sceneCard.focus();
  await capture(page, 'week-1280-focus');
  await sceneCard.click();
  await expect(page.locator('.schedule__popover')).toBeVisible();
  await capture(page, 'week-1280-popover');
  await page.keyboard.press('Escape');
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  await expect(schedule.locator('.schedule__inspector')).toBeVisible();
  await capture(page, 'day-1280');
  await schedule.getByRole('radio', { name: 'Settimana', exact: true }).check();

  // A colleague saves Monday while it is edited here: the week asks which version to keep.
  const days = (
    (await (await page.request.get(path)).json()) as {
      items: Array<Record<string, unknown> & { id: string }>;
    }
  ).items;
  const saved = days.find((d) => d.id === mondayId);
  if (!saved) throw new Error('no day');
  const { date, callTime, wrap, location, blocks, revision } = saved;
  const elsewhere = await page.request.put(`${path}/${mondayId}`, {
    headers,
    data: { date, callTime, wrap, location, blocks, notes: 'Binario 3 dalle 07:00', revision },
  });
  expect(elsewhere.ok(), await elsewhere.text()).toBe(true);
  await schedule
    .locator('.schedule__day')
    .first()
    .locator('.schedule__block-select')
    .first()
    .focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(schedule.locator('.schedule__status')).toHaveText(/Da risolvere/);
  await page.mouse.move(0, 0);
  await capture(page, 'week-1280-conflict');

  // The phone: the day strip and the day.
  const small = await phone(browser, url);
  const strip = small.page.locator('.schedule__picker');
  await expect(strip.locator('.schedule__picker-day')).toHaveCount(6);
  await capture(small.page, 'phone-390');
  await small.page.locator('.schedule__picker-day').nth(3).click();
  await capture(small.page, 'phone-390-thursday');
  await small.page
    .locator('.schedule__summary-card')
    .getByRole('button', { name: '2 conflitti', exact: true })
    .click();
  await capture(small.page, 'phone-390-conflicts');

  // Checks. The conflict, resolved from the week: "Tieni la mia" saves this version over it.
  const banner = schedule.getByRole('alert').filter({ hasText: 'Tieni la mia' });
  await expect(banner.getByRole('button', { name: 'Vedi la sua versione' })).toBeVisible();
  await banner.getByRole('button', { name: 'Tieni la mia' }).click();
  await expect(schedule.locator('.schedule__status')).toHaveText(/Salvato alle/);
  await expect(banner).toHaveCount(0);

  // In the week: start and title on one line, then cast and duration (option 3); the
  // storyboard is a bar on the left edge, named in the label (option 6).
  const scene = schedule.locator('.schedule__block--scene');
  await expect(scene.locator('.schedule__block-meta')).toHaveText('Elena, Marco · 1h 30');
  await expect(scene.locator('.schedule__block-line .schedule__block-time')).toHaveText(/^\d\d:\d\d$/);
  await expect(scene.locator('.schedule__block-select')).toHaveAttribute(
    'aria-label',
    /, Ultimo treno, \d\d:\d\d – \d\d:\d\d, Scena intera/,
  );
  await expect(scene.locator('.schedule__block-select')).toHaveCSS('border-left-width', '3px');

  // At 1280 px with the column folded and Tuesday narrow, the whole week fits: no sideways
  // scroll and Saturday's column is whole (option 1).
  schedule = await openWeek(page, url);
  await expect(schedule.locator('.schedule__rail')).toBeVisible();
  expect(await calendar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const tuesday = schedule.locator('.schedule__column.is-free');
  expect((await box(tuesday)).width).toBeCloseTo(48, 0);
  await expect(schedule.getByRole('button', { name: /^martedì 2 marzo · Giorno libero/ })).toBeVisible();
  const saturday = schedule.locator('.schedule__day').last();
  expect((await box(saturday)).x + (await box(saturday)).width).toBeLessThanOrEqual(
    (await box(calendar)).x + (await box(calendar)).width + 0.5,
  );
  // Sunrise leaves the week's heading; its dashed line in the grid keeps the time on hover.
  await expect(schedule.locator('.schedule__heads .schedule__sun')).toHaveCount(0);
  await expect(schedule.locator('.schedule__sunline').first()).toHaveAttribute(
    'data-ink-tooltip',
    /^Alba \d\d:\d\d$/,
  );

  // "2 conflitti" names who is double-booked and marks the two blocks; Escape closes it.
  const tag = schedule
    .locator('.schedule__head', { hasText: 'G3' })
    .getByRole('button', { name: '2 conflitti', exact: true });
  await tag.click();
  await expect(tag).toHaveAttribute('aria-expanded', 'true');
  await expect(schedule.locator('.schedule__conflict-note')).toHaveText(
    'Elena è in due blocchi alle 14:00: «Elena al telefono» e «Inserti tazzine».',
  );
  await expect(schedule.locator('.schedule__block.is-hot')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(schedule.locator('.schedule__conflict-note')).toHaveCount(0);
  await expect(tag).toBeFocused();
  await tag.click();
  await tag.click();
  await expect(schedule.locator('.schedule__block.is-hot')).toHaveCount(0);

  // The phone's strip shows the whole week, Saturday included, no chip cut off.
  const edges = await box(strip);
  for (const chip of await strip.locator('.schedule__picker-day').all()) {
    const { x, width } = await box(chip);
    expect(x).toBeGreaterThanOrEqual(edges.x);
    expect(x + width).toBeLessThanOrEqual(edges.x + edges.width);
  }
  // The phone lists the day: call, blocks in time order with cast and duration, wrap; the
  // day's card carries "2 conflitti" (option 8).
  const list = small.page.locator('.schedule__list');
  await expect(list.locator('.schedule__list-mark')).toHaveText([
    'Convocazione 08:00',
    'Fine riprese 15:50',
  ]);
  await expect(list.locator('.schedule__row.has-conflict')).toHaveCount(2);
  await expect(small.page.locator('.schedule__conflict-note')).toContainText('Elena è in due blocchi');
  await list.locator('.schedule__row').first().click();
  await expect(small.page.getByRole('dialog', { name: 'Blocco' })).toBeVisible();
  await expect(small.page.getByRole('button', { name: 'Sposta prima', exact: true })).toBeDisabled();
  await expect(small.page.getByRole('button', { name: 'Sposta dopo', exact: true })).toBeEnabled();
  await small.context.close();
});
