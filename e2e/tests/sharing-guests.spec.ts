import { chooseSelect } from '../helpers/select.ts';
import { deflateSync } from 'node:zlib';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createElement } from '@inkadra/canvas-core';
import { boardDocName, roots } from '@inkadra/doc-schema';
import { type Browser, expect, type Page, test } from '@playwright/test';
import WebSocket from 'ws';
import * as Y from 'yjs';

// Runs after first-run.spec.ts: works on a project of its own, as the administrator.
test.describe.configure({ mode: 'serial' });

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const linkPassword = 'segreto-cliente';

interface Seeded {
  project: { id: string; rootBoardId: string };
  first: string;
  second: string;
  hidden: string;
  visible: string;
}
let seeded: Seeded;
let guestUrl = '';

async function login(page: Page, baseURL: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const result = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin: baseURL }, data: account },
  );
  expect(result.ok()).toBe(true);
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** A small solid PNG, so the worker makes real thumbnails. */
function png(shade: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const size = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, shade)]);
  const rows = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(page: Page, baseURL: string, projectId: string, name: string, shade: number) {
  const body = png(shade);
  const meta = (v: string) => Buffer.from(v).toString('base64');
  const create = await page.request.post('/api/v1/uploads', {
    headers: {
      origin: baseURL,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(body.length),
      'Upload-Metadata': `projectId ${meta(projectId)},filename ${meta(name)},filetype ${meta('image/png')}`,
    },
  });
  expect(create.ok()).toBe(true);
  const location = create.headers().location;
  expect(location).toBeTruthy();
  const send = await page.request.patch(new URL(location as string, baseURL).toString(), {
    headers: {
      origin: baseURL,
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    data: body,
  });
  expect(send.ok()).toBe(true);
  const id = send.headers()['inkadra-asset-id'] ?? create.headers()['inkadra-asset-id'];
  expect(id).toBeTruthy();
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/assets/${id}`)).json()).status, {
      timeout: 60_000,
    })
    .toBe('ready');
  return id as string;
}

async function seed(page: Page, baseURL: string): Promise<Seeded> {
  await login(page, baseURL);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: `Ospiti ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  const assetA = await upload(page, baseURL, project.id, 'scatto-alba.png', 40);
  const assetB = await upload(page, baseURL, project.id, 'scatto-tramonto.png', 200);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: baseURL } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: `${baseURL.replace(/^http/, 'ws')}/collab`,
    WebSocketPolyfill: CookieSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: boardDocName(project.rootBoardId),
    document: doc,
  });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sync timed out')), 15_000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const opts = { userId: null };
  const first = createElement(doc, 'image', { x: 80, y: 80 }, { assetId: assetA }, opts);
  const second = createElement(doc, 'image', { x: 400, y: 80 }, { assetId: assetB }, opts);
  const visible = createElement(doc, 'note', { x: 80, y: 420 }, {}, opts);
  const hidden = createElement(doc, 'note', { x: 400, y: 420 }, { guestHidden: true }, opts);
  for (const [id, text] of [
    [visible.id, 'Benvenuti sul set'],
    [hidden.id, 'Budget interno riservato'],
  ]) {
    const body = roots(doc)
      .elements.get(id as string)
      ?.get('body') as Y.XmlFragment;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text as string)]);
    body.insert(0, [paragraph]);
  }
  await expect.poll(() => provider.hasUnsyncedChanges).toBe(false);
  provider.destroy();
  socket.destroy();
  doc.destroy();
  return { project, first: first.id, second: second.id, hidden: hidden.id, visible: visible.id };
}

