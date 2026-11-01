import { type Browser, expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts, on the same instance: the administrator exists. Comments on the
// board (#311), quick reactions (#334), and the mentions filter and unread state (#336).
test.describe.configure({ mode: 'serial' });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const director = {
  name: 'Luca Regista',
  email: `luca-board-${Date.now()}@example.com`,
  password: 'another-horse-battery',
};

async function api<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
      return res.status === 204 ? null : res.json();
    },
    { path, method, body },
  );
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  return context.newPage();
}

test('bubble, popover, reactions, mentions filter and unread', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signIn(page);
  const project = await api<{ id: string; rootBoardId: string }>(page, '/projects', 'POST', {
    name: `Commenti sulla board ${Date.now()}`,
  });
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByTestId('canvas').dblclick({ position: { x: 300, y: 260 } });
  await page.keyboard.type('Luce sul volto');
  await page.keyboard.press('Escape');
  const card = page.locator('[data-type="note"]', { hasText: 'Luce sul volto' });
  const elementId = await card.getAttribute('data-el');
  if (!elementId) throw new Error('no card id');
  // Comments and reactions check the card in the stored document, written a moment later.
  await expect
    .poll(
      () =>
        api(
          page,
          `/boards/${project.rootBoardId}/elements/${elementId}/reactions/%F0%9F%91%8D`,
          'PUT',
        ).then(
          () => true,
          () => false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await api(
    page,
    `/boards/${project.rootBoardId}/elements/${elementId}/reactions/%F0%9F%91%8D`,
    'DELETE',
  );

  // The director joins as commenter and writes to Giulia.
  const invitation = await api<{ invitation: { url: string } }>(page, '/invitations', 'POST', {
    kind: 'link',
    projectId: project.id,
    role: 'commenter',
  });
  const other = await newPage(browser);
  await other.goto(invitation.invitation.url);
  await other.getByLabel('Nome').fill(director.name);
  await other.getByLabel('Email').fill(director.email);
  await other.getByLabel('Password').fill(director.password);
  await other.getByRole('button', { name: 'Crea account' }).click();
  await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();
  const access = await api<{ items: { user: { id: string; name: string } }[] }>(
    page,
    `/boards/${project.rootBoardId}/access`,
  );
  const giulia = access.items.find((e) => e.user.name === admin.name);
  if (!giulia) throw new Error('no owner');
  await api(other, `/boards/${project.rootBoardId}/comments`, 'POST', {
    elementId,
    body: `Più caldo in post, @{${giulia.user.id}}?`,
  });

  // The thread is new for Giulia: the button counts it as unread, and the card has a bubble.
  await expect(
    page.getByRole('button', { name: 'Commenti: 1 discussione aperta, 1 non letta' }),
  ).toBeVisible();
  const bubble = page.getByRole('button', { name: '1 discussione aperta: apri i commenti' });
  await expect(bubble).toBeVisible();

  // A reaction on the card, from the picker under it; the director sees it live and adds his.
  await card.hover();
  await page.getByRole('button', { name: 'Aggiungi una reazione' }).click();
  await page.getByRole('button', { name: 'Reagisci con 👍' }).click();
  await expect(page.getByRole('button', { name: /^👍 1: Giulia Bianchi/ })).toBeVisible();
  await expect(other.getByRole('button', { name: /^👍 1: Giulia Bianchi/ })).toBeVisible();
  await other.locator(`[data-el="${elementId}"]`).hover();
  await other.getByRole('button', { name: 'Aggiungi una reazione' }).click();
  await other.getByRole('button', { name: 'Reagisci con 👍' }).click();
  await expect(
    page.getByRole('button', { name: /^👍 2: Giulia Bianchi, Luca Regista/ }),
  ).toBeVisible();

  // The thread opens beside the card from the bubble, and reads it.
  await bubble.click();
  const thread = page.getByRole('region', { name: 'Discussioni su Luce sul volto' });
  await expect(thread.getByText('Più caldo in post,')).toBeVisible();
  await expect(thread.locator('.comment-mention')).toHaveText('@Giulia Bianchi');
  await thread.getByRole('button', { name: 'Aggiungi una reazione' }).click();
  await thread.getByRole('button', { name: 'Reagisci con ✅' }).click();
  await expect(thread.getByRole('button', { name: /^✅ 1: Giulia Bianchi/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Commenti: 1 discussione aperta', exact: true }),
  ).toBeVisible();
  await thread.getByRole('button', { name: 'Chiudi le discussioni' }).click();
  await expect(thread).toHaveCount(0);

  // In the panel: the mentions filter, and mark as unread (kept by the server).
  await page.getByRole('button', { name: 'Commenti: 1 discussione aperta', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Commenti' });
  await panel.getByRole('radio', { name: /^Menzioni e risposte · 1/ }).check();
  await expect(panel.locator('.comment-mention')).toHaveText('@Giulia Bianchi');
  await expect(panel.getByRole('button', { name: /^✅ 1/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Azioni sulla discussione' }).click();
  await page.getByRole('menuitem', { name: 'Segna come non letta' }).click();
  await expect(panel.getByRole('img', { name: 'Non letta' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Commenti: 1 discussione aperta, 1 non letta' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Commenti: 1 discussione aperta, 1 non letta' }),
  ).toBeVisible();

  // Turning "Mostra sulla board" off takes the markers away; it is remembered.
  await page.getByRole('button', { name: /^Commenti:/ }).click();
  await panel.getByRole('switch', { name: 'Mostra sulla board' }).uncheck();
  await expect(bubble).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(bubble).toHaveCount(0);
  await page.getByRole('button', { name: /^Commenti:/ }).click();
  await panel.getByRole('switch', { name: 'Mostra sulla board' }).check();
  await expect(bubble).toBeVisible();
  await other.context().close();
});
