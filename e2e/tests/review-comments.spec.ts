import { type Browser, expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts, on the same instance: the administrator exists. Each test makes
// its own project, so it does not depend on the other specs.
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };
const director = {
  name: 'Luca Regista',
  email: `luca-${Date.now()}@example.com`,
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

const panelOf = (page: Page) => page.getByRole('complementary', { name: 'Commenti' });

test('comments, mentions, review status and notifications between two people', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const projectName = `Spot del porto ${Date.now()}`;
  const project = await api<{ id: string; rootBoardId: string }>(page, '/projects', 'POST', {
    name: projectName,
  });
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByTestId('canvas').dblclick({ position: { x: 300, y: 260 } });
  await page.keyboard.type('Luce sul volto');
  await page.keyboard.press('Escape');
  const card = page.locator('[data-type="note"]', { hasText: 'Luce sul volto' });
  const elementId = await card.getAttribute('data-el');
  if (!elementId) throw new Error('no card id');
  // Comments and reviews check the card in the stored document, written a moment later.
  await expect
    .poll(
      () =>
        api(page, `/boards/${project.rootBoardId}/elements/${elementId}/review`, 'PUT', {
          status: 'none',
        }).then(
          () => true,
          () => false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // A director joins as commenter: the board is read-only for them, comments are not.
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
  const otherCard = other.locator(`[data-el="${elementId}"]`);
  await otherCard.click();
  await other.getByRole('toolbar').getByRole('button', { name: 'Commenti e revisione' }).click();
  const otherPanel = panelOf(other);
  await expect(otherPanel).toBeFocused();

  // A comment with a mention picked from the suggestions.
  const box = otherPanel.getByRole('combobox', { name: 'Commento' });
  await box.fill('Schiarire @Giu');
  await otherPanel.getByRole('option', { name: 'Giulia Bianchi' }).click();
  await expect(box).toHaveValue('Schiarire @Giulia Bianchi ');
  await box.pressSequentially('per favore');
  await expect(otherPanel.getByRole('radio', { name: 'Team' })).toBeChecked();
  await otherPanel.getByRole('button', { name: 'Commenta', exact: true }).click();
  await expect(otherPanel.locator('.comment-mention')).toHaveText('@Giulia Bianchi');

  // The owner sees it live: badge on the card and count in the header.
  await expect(
    card.getByRole('button', { name: '1 discussione aperta: apri i commenti' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commenti: 1 discussione aperta' })).toBeVisible();

  // And is notified; the notification opens the thread on the card.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const bell = page.getByRole('button', { name: /^Notifiche: [1-9]\d* non lett/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Notifiche' });
  const mention = list
    .getByRole('button', { name: /Luca Regista ti ha menzionato/ })
    .filter({ hasText: projectName });
  await expect(mention).toContainText('Schiarire @Giulia Bianchi per favore');
  await mention.click();
  const panel = panelOf(page);
  const thread = panel.locator('.comment-thread').first();
  await expect(thread).toBeFocused();
  await expect(card).toHaveClass(/is-selected/);

  // A reply reaches the director live.
  await thread.getByRole('button', { name: 'Rispondi' }).click();
  await thread.getByRole('combobox', { name: 'Commento' }).fill('Fatto, controllo sul monitor');
  await thread.getByRole('combobox', { name: 'Commento' }).press('ControlOrMeta+Enter');
  await expect(otherPanel.locator('.comment-replies')).toContainText(
    'Fatto, controllo sul monitor',
  );

  // The director resolves; the owner's open list empties and the badge goes away.
  await panel.getByText('Aperte', { exact: true }).click();
  await otherPanel.getByRole('button', { name: 'Risolvi' }).click();
  await expect(panel.getByText('Nessuna discussione aperta.')).toBeVisible();
  await expect(card.locator('.card-review')).toHaveCount(0);
  await panel.getByText('Risolte', { exact: true }).click();
  await expect(panel.getByText('Risolta da Luca Regista')).toBeVisible();

  // Review status: set by the commenter with a note, seen live, with its history.
  await otherPanel.getByRole('button', { name: 'Cambia stato' }).click();
  await otherPanel.getByText('Approvata', { exact: true }).click();
  await otherPanel.getByLabel('Nota (facoltativa)').fill('Pronta per il montaggio');
  await otherPanel.getByRole('button', { name: 'Aggiorna la revisione' }).click();
  await expect(card.getByRole('button', { name: /Revisione: Approvata/ })).toBeVisible();
  const section = panel.getByRole('region', { name: 'Revisione' });
  await expect(section.getByText('Pronta per il montaggio')).toBeVisible();
  await section.getByRole('button', { name: 'Cronologia' }).click();
  const history = section.getByRole('region', { name: 'Cronologia' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('Luca Regista');
  await expect(history).toContainText('Approvata');

  // Filter cards by status from the board's comments.
  await panel.getByRole('button', { name: 'Tutte le discussioni' }).click();
  await panel.getByLabel('Card per stato di revisione').selectOption('approved');
  await expect(panel.getByRole('button', { name: /Luce sul volto.*Approvata/ })).toBeVisible();
  await panel.getByLabel('Card per stato di revisione').selectOption('changes_requested');
  await expect(panel.getByText('Nessuna card con questo stato.')).toBeVisible();

  // A comment on a point of the card shows a numbered pin to the owner.
  await otherPanel.getByRole('button', { name: 'Commenta un punto della card' }).click();
  await otherCard
    .getByRole('button', { name: /Scegli il punto/ })
    .click({ position: { x: 20, y: 20 } });
  await expect(otherPanel.getByText('Su un punto della card')).toBeVisible();
  await otherPanel.getByRole('combobox', { name: 'Commento' }).fill('Qui il riflesso');
  await otherPanel.getByRole('button', { name: 'Commenta', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apri il commento sul punto 1' })).toBeVisible();

  // Mark all as read.
  await panel.getByRole('button', { name: 'Chiudi i commenti' }).click();
  await expect(panel).toHaveCount(0);
  await bell.click();
  await list.getByRole('button', { name: 'Segna tutte come lette' }).click();
  await expect(page.getByRole('button', { name: 'Notifiche: 0 non lette' })).toBeVisible();
  await list.press('Escape');

  // As a viewer the director can read the comments but not write.
  const access = await api<{ items: { user: { id: string; name: string } }[] }>(
    page,
    `/boards/${project.rootBoardId}/access`,
  );
  const luca = access.items.find((e) => e.user.name === director.name);
  if (!luca) throw new Error('no director');
  await api(page, `/projects/${project.id}/members/${luca.user.id}`, 'PUT', { role: 'viewer' });
  await other.reload();
  await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();
  await other.getByRole('button', { name: /^Commenti:/ }).click();
  await expect(otherPanel.getByText('Qui il riflesso')).toBeVisible();
  await expect(otherPanel.getByText('Per scrivere serve il ruolo di commentatore.')).toBeVisible();
  await expect(otherPanel.getByRole('combobox', { name: 'Commento' })).toHaveCount(0);
  await expect(otherPanel.getByRole('button', { name: 'Risolvi' })).toHaveCount(0);
  await expect(otherPanel.getByRole('button', { name: 'Rispondi' })).toHaveCount(0);

  // The owner may delete someone else's comment; the director sees it go.
  await page.getByRole('button', { name: /^Commenti:/ }).click();
  await panel.getByRole('button', { name: 'Elimina il commento di Luca Regista' }).click();
  await panel.getByRole('button', { name: 'Sì, elimina' }).click();
  await expect(otherPanel.getByText('Qui il riflesso')).toHaveCount(0);
  await other.context().close();
});

test('the email notification preference is saved', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Notifiche email' }),
  });
  await expect(section.getByRole('radio', { name: /^Subito/ })).toBeChecked();
  await section.getByRole('radio', { name: 'Un riepilogo al giorno' }).check();
  await section.getByRole('button', { name: 'Salva' }).click();
  await expect(section.getByText('Salvato.')).toBeVisible();
  await page.reload();
  await expect(section.getByRole('radio', { name: 'Un riepilogo al giorno' })).toBeChecked();
  await section.getByRole('radio', { name: /^Subito/ }).check();
  await section.getByRole('button', { name: 'Salva' }).click();
  await expect(section.getByText('Salvato.')).toBeVisible();
});

test('replies page in, and the board loads comment data once for all its cards', async ({
  page,
}) => {
  await signIn(page);
  const project = await api<{ id: string; rootBoardId: string }>(page, '/projects', 'POST', {
    name: 'Discussione lunga',
  });
  const start = await api<{ id: string } & Record<string, unknown>>(
    page,
    `/boards/${project.rootBoardId}/comments`,
    'POST',
    { body: 'Quale obiettivo?' },
  );
  const replies = Array.from({ length: 55 }, (_, i) => ({
    ...start,
    id: `reply-${i + 1}`,
    parentId: start.id,
    body: `Risposta ${i + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  await page.route(`**/api/v1/boards/${project.rootBoardId}/comments?**`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...start,
            replyCount: 55,
            replies: replies.slice(5),
            resolvedAt: null,
            resolvedBy: null,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route(`**/api/v1/comments/${start.id}/replies?**`, (route) =>
    route.fulfill({
      json: route.request().url().includes('cursor=')
        ? { items: replies.slice(3, 5), nextCursor: null }
        : { items: replies.slice(0, 3), nextCursor: 'earlier' },
    }),
  );
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/boards/${project.rootBoardId}/`))
      requests.push(new URL(r.url()).pathname);
  });

  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  for (const [x, y, text] of [
    [250, 200, 'Prima card'],
    [650, 420, 'Seconda card'],
    [450, 600, 'Terza card'],
  ] as const) {
    await page.getByTestId('canvas').dblclick({ position: { x, y } });
    await page.keyboard.type(text);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('[data-type="note"]')).toHaveCount(3);
  const count = (suffix: string) => requests.filter((p) => p.endsWith(suffix)).length;
  expect(count('/comment-counts')).toBe(1);
  expect(count('/reviews')).toBe(1);

  await page.getByRole('button', { name: /^Commenti:/ }).click();
  const panel = panelOf(page);
  await expect(panel.locator('.comment-replies .comment-item')).toHaveCount(50);
  await panel.getByRole('button', { name: 'Mostra altre 5 risposte' }).click();
  await panel.getByRole('button', { name: 'Mostra altre 2 risposte' }).click();
  await expect(panel.locator('.comment-replies .comment-item')).toHaveCount(55);
  await expect(panel.locator('.comment-replies .comment-body').first()).toHaveText('Risposta 1');
  await expect(panel.locator('.comment-replies .comment-body').last()).toHaveText('Risposta 55');
  await panel.getByRole('button', { name: 'Chiudi i commenti' }).click();
  await expect(panel).toHaveCount(0);

  // A link to an old reply finds its thread through the replies pages.
  await page.goto(`/p/${project.id}?thread=reply-1`);
  await expect(panelOf(page).locator('.comment-thread')).toBeFocused();
});

test('the bell polls once a minute and on focus, and keeps paging short pages', async ({
  page,
}) => {
  await page.clock.install();
  let polls = 0;
  await page.route('**/api/v1/me/notifications/unread-count', (route) => {
    polls++;
    return route.fulfill({ json: { unread: 1 } });
  });
  await page.route('**/api/v1/me/notifications?cursor=next', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'future',
            type: 'future_type',
            actor: { kind: 'future_author' },
            projectId: null,
            projectName: 'Spot del porto',
            boardId: null,
            boardTitle: null,
            elementId: null,
            commentId: null,
            excerpt: 'Attività futura',
            reviewStatus: null,
            readAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route('**/api/v1/me/notifications', (route) =>
    route.fulfill({ json: { items: [], nextCursor: 'next' } }),
  );
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Notifiche: 1 non letta' })).toBeVisible();
  const first = polls;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => polls).toBe(first + 1);
  await page.clock.fastForward(60_000);
  await expect.poll(() => polls).toBe(first + 2);

  const bell = page.getByRole('button', { name: 'Notifiche: 1 non letta' });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Notifiche' });
  await list.getByRole('button', { name: 'Mostra altre' }).click();
  await expect(list.getByText('ha fatto qualcosa')).toBeVisible();
  await expect(list.getByText('Attività futura')).toBeVisible();
  await expect(list.getByRole('heading', { name: 'Oggi' })).toBeVisible();
  await list.press('Escape');
  await expect(bell).toBeFocused();
});
