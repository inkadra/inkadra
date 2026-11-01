import { type Browser, expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';

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
    page.getByRole('button', { name: '1 discussione aperta: apri i commenti' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commenti: 1 discussione aperta' })).toBeVisible();

  // And is notified; the notification opens the thread on the card.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const bell = page.getByRole('button', { name: /^Inbox: [1-9]\d* non lett/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Inbox', exact: true });
  const mention = list
    .getByRole('button', { name: /Luca Regista ti ha menzionato/ })
    .filter({ hasText: projectName });
  await expect(mention).toContainText('Schiarire @Giulia Bianchi per favore');
  await mention.click();
  const panel = panelOf(page);
  const thread = panel.locator('.comment-thread').first();
  await expect(thread).toBeFocused();
  await expect(card).toHaveClass(/is-selected/);

  // A comment arriving while the owner types leaves their focus and text where they were.
  await thread.getByRole('button', { name: 'Rispondi' }).click();
  const reply = thread.getByRole('combobox', { name: 'Commento' });
  await reply.pressSequentially('Fatto, controllo');
  const elsewhere = await api<{ id: string }>(
    other,
    `/boards/${project.rootBoardId}/comments`,
    'POST',
    { body: 'Nota sulla board' },
  );
  await expect(page.getByRole('button', { name: 'Commenti: 2 discussioni aperte' })).toBeVisible();
  await expect(panel.getByRole('status').filter({ hasText: 'nuovo commento' })).toHaveCount(0);
  await expect(reply).toBeFocused();
  await expect(reply).toHaveValue('Fatto, controllo');
  await api(other, `/comments/${elsewhere.id}`, 'DELETE');
  await expect(page.getByRole('button', { name: 'Commenti: 1 discussione aperta' })).toBeVisible();
  await expect(reply).toBeFocused();

  // Escape keeps a draft: the first press only warns.
  await reply.press('Escape');
  await expect(thread.getByText('Premi di nuovo Esc per scartare il testo.')).toBeVisible();
  await expect(reply).toHaveValue('Fatto, controllo');

  // A reply reaches the director live.
  await reply.pressSequentially(' sul monitor');
  await reply.press('ControlOrMeta+Enter');
  await expect(otherPanel.locator('.comment-replies')).toContainText(
    'Fatto, controllo sul monitor',
  );
  await expect(otherPanel.getByRole('status').filter({ hasText: 'nuovo commento' })).toHaveText(
    'È arrivato un nuovo commento.',
  );

  // The director resolves; the owner's open list empties and the badge goes away.
  await panel.getByRole('radio', { name: 'Aperte', exact: true }).check();
  await otherPanel.getByRole('button', { name: 'Risolvi' }).click();
  await expect(panel.getByText('Nessuna discussione aperta.')).toBeVisible();
  await expect(card.locator('.card-review')).toHaveCount(0);
  await panel.getByRole('radio', { name: 'Risolte', exact: true }).check();
  await expect(panel.getByText('Risolta da Luca Regista')).toBeVisible();

  // Review status: set by the commenter with a note, seen live, with its history.
  await otherPanel.getByRole('button', { name: 'Cambia stato' }).click();
  await otherPanel.getByRole('radio', { name: /^Approvata/ }).check();
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
  await chooseSelect(panel.getByLabel('Card per stato di revisione'), 'approved');
  await expect(panel.getByRole('button', { name: /Luce sul volto.*Approvata/ })).toBeVisible();
  await chooseSelect(panel.getByLabel('Card per stato di revisione'), 'changes_requested');
  await expect(panel.getByText('Nessuna card con questo stato.')).toBeVisible();

  // Drafts are kept per scope, and double Escape in the new-thread composer discards without
  // closing the panel (and resets its warning on blur).
  const composer = otherPanel.getByRole('combobox', { name: 'Commento' });
  await composer.fill('Bozza da scartare');
  await composer.press('Escape');
  await expect(otherPanel.getByText('Premi di nuovo Esc per scartare il testo.')).toBeVisible();
  await composer.evaluate((el: HTMLElement) => el.blur());
  await expect(otherPanel.getByText('Premi di nuovo Esc per scartare il testo.')).toHaveCount(0);
  await composer.focus();
  await composer.press('Escape');
  await expect(otherPanel.getByText('Premi di nuovo Esc per scartare il testo.')).toBeVisible();
  await composer.press('Escape');
  await expect(otherPanel).toBeVisible();
  await expect(composer).toHaveValue('');

  await composer.fill('Qui il riflesso');
  await otherPanel.getByRole('button', { name: 'Tutte le discussioni' }).click();
  await expect(otherPanel.getByRole('combobox', { name: 'Commento' })).toHaveValue('');
  await otherCard.getByRole('button', { name: /Revisione: Approvata/ }).click();
  await expect(otherPanel.getByRole('combobox', { name: 'Commento' })).toHaveValue(
    'Qui il riflesso',
  );

  // A comment on a point of the card, placed with the keyboard, keeps the text already written,
  // and shows a numbered pin to the owner.
  await otherPanel.getByRole('button', { name: 'Commenta un punto della card' }).press('Enter');
  const pinTarget = otherCard.getByRole('button', { name: /Scegli il punto/ });
  await expect(pinTarget).toBeFocused();
  await other.keyboard.press('Enter');
  await expect(otherPanel.getByText('Su un punto della card')).toBeVisible();
  const pinned = otherPanel.getByRole('combobox', { name: 'Commento' });
  await expect(pinned).toBeFocused();
  await expect(pinned).toHaveValue('Qui il riflesso');
  await otherPanel.getByRole('button', { name: 'Commenta', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apri il commento sul punto 1' })).toBeVisible();

  // Mark all as read.
  await panel.getByRole('button', { name: 'Chiudi i commenti' }).click();
  await expect(panel).toHaveCount(0);
  await bell.click();
  await list.getByRole('button', { name: 'Segna tutte come lette' }).click();
  await expect(page.getByRole('button', { name: 'Inbox: 0 non lette' })).toBeVisible();
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

test('the notification matrix and the daily digest are saved', async ({ page }) => {
  await signIn(page);
  try {
    await page.getByRole('button', { name: 'Impostazioni' }).click();
    await page.getByRole('link', { name: 'Notifiche', exact: true }).click();
    const mentionInbox = page.getByRole('checkbox', { name: 'Qualcuno ti menziona: Inbox' });
    const replyEmail = page.getByRole('checkbox', {
      name: 'Rispondono a una tua discussione: Email',
    });
    const digest = page.getByRole('switch', { name: 'Riepilogo giornaliero' });
    // Mentions always reach the Inbox: shown, never changeable.
    await expect(mentionInbox).toBeChecked();
    await expect(mentionInbox).toBeDisabled();
    await expect(replyEmail).toBeChecked();
    await expect(digest).not.toBeChecked();
    // To-do assignments (#304) are in the matrix too, both channels changeable.
    await expect(
      page.getByRole('checkbox', { name: 'Ti assegnano un compito: Inbox' }),
    ).toBeEnabled();
    await expect(
      page.getByRole('checkbox', { name: 'Ti assegnano un compito: Email' }),
    ).toBeChecked();
    // Each choice saves itself; the header confirms it.
    const saved = () =>
      page.waitForResponse(
        (r) => r.url().endsWith('/me/notification-preferences') && r.request().method() === 'PATCH',
      );
    let response = saved();
    await replyEmail.uncheck();
    expect((await response).ok()).toBe(true);
    response = saved();
    await digest.check();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Salvato' })).toBeVisible();
    await page.reload();
    await expect(replyEmail).not.toBeChecked();
    await expect(digest).toBeChecked();
  } finally {
    // The preference is the administrator's own: the next run starts from the default again.
    await api(page, '/me/notification-preferences', 'PATCH', { email: 'immediate', emailOff: [] });
  }
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

  // A link to an old reply finds its thread through the replies pages and shows the reply;
  // editing that older reply refreshes it in place.
  await page.route('**/api/v1/comments/reply-1', async (route) => {
    const body = (route.request().postDataJSON() as { body: string }).body;
    replies[0] = { ...replies[0]!, body };
    await route.fulfill({ json: replies[0] });
  });
  await page.goto(`/p/${project.id}?thread=reply-1`);
  await expect(panelOf(page).locator('.comment-thread')).toBeFocused();
  const oldReply = panelOf(page).locator('[data-comment="reply-1"]');
  await expect(oldReply).toBeInViewport();
  await oldReply.getByRole('button', { name: 'Modifica' }).click();
  await oldReply.getByRole('combobox', { name: 'Commento' }).fill('Risposta 1 aggiornata');
  await oldReply.getByRole('button', { name: 'Salva' }).click();
  await expect(oldReply.locator('.comment-body')).toHaveText('Risposta 1 aggiornata');
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
  await expect(page.getByRole('button', { name: 'Inbox: 1 non letta' })).toBeVisible();
  const first = polls;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => polls).toBe(first + 1);
  await page.clock.fastForward(60_000);
  await expect.poll(() => polls).toBe(first + 2);

  const bell = page.getByRole('button', { name: 'Inbox: 1 non letta' });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Inbox', exact: true });
  await list.getByRole('button', { name: 'Mostra altre' }).click();
  await expect(list.getByText('ha fatto qualcosa')).toBeVisible();
  await expect(list.getByText('Attività futura')).toBeVisible();
  await expect(list.getByRole('heading', { name: 'Oggi' })).toBeVisible();

  // Marking one read changes the count without reloading the list or moving focus.
  let firstPages = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/v1/me/notifications') firstPages++;
  });
  await page.route('**/api/v1/me/notifications/future/read', (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.unroute('**/api/v1/me/notifications/unread-count');
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({ json: { unread: 0 } }),
  );
  const markRead = list.getByRole('button', { name: 'Segna come letta' });
  await markRead.focus();
  await markRead.press('Enter');
  await expect(page.getByRole('button', { name: 'Inbox: 0 non lette' })).toBeVisible();
  await expect(list.getByText('Attività futura')).toBeVisible();
  await expect(list.getByRole('button', { name: 'Mostra altre' })).toHaveCount(0);
  expect(firstPages).toBe(0);
  // Its own button leads nowhere (an unknown type), so focus stays in the list.
  await expect(list).toBeFocused();
  await list.press('Escape');
  await expect(page.getByRole('button', { name: 'Inbox: 0 non lette' })).toBeFocused();
  // "Open inbox" keeps the pages shown in the peek, and closing the Inbox goes back to the bell.
  const readBell = page.getByRole('button', { name: 'Inbox: 0 non lette' });
  await readBell.click();
  await expect(list.getByText('Attività futura')).toBeVisible();
  await list.getByRole('button', { name: 'Apri inbox' }).click();
  await expect(list).toHaveClass(/notifications--fixed/);
  await expect(list.getByText('Attività futura')).toBeVisible();
  await list.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(readBell).toBeFocused();
});
