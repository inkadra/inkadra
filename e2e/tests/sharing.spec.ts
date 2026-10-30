import { chooseSelect } from '../helpers/select.ts';
import { type Browser, expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts: the administrator and the project "Ultima corsa" exist.
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const guest = {
  name: 'Paolo Bassi',
  email: 'paolo@example.com',
  password: 'another-horse-battery',
};
let inviteUrl = '';

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function openProject(page: Page) {
  await page.getByRole('link', { name: 'Ultima corsa' }).first().click();
  await expect(page.getByRole('status').getByText(/Sincronizzato|Sola lettura/)).toBeVisible();
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  return context.newPage();
}

/** A point on the canvas, relative to it, with no card or control under it. */
async function emptySpot(page: Page, from: { x: number; y: number }) {
  const canvas = page.getByTestId('canvas');
  const spot = await canvas.evaluate((el, start) => {
    const box = el.getBoundingClientRect();
    for (let dy = 0; dy < box.height - start.y; dy += 40) {
      for (let dx = 0; dx < box.width - start.x; dx += 40) {
        const x = start.x + dx;
        const y = start.y + dy;
        const hit = document.elementFromPoint(box.left + x, box.top + y);
        if (hit && el.contains(hit) && !hit.closest('[data-type], button, input, [role="toolbar"]'))
          return { x, y };
      }
    }
    return null;
  }, from);
  if (!spot) throw new Error('no empty spot on the canvas');
  return spot;
}

test('the owner makes an invitation link for the project', async ({ page }) => {
  await signIn(page, admin);
  await openProject(page);
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog', { name: 'Condividi “Ultima corsa”' });
  await expect(dialog.getByText('Giulia Bianchi (tu)')).toBeVisible();
  await expect(dialog.getByText('Chi inviti qui entra in tutto il progetto.')).toBeVisible();
  // Links give at most editor: owners are named from the people list (decision 0019).
  await expect(
    dialog.getByRole('combobox', { name: 'Ruolo per chi usa il link' }).locator('option'),
  ).toHaveText(['Lettore', 'Commentatore', 'Editor']);
  await dialog.getByRole('button', { name: 'Crea link' }).click();
  const link = dialog.getByRole('textbox', { name: 'Link d’invito' });
  await expect(link).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  inviteUrl = await link.inputValue();
  await expect(dialog.getByText(/Lettore · scade il/)).toBeVisible();
});

test('a new person signs up from the link, even with invite-only registration', async ({
  browser,
}) => {
  const page = await newPage(browser);
  await page.goto(inviteUrl);
  await expect(page.getByText('Giulia Bianchi ti invita nel progetto Ultima corsa')).toBeVisible();
  await expect(page.getByText('come Lettore')).toBeVisible();
  await page.getByLabel('Nome').fill(guest.name);
  await page.getByLabel('Email').fill(guest.email);
  await page.getByLabel('Password').fill(guest.password);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').getByText('Sola lettura')).toBeVisible();
  await page.context().close();
});

test('people on the board see each other, and a viewer cannot edit', async ({ page, browser }) => {
  await signIn(page, admin);
  await openProject(page);
  const other = await newPage(browser);
  await signIn(other, guest);
  await openProject(other);

  // Each sees the other in the header; the viewer is marked read-only.
  await expect(page.locator(`.peers__one[title="${guest.name} (sola lettura)"]`)).toBeVisible();
  await expect(other.locator('.peers__one[title="Giulia Bianchi"]')).toBeVisible();

  // The owner's pointer shows up on the viewer's board with a name tag.
  const canvas = page.getByTestId('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.move(box.x + 420, box.y + 320);
  await expect(other.locator('.peer-cursor', { hasText: 'Giulia Bianchi' })).toBeVisible();

  // A double click makes no note for a viewer, and the owner's notes arrive live.
  const notes = other.locator('[data-type="note"]');
  const before = await notes.count();
  await other
    .getByTestId('canvas')
    .dblclick({ position: await emptySpot(other, { x: 600, y: 500 }) });
  await expect(notes).toHaveCount(before);
  await canvas.dblclick({ position: await emptySpot(page, { x: 600, y: 520 }) });
  await page.keyboard.type('Scaletta riprese');
  await page.keyboard.press('Escape');
  await expect(other.locator('[data-type="note"]', { hasText: 'Scaletta riprese' })).toBeVisible();

  // The viewer sees who has access but cannot change it.
  await other.getByRole('button', { name: 'Condividi' }).click();
  const dialog = other.getByRole('dialog');
  await expect(dialog.getByText('Solo editor e proprietari possono invitare')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Invita' })).toHaveCount(0);
  await other.context().close();
});

test('a role change reaches a board that is already open', async ({ page, browser }) => {
  // The collab server checks open connections every 30 seconds.
  test.setTimeout(120_000);
  const other = await newPage(browser);
  await signIn(other, guest);
  await openProject(other);
  await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();

  await signIn(page, admin);
  await openProject(page);
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog');
  const role = dialog.getByRole('combobox', { name: `Ruolo di ${guest.name}` });
  await chooseSelect(role, 'editor');
  await expect(role).toHaveAttribute('data-value', 'editor');

  // Without a reload, the person is told and can write.
  await expect(other.getByText('ora puoi modificare questa board')).toBeVisible({
    timeout: 45_000,
  });
  // The others see the new role at once, without waiting for the pointer to move.
  await expect(page.locator(`.peers__one[title="${guest.name}"]`)).toBeVisible();
  await expect(other.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await other
    .getByTestId('canvas')
    .dblclick({ position: await emptySpot(other, { x: 300, y: 600 }) });
  await other.keyboard.type('Nota di Paolo');
  await other.keyboard.press('Escape');
  await expect(page.locator('[data-type="note"]', { hasText: 'Nota di Paolo' })).toBeVisible();

  // And back: the open board turns read-only again, with a notice.
  await chooseSelect(role, 'viewer');
  await expect(other.getByText('ora puoi solo guardare questa board')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(`.peers__one[title="${guest.name} (sola lettura)"]`)).toBeVisible();
  await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();
  await other.context().close();
});

test('account settings make a personal token shown once', async ({ page }) => {
  await signIn(page, guest);
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nuovo token' }).click();
  await page.getByLabel('Nome del token').fill('Script di backup');
  await page.getByRole('button', { name: 'Crea token' }).click();
  await expect(page.getByText('Token “Script di backup” creato.')).toBeVisible();
  await expect(page.locator('.settings__token')).toHaveText(/^ink_/);
  await page.getByRole('button', { name: 'Fatto' }).click();
  await expect(page.getByText('Script di backup')).toBeVisible();
  await expect(page.getByText('mai usato')).toBeVisible();
  // Settings are a window over the page: Escape closes them and nothing else.
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.settings-window')).toBeHidden();
  await expect(page).not.toHaveURL(/\/settings/);
  await expect(page.getByRole('button', { name: 'Impostazioni', exact: true })).toBeFocused();
});

test('account settings end another session without handing out its token', async ({
  page,
  browser,
}) => {
  const other = await newPage(browser);
  await signIn(other, guest);
  await signIn(page, guest);
  const listed = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/sessions'));
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const sessions = await (await listed).json();
  expect(sessions.items.length).toBeGreaterThan(1);
  for (const item of sessions.items) expect(item).not.toHaveProperty('token');
  const sessionList = page.locator('section', {
    has: page.getByRole('heading', { name: 'Sessioni' }),
  });
  const more = sessionList.getByRole('button', { name: /^Mostra tutte/ });
  if (await more.isVisible()) await more.click();
  const end = sessionList.getByRole('button', { name: 'Esci', exact: true });
  await expect(end).toHaveCount(sessions.items.length - 1);
  await end.first().click();
  await expect(end).toHaveCount(sessions.items.length - 2);
  // One of the guest's other sessions ended: end them all and the second browser is out.
  await sessionList.getByRole('button', { name: 'Esci dagli altri' }).click();
  expect((await other.request.get('/api/v1/me')).status()).toBe(401);
  await other.context().close();
});

test('denying an app on /authorize answers it through the server', async ({ page }) => {
  await signIn(page, guest);
  await expect(page).not.toHaveURL(/\/login/);
  const challenge = 'A'.repeat(43);
  const query = `client_id=mobile&redirect_uri=${encodeURIComponent('inkadra://auth')}&state=s1&code_challenge=${challenge}&code_challenge_method=S256`;
  await page.goto(`/authorize?${query}`);
  const denied = page.waitForResponse((r) => r.url().endsWith('/api/v1/app-authorizations/deny'));
  await page.getByRole('button', { name: 'Annulla' }).click();
  const { redirectTo } = await (await denied).json();
  expect(redirectTo).toBe('inkadra://auth?error=access_denied&state=s1');

  // An address that is not allowed hears nothing.
  await page.goto(`/authorize?${query.replace('mobile', 'clipper')}`);
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/v1/app-authorizations/deny'));
  await page.getByRole('button', { name: 'Annulla' }).click();
  expect((await refused).status()).toBe(400);
  await expect(
    page.getByText('Nessun accesso concesso. Puoi chiudere questa pagina.'),
  ).toBeVisible();
});

test('someone with access to one board opens the project address on that board', async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, admin);
  await openProject(page);
  const projectId = page.url().match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? '';
  const headers = { origin: baseURL ?? '' };
  const project = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
  const board = await (
    await page.request.post(`/api/v1/projects/${projectId}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, title: 'Costumi' },
    })
  ).json();
  const invited = await page.request.post('/api/v1/invitations', {
    headers,
    data: { kind: 'link', boardId: board.id, role: 'viewer' },
  });
  expect(invited.status()).toBe(201);
  const { invitation } = await invited.json();

  const costume = await newPage(browser);
  await costume.goto(invitation.url);
  await costume.getByLabel('Nome').fill('Sara Neri');
  await costume.getByLabel('Email').fill('sara@example.com');
  await costume.getByLabel('Password').fill('third-horse-battery');
  await costume.getByRole('button', { name: 'Crea account' }).click();
  await expect(costume.getByRole('status').getByText('Sola lettura')).toBeVisible();

  await costume.goto(`/p/${projectId}`);
  await expect(costume).toHaveURL(new RegExp(`/p/${projectId}/b/${board.id}$`));
  await expect(costume.getByRole('status').getByText('Sola lettura')).toBeVisible();
  await costume.goto('/p/00000000-0000-4000-8000-000000000000');
  await expect(costume.getByText('Pagina non trovata')).toBeVisible();
  await costume.context().close();
});
