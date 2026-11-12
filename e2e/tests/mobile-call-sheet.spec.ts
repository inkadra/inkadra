import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { setViewsAs } from '../helpers/views.ts';
import * as Y from 'yjs';
import { chooseSelect } from '../helpers/select.ts';
import { account as admin, api } from '../scripts/sample-project.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// #110, mockup screen 8: the call sheet on a phone, with a person's own call and presence. Runs
// after first-run.spec.ts as the administrator, on a project of its own. CALL_SHEET_SHOTS=<dir>
// also saves light and dark screenshots at 390 and 360 px, and the computer's at 1280 px, where
// organisers get the same attendance panel.
test.describe.configure({ mode: 'serial' });
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true } as const;
test.use(phone);

const shotsDir = process.env.CALL_SHEET_SHOTS;
const opts = { userId: null };
const longName = 'Maria Antonietta Fernández de la Cueva y Montesinos-Rossi';
const longPlace = 'Stazione Centrale di Porta Garibaldi, deposito storico dei treni notturni';

interface Seed {
  projectId: string;
  boardId: string;
  actorEmail: string;
  viewerEmail: string;
}
let seed: Seed;

async function shots(page: Page, name: string, widths = [390, 360]) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const size = page.viewportSize() ?? { width: 390, height: 844 };
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of widths) {
      await page.setViewportSize({ width, height: size.height });
      await page.mouse.move(width - 1, size.height - 1);
      // Buttons take a moment to reach the colours of the theme just switched to.
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shotsDir, `${name}-${scheme}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize(size);
}

/** A person who joins the project through an invitation, as a viewer, in a browser of their own. */
async function invite(
  browser: Browser,
  base: string,
  cookie: string,
  projectId: string,
  name: string,
) {
  const { invitation } = await api<{ invitation: { url: string } }>(base, cookie, '/invitations', {
    kind: 'link',
    projectId,
    role: 'viewer',
  });
  const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
  const context = await browser.newContext({ baseURL: base, locale: 'it-IT' });
  const page = await context.newPage();
  await page.goto(invitation.url);
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.locator('.ink-main')).toBeVisible();
  await context.close();
  return email;
}

async function seedProject(browser: Browser, base: string): Promise<Seed> {
  const cookie = await signIn(base, admin);
  const project = await api<{ id: string; rootBoardId: string }>(base, cookie, '/projects', {
    name: 'Last Train',
  });
  const board = await api<{ id: string }>(base, cookie, `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Storyboard',
  });
  await setViewsAs(base, cookie, board.id, ['shotlist', 'schedule']);
  const doc = new Y.Doc();
  initBoardDoc(doc, board.id);
  const ids: string[] = [];
  doc.transact(() => {
    const scene = addScene(doc, { number: '4', title: 'Platform', setting: 'ext' }, opts);
    for (let n = 0; n < 4; n++) ids.push(addFrame(doc, scene.id, null, {}, opts).id);
  });
  await pushBoardDoc(base, cookie, board.id, doc);
  const block = (shotId: string | null, cast: string[], start: string | null = null) => ({
    id: randomUUID(),
    type: shotId ? 'shot' : 'break',
    title: shotId ? '' : 'Pasto',
    start,
    duration: 45,
    shotId,
    cast,
    departments: [],
  });
  await api(base, cookie, `/boards/${board.id}/schedule`, {
    date: '2031-10-22',
    callTime: '18:30',
    wrap: '04:30',
    location: `${longPlace}\nIngresso via Ferrante & binario 21`,
    notes: '',
    blocks: [
      block(ids[0] as string, ['Anna'], '20:30'),
      block(ids[1] as string, ['anna']),
      block(ids[2] as string, ['Anna']),
      block(null, []),
      block(ids[3] as string, ['Anna', longName], '01:45'),
    ],
  });
  await api(base, cookie, `/boards/${board.id}/schedule`, {
    date: '2031-10-23',
    callTime: '09:00',
    wrap: null,
    location: '',
    notes: '',
    blocks: [],
  });
  return {
    projectId: project.id,
    boardId: board.id,
    actorEmail: await invite(browser, base, cookie, project.id, 'Attrice'),
    viewerEmail: await invite(browser, base, cookie, project.id, 'Spettatore'),
  };
}