async function openGuestLinks(page: Page) {
  await page.goto(`/p/${seeded.project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog', { name: /^Condividi/ });
  await dialog.getByRole('tab', { name: 'Link per ospiti' }).click();
  return dialog;
}

/**
 * A guest page and what it asks the server: only the guest API and static files of the same
 * origin, never the account API nor the collaboration socket.
 */
async function guestPage(browser: Browser) {
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  const page = await context.newPage();
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const guestCalls: string[] = [];
  const accountCalls: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    const path = url.pathname;
    if (url.origin !== origin) accountCalls.push(r.url());
    else if (path.startsWith('/api/v1/guest/')) guestCalls.push(path);
    else if (path.startsWith('/api/') || path.startsWith('/collab')) accountCalls.push(path);
  });
  page.on('websocket', (ws) => accountCalls.push(ws.url()));
  return { page, context, guestCalls, accountCalls };
}

/** None of the team's review, comment, version or notification controls on the guest page. */
async function expectNoTeamUi(page: Page) {
  for (const selector of [
    '.card-review',
    '.comment-pin',
    '.comment-pin-target',
    '[data-guest-hidden]',
  ]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  for (const name of [
    /^Commenti:/,
    /discussion[ei] apert[ae]: apri i commenti$/,
    'Commenti e revisione',
    /^(Notifiche|Inbox:)/,
    'Menu della board',
    'Versioni della board',
    'Nascondi agli ospiti',
    'Mostra agli ospiti',
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('complementary', { name: 'Commenti', exact: true })).toHaveCount(0);
  // Neither the selection's toolbar nor the card's menu offers them.
  const card = page.locator(`[data-el="${seeded.second}"]`);
  await card.click();
  await card.click({ button: 'right' });
  for (const name of ['Commenti e revisione', 'Nascondi agli ospiti', 'Mostra agli ospiti']) {
    await expect(page.getByRole('menuitem', { name })).toHaveCount(0);
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
}

test('an editor creates a password link with comments and proofing', async ({ page, baseURL }) => {
  seeded = await seed(page, baseURL as string);
  // Team review data on a card, that the guest page must not show with the team's controls.
  // Reviews check the card in the stored document, written a moment later.
  const board = `/api/v1/boards/${seeded.project.rootBoardId}`;
  const headers = { origin: baseURL as string };
  await expect
    .poll(
      async () =>
        (
          await page.request.put(`${board}/elements/${seeded.second}/review`, {
            headers,
            data: { status: 'changes_requested' },
          })
        ).ok(),
      { timeout: 15_000 },
    )
    .toBe(true);
  const teamComment = await page.request.post(`${board}/comments`, {
    headers,
    data: { elementId: seeded.second, body: 'Solo per il team: rifare il tramonto' },
  });
  expect(teamComment.ok()).toBe(true);
  const dialog = await openGuestLinks(page);
  await expect(dialog.getByText('Nessun link per ospiti.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Nuovo link per ospiti' }).click();
  await chooseSelect(dialog.getByLabel('Chi apre il link'), 'guest_comment');
  await dialog.getByLabel('Per chi è (facoltativo)').fill('Cliente');
  await dialog.getByLabel('Selezione foto').check();
  await dialog.getByLabel('Proteggi con una password').check();
  await dialog.getByLabel('Password', { exact: true }).fill(linkPassword);
  await dialog.getByRole('button', { name: 'Crea link per ospiti' }).click();
  const url = dialog.getByRole('textbox', { name: 'Link per ospiti “Cliente”' });
  await expect(url).toHaveValue(/\/s\/[\w-]{16,}$/);
  guestUrl = await url.inputValue();
  const row = dialog.getByRole('listitem').filter({ hasText: 'Cliente' });
  await expect(row.getByText('Attivo', { exact: true })).toBeVisible();
  await expect(row.getByText(/Può commentare · con password · selezione foto/)).toBeVisible();
});

test('a guest opens the link, comments and picks a picture', async ({ browser }) => {
  const { page, context, guestCalls, accountCalls } = await guestPage(browser);
  await page.goto(guestUrl);
  await expect(page.getByRole('heading', { name: 'Board protetta da password' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  await page.getByLabel('Password').fill('non-questa');
  await page.getByRole('button', { name: 'Apri la board' }).click();
  await expect(page.getByText('Password non corretta.')).toBeVisible();
  await page.getByLabel('Password').fill(linkPassword);
  await page.getByRole('button', { name: 'Apri la board' }).click();

  // The stored document follows the live one after the collaboration store's debounce.
  const cards = page.locator('[data-el]');
  await expect(cards).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator(`[data-el="${seeded.visible}"]`)).toContainText('Benvenuti sul set');
  await expect(page.locator(`[data-el="${seeded.hidden}"]`)).toHaveCount(0);
  await expect(page.getByText('Budget interno riservato')).toHaveCount(0);
  await expect(page.getByText('Ospite · può commentare')).toBeVisible();
  await expect(page.locator(`[data-el="${seeded.first}"] img`)).toHaveAttribute(
    'src',
    /^\/api\/v1\/guest\/links\/[\w-]+\/assets\/[\w-]+\/variants\/\d+$/,
  );

  // The name is asked before the first comment.
  await page.getByLabel('Scrivi un commento').fill('Bellissima la luce della prima.');
  await page.getByRole('button', { name: 'Commenta' }).click();
  const naming = page.getByRole('dialog', { name: 'Come ti chiami?' });
  await naming.getByLabel('Il tuo nome').fill('Marta Rossi');
  await naming.getByRole('button', { name: 'Continua' }).click();
  await expect(naming).toBeHidden();
  const comment = page
    .locator('.guest-comment')
    .filter({ hasText: 'Bellissima la luce della prima.' });
  await expect(comment).toBeVisible();
  await expect(comment.getByText('Marta Rossi (tu)')).toBeVisible();
  await expect(page.getByText('Sei Marta Rossi (ospite)')).toBeVisible();

  // A pick on the card itself, then stars from the panel.
  const pick = page.locator(`[data-el="${seeded.first}"]`).getByRole('button', { name: 'Scelgo' });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await chooseSelect(page.getByLabel('Card', { exact: true }), seeded.first);
  const panel = page.getByRole('complementary', { name: 'Dettagli e commenti' });
  await panel.getByRole('button', { name: '4 stelle' }).click();
  await expect(panel.getByRole('button', { name: '4 stelle' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('button', { name: 'Scelgo' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Picks stay after a reload, with the same guest (the cookie of the link).
  await page.reload();
  await expect(cards).toHaveCount(3, { timeout: 20_000 });
  await expect(
    page.locator(`[data-el="${seeded.first}"]`).getByRole('button', { name: 'Scelgo' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Solo per il team: rifare il tramonto')).toHaveCount(0);
  await expectNoTeamUi(page);

  // A dropped connection keeps the board and the text being typed, and the page recovers.
  await chooseSelect(page.getByLabel('Card', { exact: true }), '');
  await expect(page.getByRole('heading', { name: 'Commenti sulla board' })).toBeVisible();
  const draft = page.getByLabel('Scrivi un commento');
  await draft.fill('Bozza da non perdere');
  let dropped = 0;
  const snapshotUrl = /\/api\/v1\/guest\/links\/[^/]+\/boards\/[^/?]+$/;
  await context.route(snapshotUrl, (route) => {
    if (dropped++ === 0) return route.abort('internetdisconnected');
    return route.continue();
  });
  const lost = page.locator('.guest__header').getByRole('status');
  await expect(lost).toHaveText('Connessione persa, riprovo…', { timeout: 15_000 });
  await expect(cards).toHaveCount(3);
  await expect(draft).toHaveValue('Bozza da non perdere');
  await expect(lost).toHaveCount(0, { timeout: 30_000 });
  expect(dropped).toBeGreaterThan(1);
  await context.unroute(snapshotUrl);
  await expect(cards).toHaveCount(3);
  await expect(draft).toHaveValue('Bozza da non perdere');
  await draft.fill('');

  expect(guestCalls.length).toBeGreaterThan(0);
  expect(accountCalls).toEqual([]);
  await context.close();
});

test('the team sees the comment and the picks', async ({ page, baseURL }) => {
  await login(page, baseURL as string);
  const threads = await (
    await page.request.get(`/api/v1/boards/${seeded.project.rootBoardId}/comments?status=all`)
  ).json();
  const thread = threads.items.find(
    (c: { body: string }) => c.body === 'Bellissima la luce della prima.',
  );
  expect(thread).toBeTruthy();
  expect(thread.visibility).toBe('everyone');
  expect(thread.author).toMatchObject({ kind: 'guest', name: 'Marta Rossi' });

  const dialog = await openGuestLinks(page);
  const row = dialog.getByRole('listitem').filter({ hasText: 'Cliente' });
  await expect(row.getByText(/aperto \d+ volt[ae] · ospiti: 1/)).toBeVisible();
  await row.getByRole('button', { name: 'Risultati' }).click();
  await expect(dialog.getByRole('heading', { name: 'Selezione · Cliente' })).toBeVisible();
  const item = dialog.getByRole('listitem').filter({ hasText: 'scatto-alba.png' });
  await expect(item.getByText('Scelta da 1 · scartata da 0 · 4 stelle (1 voto)')).toBeVisible();
  await expect(item.getByText('Marta Rossi: sceglie, 4 stelle')).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Scarica i nomi delle scelte (.txt)' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  expect(text.trim()).toBe('scatto-alba.png');
  await dialog.getByRole('button', { name: 'Torna ai link' }).click();
  await expect(dialog.getByRole('button', { name: 'Nuovo link per ospiti' })).toBeVisible();

  // The comment is in the comments panel too, marked as a guest of the named link, next to the
  // team's thread.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Commenti: 2 discussioni aperte' }).click();
  const comments = page.getByRole('complementary', { name: 'Commenti' });
  const author = comments
    .locator('.comment-item')
    .filter({ hasText: 'Bellissima la luce della prima.' })
    .locator('.comment-author');
  await expect(author).toContainText('Marta Rossi');
  await expect(author.getByText('Ospite del link “Cliente”', { exact: true })).toBeVisible();
  await expect(comments.getByText('Solo per il team: rifare il tramonto')).toBeVisible();
});

test('revoking the link shows the guest that it was turned off', async ({
  page,
  browser,
  baseURL,
}) => {
  const guest = await guestPage(browser);
  await guest.page.goto(guestUrl);
  await guest.page.getByLabel('Password').fill(linkPassword);
  await guest.page.getByRole('button', { name: 'Apri la board' }).click();
  await expect(guest.page.locator('[data-el]')).toHaveCount(3, { timeout: 20_000 });

  await login(page, baseURL as string);
  const dialog = await openGuestLinks(page);
  const row = dialog.getByRole('listitem').filter({ hasText: 'Cliente' });
  await row.getByRole('button', { name: 'Revoca' }).click();
  await row.getByRole('button', { name: 'Revoca il link' }).click();
  await expect(row.getByText('Revocato', { exact: true })).toBeVisible();
  await expect(row.getByRole('textbox')).toHaveCount(0);

  // The open page finds out at its next poll.
  await expect(guest.page.getByRole('heading', { name: 'Link disattivato' })).toBeVisible({
    timeout: 15_000,
  });
  const again = await guestPage(browser);
  await again.page.goto(guestUrl);
  await expect(again.page.getByRole('heading', { name: 'Link disattivato' })).toBeVisible();
  expect([...guest.accountCalls, ...again.accountCalls]).toEqual([]);
  await guest.context.close();
  await again.context.close();
});

test('a guest of an approval link approves a card and withdraws the decision', async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, baseURL as string);
  const created = await page.request.post(
    `/api/v1/boards/${seeded.project.rootBoardId}/share-links`,
    { headers: { origin: baseURL as string }, data: { role: 'guest_approve', label: 'Regia' } },
  );
  expect(created.ok()).toBe(true);
  const { url } = await created.json();

  const guest = await guestPage(browser);
  await guest.page.goto(url);
  await expect(guest.page.locator('[data-el]')).toHaveCount(3, { timeout: 20_000 });
  await expect(guest.page.getByText('Ospite · può approvare')).toBeVisible();
  await expectNoTeamUi(guest.page);
  // No proofing on this link: no picks on the cards.
  await expect(guest.page.getByRole('button', { name: 'Scelgo' })).toHaveCount(0);
  await chooseSelect(guest.page.getByLabel('Card', { exact: true }), { label: 'Benvenuti sul set' });
  const panel = guest.page.getByRole('complementary', { name: 'Dettagli e commenti' });
  await panel.getByRole('button', { name: 'Approva' }).click();
  const naming = guest.page.getByRole('dialog', { name: 'Come ti chiami?' });
  await naming.getByLabel('Il tuo nome').fill('Luca Neri');
  await naming.getByRole('button', { name: 'Continua' }).click();
  await expect(panel.getByText('Card approvata.')).toBeVisible();
  await expect(guest.page.locator(`[data-el="${seeded.visible}"]`)).toContainText('Approvata');
  await panel.getByRole('button', { name: 'Ritira la mia decisione' }).click();
  await expect(panel.getByText('Decisione ritirata.')).toBeVisible();
  await expect(panel.getByText('Nessuna decisione')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ritira la mia decisione' })).toHaveCount(0);
  expect(guest.guestCalls.length).toBeGreaterThan(0);
  expect(guest.accountCalls).toEqual([]);
  await guest.context.close();
});
