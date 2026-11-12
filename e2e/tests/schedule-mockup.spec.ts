// SPDX-License-Identifier: AGPL-3.0-only
// The shooting schedule as in its approved mockup, on a Production board that plans the frames
// of two storyboards and a scene (decision 0123): the hours column stays in view while the days
// scroll sideways, a version conflict is resolved from the week, and a phone's day strip shows a
// whole week. Uses the account created by first-run.spec.ts. Set E2E_SHOTS to a folder to
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
async function openWeek(page: Page, url: string) {
  await page.goto(url);
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
  await calendar.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await capture(page, 'week-1280-scrolled');
  await calendar.evaluate((el) => {
    el.scrollLeft = 0;
  });
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
  const queue = schedule.locator('.schedule__queue');
  if (shots) await queue.screenshot({ path: `${shots}/queue-1280-light.png` });

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
  await schedule.locator('.schedule__day').first().locator('.schedule__block-select').first().focus();
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

  // Checks. The conflict, resolved from the week: "Tieni la mia" saves this version over it.
  const banner = schedule.getByRole('alert').filter({ hasText: 'Tieni la mia' });
  await expect(banner.getByRole('button', { name: 'Vedi la sua versione' })).toBeVisible();
  await banner.getByRole('button', { name: 'Tieni la mia' }).click();
  await expect(schedule.locator('.schedule__status')).toHaveText(/Salvato alle/);
  await expect(banner).toHaveCount(0);

  // In the week, a block of 60 px or more shows its cast and duration.
  await expect(schedule.locator('.schedule__block--scene .schedule__block-meta')).toHaveText(
    'Elena, Marco · 1h 30',
  );

  // The days scroll sideways at 1280 px; the hours column stays at the left edge.
  schedule = await openWeek(page, url);
  const scrolled = await calendar.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
  const gutter = schedule.locator('.schedule__grid .schedule__gutter');
  await expect
    .poll(async () => (await box(gutter)).x - (await box(calendar)).x)
    .toBeCloseTo(0, 0);
  await expect(gutter.getByText('10:00', { exact: true })).toBeVisible();

  // The phone's strip shows the whole week, Saturday included, no chip cut off.
  const edges = await box(strip);
  for (const chip of await strip.locator('.schedule__picker-day').all()) {
    const { x, width } = await box(chip);
    expect(x).toBeGreaterThanOrEqual(edges.x);
    expect(x + width).toBeLessThanOrEqual(edges.x + edges.width);
  }
  await small.context.close();
});