async function session(browser: Browser, baseURL: string, email: string, password: string) {
  const context = await browser.newContext({
    ...phone,
    baseURL,
    locale: 'it-IT',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const res = await context.request.post('/api/auth/sign-in/email', {
    headers: { origin: baseURL },
    data: { email, password },
  });
  expect(res.ok()).toBe(true);
  return context.newPage();
}

async function openSheet(page: Page) {
  await page.goto(`/p/${seed.projectId}/b/${seed.boardId}?view=schedule`);
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
  await expect(sheet.locator('.sheet__phone-head')).toBeVisible();
  return sheet;
}

/** Nothing sticks out of the screen, whatever the width and however long the names. */
async function fits(page: Page, sheet: Locator) {
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // Everything but the invisible touch area of the switches stays on the screen.
    const beyond = await sheet.locator('.call-sheet').evaluate((el, edge) => {
      const all = [...el.querySelectorAll('*:not(input, .ink-sr-only, .ink-sr-only *)')];
      return all
        .filter((node) => node.getBoundingClientRect().right > edge)
        .map((node) => `${node.tagName}.${node.className}`);
    }, width);
    expect(beyond, `nothing sticks out at ${width}`).toEqual([]);
  }
  await page.setViewportSize(phone.viewport);
}

test.beforeAll(async ({ browser, baseURL }) => {
  seed = await seedProject(browser, baseURL as string);
});

test('an organiser links a cast name on a phone and the text alone still works', async ({
  browser,
  baseURL,
}) => {
  const page = await session(browser, baseURL as string, admin.email, admin.password);
  const sheet = await openSheet(page);
  await expect(sheet.getByRole('button', { name: 'Chiudi' })).toBeVisible();
  await expect(sheet.locator('.sheet__table--schedule')).toContainText('4A');
  await expect(sheet.locator('.sheet__table--schedule')).toContainText('4C');
  await expect(sheet.locator('.sheet__table--schedule')).toContainText('Pausa · Pasto');
  // Not in the cast: nothing to answer, and nothing about their own call.
  await expect(sheet.getByRole('button', { name: 'Confermo la presenza' })).toHaveCount(0);
  await expect(sheet.getByText('La tua convocazione')).toHaveCount(0);
  const maps = sheet.getByRole('link', { name: 'Apri in Mappe' });
  await expect(maps).toHaveAttribute(
    'href',
    `https://www.openstreetmap.org/search?query=${encodeURIComponent(
      `${longPlace}, Ingresso via Ferrante & binario 21`,
    )}`,
  );
  await expect(maps).toHaveAttribute('target', '_blank');
  const panel = sheet.locator('.call-sheet__presence');
  await expect(panel).toContainText(longName);
  await shots(page, 'organiser-top');
  await chooseSelect(panel.getByRole('combobox', { name: 'Account di Anna' }), {
    label: 'Attrice',
  });
  await expect(panel).toContainText('In attesa');
  await fits(page, sheet);
  await panel.scrollIntoViewIfNeeded();
  await shots(page, 'organiser-panel');
  await page.context().close();
});

test('the linked person sees their call, confirms and changes their mind', async ({
  browser,
  baseURL,
}) => {
  const page = await session(browser, baseURL as string, seed.actorEmail, admin.password);
  await page.route('**/schedule/attendance', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(`/p/${seed.projectId}/b/${seed.boardId}?view=schedule`);
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
  await expect(sheet.getByRole('status').getByText('Caricamento delle presenze')).toBeVisible();
  await shots(page, 'actor-loading', [390]);
  const confirm = sheet.getByRole('button', { name: 'Confermo la presenza' });
  const decline = sheet.getByRole('button', { name: 'Non posso' });
  await expect(confirm).toBeVisible();
  // Linking the name made a crew row in Cast (decision 0091): its call is the day's call.
  await expect(sheet.locator('.sheet__phone-own .sheet__label')).toHaveText(
    /^La tua convocazione · anna$/i,
  );
  await expect(sheet.locator('.sheet__phone-own-time')).toHaveText('18:30');
  await shots(page, 'actor-unanswered');
  for (const button of [confirm, decline]) {
    const box = await button.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  await confirm.click();
  await expect(sheet.getByRole('status')).toHaveText('Hai confermato la presenza.');
  await expect(confirm).toHaveAttribute('aria-pressed', 'true');
  await shots(page, 'actor-confirmed');
  await decline.click();
  await expect(sheet.getByRole('status')).toHaveText('Hai detto che non puoi esserci.');
  await shots(page, 'actor-declined');
  await fits(page, sheet);
  // A viewer sees no organiser panel, and the answer survives a reload.
  await expect(sheet.locator('.call-sheet__presence')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  await expect(sheet.getByRole('status')).toHaveText('Hai detto che non puoi esserci.');
  // The other day has no call for them: no buttons, and the empty location leaves no map link.
  await chooseSelect(sheet.getByRole('combobox', { name: 'Data', exact: true }), { index: 1 });
  await expect(confirm).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: 'Apri in Mappe' })).toHaveCount(0);
  await expect(sheet.getByText('Nessun blocco in programma.')).toBeVisible();
  await shots(page, 'actor-empty-day');
  await page.context().close();
});

test('someone who is not linked gets no buttons, and the server refuses them', async ({
  browser,
  baseURL,
}) => {
  const page = await session(browser, baseURL as string, seed.viewerEmail, admin.password);
  const sheet = await openSheet(page);
  await expect(sheet.getByRole('button', { name: 'Confermo la presenza' })).toHaveCount(0);
  await expect(sheet.locator('.call-sheet__presence')).toHaveCount(0);
  await expect(sheet.locator('.sheet__scene-number strong').first()).toHaveText('4');
  await shots(page, 'unlinked');
  const { items } = await (
    await page.request.get(`/api/v1/boards/${seed.boardId}/schedule`)
  ).json();
  const refused = await page.request.put(
    `/api/v1/boards/${seed.boardId}/schedule/${items[0].id}/attendance`,
    { headers: { origin: baseURL as string }, data: { status: 'confirmed' } },
  );
  expect(refused.status()).toBe(403);
  await page.context().close();
});

test('the organiser sees the answer, and a failed load says so', async ({ browser, baseURL }) => {
  const page = await session(browser, baseURL as string, admin.email, admin.password);
  const sheet = await openSheet(page);
  await expect(sheet.locator('.call-sheet__presence')).toContainText('Non può');
  await expect(sheet.locator('.call-sheet__presence')).toContainText('confermati 0 di 1');
  await page.route('**/schedule/attendance', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  const alert = sheet.getByRole('alert');
  await expect(alert).toContainText('Non è stato possibile caricare le presenze.');
  await alert.scrollIntoViewIfNeeded();
  await shots(page, 'load-error');
  await page.unroute('**/schedule/attendance');
  await alert.getByRole('button', { name: 'Riprova' }).click();
  await expect(sheet.locator('.call-sheet__presence')).toContainText('Non può');
  // A very long name in the box of the person's own call still fits.
  const panel = sheet.locator('.call-sheet__presence');
  await chooseSelect(panel.getByRole('combobox', { name: `Account di ${longName}` }), {
    label: 'Spettatore',
  });
  await expect(panel).toContainText('confermati 0 di 2');
  await page.context().close();
  const other = await session(browser, baseURL as string, seed.viewerEmail, admin.password);
  const own = await openSheet(other);
  await expect(own.locator('.sheet__phone-own')).toContainText(longName);
  await fits(other, own);
  await shots(other, 'long-own-call');
  await other.context().close();
});

test('on a computer an organiser gets the panel, outside the sheet and the print', async ({
  browser,
  baseURL,
}) => {
  const page = await session(browser, baseURL as string, admin.email, admin.password);
  await page.setViewportSize({ width: 1280, height: 800 });
  let asked = 0;
  page.on('request', (request) => {
    if (request.url().includes('/schedule/attendance')) asked++;
  });
  await page.route('**/schedule/attendance', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto(`/p/${seed.projectId}/b/${seed.boardId}?view=schedule`);
  const open = page.getByRole('button', { name: 'Foglio di lavorazione' }).first();
  await expect(open).toBeVisible();
  expect(asked, 'nothing is asked before the sheet is open').toBe(0);
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
  await expect(sheet.getByRole('status').getByText('Caricamento delle presenze')).toBeVisible();
  await shots(page, 'desktop-organiser-loading', [1280]);
  const panel = sheet.locator('.call-sheet__controls .call-sheet__presence');
  await expect(panel).toContainText('Non può');
  await expect(panel).toContainText('confermati 0 di 2');
  await expect(panel).toContainText(longName);
  await page.unroute('**/schedule/attendance');
  expect(asked).toBe(1);
  // The preview, its table and the dialog's actions are the ones of before.
  const article = sheet.getByRole('article');
  await expect(article).not.toContainText('Presenze');
  await expect(sheet.locator('.sheet__table--schedule')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Stampa / esporta' })).toBeVisible();
  await expect(sheet.locator('.sheet__phone-head, .sheet__rows, .sheet__maps')).toHaveCount(0);
  // Not in the cast, or in it: on a computer there is nothing to answer yet.
  await expect(sheet.getByRole('button', { name: 'Confermo la presenza' })).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();
  await shots(page, 'desktop-organiser', [1280]);

  // By keyboard: the choice waits for its request, then the focus is back on the control.
  await page.route('**/schedule/cast-links', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const anna = panel.getByRole('combobox', { name: 'Account di Anna' });
  await anna.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').getByRole('option', { name: 'Spettatore' }).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(anna).toBeDisabled();
  await expect(anna).toBeEnabled();
  await expect(anna).toBeFocused();
  // Two names, one person: the count is of people.
  await expect(anna).toContainText('Spettatore');
  await expect(panel).toContainText('confermati 0 di 1');
  await page.unroute('**/schedule/cast-links');
  await chooseSelect(anna, { label: 'Attrice' });
  await expect(panel).toContainText('confermati 0 di 2');

  // A refused choice says so in the panel.
  await page.route('**/schedule/cast-links', (route) => route.abort());
  await chooseSelect(anna, { label: 'Nessun account' });
  await expect(panel.getByRole('alert')).toContainText('Salvataggio non riuscito');
  await panel.scrollIntoViewIfNeeded();
  await shots(page, 'desktop-organiser-save-error', [1280]);
  await page.unroute('**/schedule/cast-links');

  // Print: the sheet alone, as before, at a computer's width and from a phone.
  for (const viewport of [{ width: 1280, height: 800 }, phone.viewport]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ media: 'print' });
    await expect(sheet.locator('.sheet__head')).toBeVisible();
    await expect(sheet.locator('.sheet__table--schedule')).toBeVisible();
    await expect(panel).toBeHidden();
    await expect(sheet.locator('.call-sheet__controls')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Attendance that cannot be loaded says so, and the sheet still works.
  await page.route('**/schedule/attendance', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  const failure = sheet.getByRole('alert');
  await expect(failure).toContainText('Non è stato possibile caricare le presenze.');
  await expect(article).toContainText('Foglio di lavorazione');
  await shots(page, 'desktop-organiser-load-error', [1280]);
  await page.unroute('**/schedule/attendance');
  await failure.getByRole('button', { name: 'Riprova' }).click();
  await expect(panel).toContainText('Non può');
  await page.context().close();
});

test('on a computer someone who does not organise sees and asks nothing new', async ({
  browser,
  baseURL,
}) => {
  const page = await session(browser, baseURL as string, seed.actorEmail, admin.password);
  await page.setViewportSize({ width: 1280, height: 800 });
  let asked = false;
  page.on('request', (request) => {
    if (request.url().includes('/schedule/attendance')) asked = true;
  });
  await page.goto(`/p/${seed.projectId}/b/${seed.boardId}?view=schedule`);
  await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
  await expect(sheet.locator('.sheet__table--schedule')).toBeVisible();
  await expect(sheet.locator('.call-sheet__presence')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Confermo la presenza' })).toHaveCount(0);
  await expect(sheet.getByText('La tua convocazione')).toHaveCount(0);
  expect(asked).toBe(false);
  await shots(page, 'desktop', [1280]);
  await page.context().close();
});
