import { type Browser, expect, type Page, test } from '@playwright/test';
import { addSceneWithFrames } from '../helpers/storyboard.ts';
import { signUpViaInvite } from './support/accounts.ts';

// Runs after first-run.spec.ts: a project of its own, a new member and a guest (#502).
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const member = { name: 'Nora Gallo', email: 'nora@example.com', password: 'nora-tutorial-pass' };
let project: { id: string; rootBoardId: string };
let guestUrl = '';

/** A browser where tutorials offer themselves: test browsers get none unless they ask. */
async function withTutorials(browser: Browser) {
  const context = await browser.newContext({
    locale: 'it-IT',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => localStorage.setItem('inkadra.tutorials', 'on'));
  return { context, page: await context.newPage() };
}

async function signIn(page: Page, person: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

/** Walks a tour to its end: at every step the spotlight is on its element, and it is visible. */
async function walk(page: Page, anchors: string[]) {
  const tour = page.locator('dialog.tour');
  await expect(tour).toBeVisible();
  const seen: string[] = [];
  for (;;) {
    const count = await tour.locator('.tour__count').textContent();
    const anchor = await tour.getAttribute('data-anchor');
    if (anchor) {
      await expect(page.locator(`[data-tour="${anchor}"]`).first()).toBeVisible();
      await expect(tour.locator('.tour__spot')).toBeVisible();
      seen.push(anchor);
    }
    await expect(tour.getByRole('heading')).not.toBeEmpty();
    const next = tour.getByRole('button', { name: /^(Avanti|Fatto)$/ });
    await expect(next).toBeFocused();
    const last = (await next.textContent())?.includes('Fatto');
    await next.click();
    if (last) break;
    await expect(tour.locator('.tour__count')).not.toHaveText(count ?? '');
  }
  await expect(tour).toHaveCount(0);
  for (const anchor of anchors) expect(seen).toContain(anchor);
}

test('an administrator prepares a project with a storyboard', async ({ page, baseURL }) => {
  await signIn(page, admin);
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL as string },
    data: { name: 'Giro guidato' },
  });
  expect(created.ok()).toBe(true);
  project = await created.json();
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.keyboard.press('s');
  const card = page.locator('[data-type="board"]', { hasText: 'Storyboard' });
  await expect(card).toHaveCount(1);
  await page.keyboard.type('Binario 9');
  await page.keyboard.press('Escape');
  await card.dblclick();
  await expect(page.getByRole('tab', { name: 'Storyboard' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await addSceneWithFrames(page);

  const link = await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
    headers: { origin: baseURL as string },
    data: { role: 'guest_approve', label: 'Cliente' },
  });
  expect(link.ok()).toBe(true);
  guestUrl = (await link.json()).url;
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  await signUpViaInvite(baseURL as string, cookie, project.id, 'editor', member);
});

test('a new member gets the welcome and the guided tour, once', async ({ browser }) => {
  const { context, page } = await withTutorials(browser);
  await signIn(page, member);
  const welcome = page.getByRole('dialog', { name: 'Dall’idea all’inquadratura.' });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole('button', { name: /Fai il giro/ })).toBeFocused();
  await welcome.getByRole('button', { name: /Fai il giro/ }).click();
  // The tour opens the project to show a board.
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}`));
  // The sidebar steps show when the sidebar is open; the board's are always there.
  await walk(page, ['dock', 'card', 'share']);
  const finale = page.getByRole('dialog', { name: 'Sei pronto.' });
  await expect(finale).toBeVisible();
  await finale.getByRole('button', { name: 'Inizia a creare' }).click();
  await expect(finale).toHaveCount(0);

  // Seen on the account: not offered again, here or anywhere.
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('dialog.tour-welcome')).toHaveCount(0);
  const prefs = await (await page.request.get('/api/v1/me/preferences')).json();
  expect(prefs.tutorialsSeen).toContain('welcome');
  await context.close();
});

test('the storyboard offers its tour the first time it is opened', async ({ browser }) => {
  const { context, page } = await withTutorials(browser);
  await signIn(page, member);
  await expect(page.getByRole('heading', { name: /Nora$/ })).toBeVisible();
  await page.goto(`/p/${project.id}`);
  await page.locator('[data-type="board"]', { hasText: 'Binario 9' }).dblclick();
  await expect(page.getByRole('tab', { name: 'Storyboard' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const pill = page.locator('.tour-pill', { hasText: 'Prima volta in Storyboard?' });
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await pill.getByRole('button', { name: 'Giro di 30 s' }).click();
  await walk(page, ['storyboard-scene', 'storyboard-frame', 'storyboard-draw']);
  await expect(page.locator('.tour-toast')).toContainText('Storyboard: giro completato.');
  await expect(pill).toHaveCount(0);
  // The pill that opened the tour is gone: the focus is on the page's region, never on body.
  await expect(page.locator('body')).not.toBeFocused();
  await context.close();
});

test('Settings → Tutorial replays a tour and counts what was seen', async ({ browser }) => {
  const { context, page } = await withTutorials(browser);
  await signIn(page, member);
  await expect(page.getByRole('heading', { name: /Nora$/ })).toBeVisible();
  await page.goto('/settings?section=tutorials');
  // Welcome and Storyboard seen, of the welcome and the 20 tours of a member.
  await expect(page.getByText('2 di 21 visti')).toBeVisible();
  await page.getByRole('button', { name: 'Riproduci Storyboard' }).click();
  // Far from a storyboard the steps are cards, never a blank screen.
  const tour = page.locator('dialog.tour');
  await expect(tour.getByRole('heading', { name: 'Scene e frame' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(page.locator('body')).not.toBeFocused();
  await expect(page.locator('.tour-toast')).toContainText('Giro saltato.');

  // Replaying Welcome from Settings over a board stays on that board without extra navigation.
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const idxBefore = await page.evaluate(() => window.history.state?.idx);
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.locator('dialog.settings-window').getByRole('link', { name: 'Tutorial' }).click();
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('dialog.settings-window')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}$`));
  await expect(tour).toBeVisible();
  expect(await page.evaluate(() => window.history.state?.idx)).toBe(idxBefore);
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await context.close();
});

test('a guest of a review link gets two steps, and ? plays them again', async ({ browser }) => {
  const { context, page } = await withTutorials(browser);
  await page.goto(guestUrl);
  const pill = page.locator('.tour-pill', { hasText: /ti chiede un parere|Ti chiedono un parere/ });
  await expect(pill).toBeVisible({ timeout: 20_000 });
  await pill.getByRole('button', { name: /Come funziona/ }).click();
  await walk(page, ['guest-canvas', 'guest-panel']);
  await expect(page.locator('.tour-toast')).toContainText('Buona revisione!');

  await page.reload();
  await expect(page.locator('[data-tour="guest-canvas"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tour-pill')).toHaveCount(0);
  await page.getByRole('button', { name: 'Come funziona' }).click();
  await expect(
    page.locator('dialog.tour').getByRole('heading', { name: 'Commenta una card' }),
  ).toBeVisible();
  await context.close();
});
