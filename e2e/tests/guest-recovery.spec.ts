import { expect, type Page, type Route, test } from '@playwright/test';

const board = {
  id: 'board',
  parentBoardId: null,
  kind: 'moodboard',
  title: 'Guest board',
  coverUrl: null,
};
const session = {
  linkId: 'link',
  guest: { id: 'guest', name: 'Guest' },
  boardId: board.id,
  boards: [board],
  role: 'guest_comment',
  allowDownload: false,
  proofing: false,
  sharedBy: 'Editor',
  linkExpiresAt: null,
  sessionExpiresAt: '2030-01-01T00:00:00.000Z',
};
const snapshot = {
  board: { ...board, aspect: null },
  breadcrumb: [],
  elements: [],
  assets: [],
  reviews: [],
  commentCounts: [],
  picks: [],
  version: '1',
  generatedAt: '2026-01-01T00:00:00.000Z',
};
const epoch = new Date('2026-01-01T00:00:00.000Z').getTime();
const deny = (route: Route, reason = 'no_session') =>
  route.fulfill({
    status: reason === 'no_session' ? 401 : 403,
    json: { error: { code: 'forbidden', message: reason, details: { reason } } },
  });

/** Exercise the real page with controlled responses, including requests that outlive a reopen. */
async function mockGuest(page: Page, password = false) {
  await page.clock.setFixedTime(epoch);
  const state = {
    opens: 0,
    checks: 0,
    snapshots: 0,
    session: structuredClone(session),
    snapshot: async (route: Route) => route.fulfill({ json: snapshot }),
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(path, 'guest pages must not call account or team APIs').toMatch(/^\/api\/v1\/guest\//);
    if (path.includes('/by-token/')) {
      return route.fulfill({
        json: {
          linkId: 'link',
          instanceName: 'Inkadra',
          needsPassword: password,
          boardTitle: password ? null : board.title,
          sharedBy: null,
          role: password ? null : session.role,
          expiresAt: null,
        },
      });
    }
    if (path.endsWith('/session')) {
      if (route.request().method() === 'POST') {
        state.opens++;
        return route.fulfill({ json: state.session });
      }
      state.checks++;
      return password ? deny(route) : route.fulfill({ json: state.session });
    }
    if (path.endsWith('/comments')) return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.endsWith('/boards/board')) {
      state.snapshots++;
      return state.snapshot(route);
    }
    throw new Error(`Unexpected guest endpoint: ${path}`);
  });
  return state;
}

async function poll(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('blocked cookies stop after a single successful open', async ({ page }) => {
  const state = await mockGuest(page);
  state.snapshot = (route) => deny(route);
  await page.goto('/s/recovery-test-token');
  await expect(page.getByRole('heading', { name: 'Servono i cookie' })).toBeVisible();
  expect(state.opens).toBe(1);
});

test('a password entered again after a minute starts a fresh cookie check', async ({ page }) => {
  const state = await mockGuest(page, true);
  await page.goto('/s/recovery-test-token');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Apri la board' }).click();
  await expect(page.locator('.guest__header')).toBeVisible();
  state.snapshot = (route) => deny(route, 'password_required');
  await poll(page);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(epoch + 120_000);
  state.snapshot = (route) => deny(route);
  await page.getByLabel('Password', { exact: true }).fill('new-password');
  await page.getByRole('button', { name: 'Apri la board' }).click();
  await expect(page.getByRole('heading', { name: 'Servono i cookie' })).toBeVisible();
  expect(state.opens).toBe(2);
});

test('a late no_session from the old guest cannot stop a reopened page', async ({ page }) => {
  const state = await mockGuest(page);
  let pending: Route | undefined;
  await page.route('**/boards/board/comments', (route) => {
    if (route.request().method() === 'POST') pending = route;
    else return route.fallback();
  });
  await page.goto('/s/recovery-test-token');
  await expect(page.getByLabel('Scrivi un commento')).toBeVisible();
  await page.getByLabel('Scrivi un commento').fill('In flight');
  await page.getByRole('button', { name: 'Commenta', exact: true }).click();
  await expect.poll(() => pending !== undefined).toBe(true);
  await page.clock.setFixedTime(epoch + 120_000);
  let expired = false;
  state.snapshot = (route) => {
    if (!expired) {
      expired = true;
      return deny(route);
    }
    return route.fulfill({ json: snapshot });
  };
  await poll(page);
  await expect.poll(() => state.opens).toBe(2);
  await expect(page.locator('.guest__header')).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.status() === 401,
  );
  await deny(pending!);
  await response;
  // Another successful poll proves the late error did not unmount or stop the recovered page.
  const count = state.snapshots;
  await poll(page);
  await expect.poll(() => state.snapshots).toBeGreaterThan(count);
  await expect(page.getByLabel('Scrivi un commento')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Servono i cookie' })).toHaveCount(0);
  expect(state.opens).toBe(2);
});

test('a 304 refreshes old session rights and keeps team controls out', async ({ page }) => {
  const state = await mockGuest(page);
  await page.goto('/s/recovery-test-token');
  await expect(page.getByLabel('Scrivi un commento')).toBeVisible();
  state.session.role = 'guest_view';
  state.session.sharedBy = 'Updated editor';
  state.snapshot = (route) => route.fulfill({ status: 304 });
  await page.clock.setFixedTime(epoch + 61_000);
  await poll(page);
  await expect(page.getByText('Ospite · può vedere')).toBeVisible();
  await expect(page.getByLabel('Scrivi un commento')).toHaveCount(0);
  await expect(page.locator('.guest__shared')).toHaveText('Condiviso da Updated editor');
  expect(state.checks).toBe(1);
  for (const name of [
    'Condividi',
    'Menu della board',
    'Versioni della board',
    'Commenti e revisione',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
});

test('a late successful session update cannot restore the old guest state', async ({ page }) => {
  const state = await mockGuest(page);
  let pending: Route | undefined;
  await page.route('**/links/link/session', (route) => {
    if (route.request().method() === 'PATCH') pending = route;
    else return route.fallback();
  });
  await page.goto('/s/recovery-test-token');
  await page.getByRole('button', { name: 'Cambia nome' }).click();
  await page.getByLabel('Il tuo nome').fill('Old response');
  await page.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(() => pending !== undefined).toBe(true);
  await page.clock.setFixedTime(epoch + 120_000);
  state.session.guest.name = 'Recovered';
  let expired = false;
  state.snapshot = (route) => {
    if (!expired) {
      expired = true;
      return deny(route);
    }
    return route.fulfill({ json: snapshot });
  };
  await poll(page);
  await expect(page.getByText('Sei Recovered (ospite)')).toBeVisible();
  const response = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await pending!.fulfill({ json: { ...session, guest: { id: 'guest', name: 'Old response' } } });
  await response;
  const count = state.snapshots;
  await poll(page);
  await expect.poll(() => state.snapshots).toBeGreaterThan(count);
  await expect(page.getByText('Sei Recovered (ospite)')).toBeVisible();
  await expect(page.getByText('Sei Old response (ospite)')).toHaveCount(0);
});
