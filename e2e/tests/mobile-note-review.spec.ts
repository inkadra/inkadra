import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createElement } from '@inkadra/canvas-core';
import { boardDocName, CURRENT_SCHEMA_VERSION, roots } from '@inkadra/doc-schema';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { cardAction } from '../helpers/phone-board.ts';

// #110, mockup screens 4 (full-screen note) and 9 (client review) on a phone. Runs after
// first-run.spec.ts as the administrator, on a project of its own. NOTE_REVIEW_SHOTS=<dir>
// also saves light and dark screenshots at 390 and 360 px, and the desktop at 1280 px.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const shotsDir = process.env.NOTE_REVIEW_SHOTS;
/** The administrator's cookies, for the contexts of the tests. */
const teamState = join(tmpdir(), `inkadra-e2e-110-team-${process.env.E2E_PORT ?? 3100}.json`);

interface Seeded {
  projectId: string;
  rootBoardId: string;
  storyboardId: string;
  noteId: string;
  pictureB: string;
}
let seeded: Seeded;
let guestUrl = '';
let shotsOnNoteBoard = false;

async function shots(page: Page, name: string, widths = [390, 360]) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const size = page.viewportSize() ?? { width: 390, height: 844 };
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of widths) {
      await page.setViewportSize({ width, height: size.height });
      await page.mouse.move(width - 1, size.height - 1);
      await page.screenshot({ path: join(shotsDir, `${name}-${scheme}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize(size);
}

async function touchSized(target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
}

async function fitsWidth(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** A small solid PNG in one colour, so the worker makes real thumbnails. */
function png(rgb: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const [w, h] = [96, 54];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixel = Buffer.from(rgb);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => pixel)]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(page: Page, baseURL: string, projectId: string, name: string, body: Buffer) {
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
  const send = await page.request.patch(new URL(create.headers().location!, baseURL).toString(), {
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
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/assets/${id}`)).json()).status, {
      timeout: 60_000,
    })
    .toBe('ready');
  return id as string;
}

/** Edits a board document over the collaboration socket, as a second client would. */
async function editBoard(page: Page, baseURL: string, boardId: string, edit: (doc: Y.Doc) => void) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: baseURL } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: `${baseURL.replace(/^http/, 'ws')}/collab?schemaVersion=${CURRENT_SCHEMA_VERSION}`,
    WebSocketPolyfill: CookieSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: boardDocName(boardId),
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
  edit(doc);
  await expect.poll(() => provider.hasUnsyncedChanges).toBe(false);
  provider.destroy();
  socket.destroy();
  doc.destroy();
}

test.beforeAll(async ({ browser, baseURL }) => {
  const page = await browser.newPage();
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const signedIn = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin: baseURL! }, data: account },
  );
  expect(signedIn.ok()).toBe(true);
  const headers = { origin: baseURL! };
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers,
      data: { name: `Last Train ${Date.now()}` },
    })
  ).json();
  const storyboard = await (
    await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, kind: 'storyboard', title: 'Storyboard' },
    })
  ).json();
  const pictureA = await upload(page, baseURL!, project.id, 'neon-caldo.png', png([201, 134, 58]));
  const pictureB = await upload(page, baseURL!, project.id, 'neon-freddo.png', png([53, 120, 214]));
  const frameIds: string[] = [];
  await editBoard(page, baseURL!, storyboard.id, (doc) => {
    const opts = { userId: null };
    const scene = createElement(
      doc,
      'scene',
      { x: 0, y: 0 },
      { number: '4', title: 'Stazione' } as never,
      opts,
    );
    for (const [assetId, action] of [
      [pictureA, 'Antonio guarda il tabellone. Luce solo dal neon.'],
      [pictureA, 'Il treno entra in stazione.'],
      [pictureB, 'Primo piano del biglietto.'],
    ] as const)
      frameIds.push(
        createElement(
          doc,
          'frame',
          { x: 0, y: 0 },
          { parent: scene.id, assetId, action } as never,
          opts,
        ).id,
      );
  });
  const version = await page.request.post(`/api/v1/boards/${storyboard.id}/versions`, {
    headers,
    data: { name: 'v1' },
  });
  expect(version.ok()).toBe(true);
  // After v1 the first shot gets a colder picture: v1 and now differ.
  await editBoard(page, baseURL!, storyboard.id, (doc) => {
    roots(doc).elements.get(frameIds[0]!)?.set('assetId', pictureB);
  });
  let noteId = '';
  await editBoard(page, baseURL!, project.rootBoardId, (doc) => {
    const note = createElement(doc, 'note', { x: 40, y: 40 }, {}, { userId: null });
    noteId = note.id;
    const body = roots(doc).elements.get(note.id)?.get('body') as Y.XmlFragment;
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', 1 as unknown as string);
    heading.insert(0, [new Y.XmlText('Logline e trattamento')]);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [
      new Y.XmlText("Un tassista notturno accompagna l'ultimo cliente della sua carriera."),
    ]);
    body.insert(0, [heading, p]);
  });
  const link = await page.request.post(`/api/v1/boards/${storyboard.id}/share-links`, {
    headers,
    data: { role: 'guest_approve', label: 'Cliente' },
  });
  expect(link.ok()).toBe(true);
  guestUrl = (await link.json()).url;
  seeded = {
    projectId: project.id,
    rootBoardId: project.rootBoardId,
    storyboardId: storyboard.id,
    noteId,
    pictureB,
  };
  await page.context().storageState({ path: teamState });
  await page.close();
});

async function openNote(page: Page) {
  await page.goto(`/p/${seeded.projectId}`);
  const card = page.locator('.card[data-type="note"]', { hasText: 'Logline' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click({ button: 'right' });
  await cardAction(page, 'Apri documento').click();
  const sheet = page.locator('.note-sidesheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('the full-screen note on a phone: bar, / menu, mentions, pictures and typing', async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: teamState,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'it-IT',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const sheet = await openNote(page);
  await expect(sheet).toHaveClass(/note-sidesheet--phone/);
  await expect(sheet.locator('.note-phone__title')).toHaveText('Logline e trattamento');
  const bar = page.getByRole('toolbar', { name: 'Formattazione della nota' });
  await expect(bar).toBeVisible();
  for (const name of ['Grassetto', 'Corsivo', 'Elenco puntato', 'Lista attività', 'Immagine'])
    await touchSized(bar.getByRole('button', { name, exact: true }));
  await fitsWidth(page);

  // A second tab of the same person writes in the note: this one shows who is typing.
  const other = await context.newPage();
  const otherSheet = await openNote(other);
  await otherSheet.locator('.ProseMirror').click();
  await other.keyboard.press('Control+End');
  await other.keyboard.type(' Prima stesura.');
  await expect(sheet.getByText('Giulia Bianchi sta scrivendo…')).toBeVisible();
  await shots(page, 'note-typing');
  await expect(sheet.getByText('Giulia Bianchi sta scrivendo…')).toBeHidden({ timeout: 10_000 });
  await other.close();

  // `/` opens the insert menu: shot (none on this board), to-do and picture.
  const editor = sheet.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await bar.getByRole('button', { name: 'Inserisci', exact: true }).click();
  const menu = page.getByRole('listbox', { name: 'Inserisci' });
  await expect(menu.getByRole('option')).toHaveText([
    /Inquadratura.*Nessuna inquadratura/,
    /To-do/,
    /Immagine/,
  ]);
  await shots(page, 'note-slash');
  // The shot is unavailable here, so To-do is the first choice.
  await expect(menu.getByRole('option', { name: /To-do/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(editor.locator('ul[data-type="taskList"]')).toHaveCount(1);
  await page.keyboard.type('Sopralluogo');

  // `@` mentions a member of the project.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Rivedere con @Giu');
  await page.getByRole('listbox', { name: 'Persone' }).getByRole('option').first().click();
  await expect(editor.locator('.note-mention')).toHaveText('@Giulia Bianchi');

  // A picture from the files: no camera capture attribute.
  const input = sheet.locator('input[type="file"]');
  await expect(input).toHaveAttribute('accept', 'image/*');
  await expect(input).not.toHaveAttribute('capture');
  await input.setInputFiles({
    name: 'sopralluogo.png',
    mimeType: 'image/png',
    buffer: png([90, 160, 110]),
  });
  await expect(editor.locator('.note-picture img')).toBeVisible({ timeout: 30_000 });
  await shots(page, 'note-mention-picture');

  // Back on the canvas, the card shows the mention and the picture from the shared document.
  await sheet.getByRole('button', { name: 'Chiudi', exact: true }).click();
  const card = page.locator('.card[data-type="note"]', { hasText: 'Logline' });
  await expect(card.locator('.note-mention')).toHaveText('@Giulia Bianchi');
  await expect(card.locator('.note-picture')).toHaveCount(1);

  // The desktop keeps its side sheet as before.
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktop = await openNote(page);
  await expect(desktop).not.toHaveClass(/note-sidesheet--phone/);
  await expect(page.getByRole('toolbar', { name: 'Formattazione della nota' })).toHaveCount(0);
  await shots(page, 'note-desktop', [1280]);
  await context.close();
});

/** The note on a phone, its board holding enough shots for the shot list to scroll. */
async function noteWithShots(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    storageState: teamState,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'it-IT',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const sheet = await openNote(page);
  if (!shotsOnNoteBoard) {
    shotsOnNoteBoard = true;
    await editBoard(page, baseURL, seeded.rootBoardId, (doc) => {
      const opts = { userId: null };
      const scene = createElement(
        doc,
        'scene',
        { x: 1600, y: 0 },
        { number: '1', title: 'Sala' } as never,
        opts,
      );
      for (let i = 0; i < 12; i++)
        createElement(
          doc,
          'frame',
          { x: 1600, y: 0 },
          { parent: scene.id, assetId: seeded.pictureB, action: `Azione ${i}` } as never,
          opts,
        );
    });
  }
  const editor = sheet.locator('.ProseMirror');
  const bar = page.getByRole('toolbar', { name: 'Formattazione della nota' });
  const slash = bar.getByRole('button', { name: 'Inserisci', exact: true });
  const insert = page.getByRole('listbox', { name: 'Inserisci' });
  const shotList = page.getByRole('listbox', { name: 'Inquadratura' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  /** With fingers only: `/` on the bar, then the first item of its menu. */
  const openShotList = async () => {
    await slash.tap();
    await insert.getByRole('option', { name: /Inquadratura/ }).tap();
    await expect(shotList.getByRole('option')).toHaveCount(12);
    await expect(editor).toBeFocused();
  };
  return { context, page, sheet, editor, slash, insert, shotList, openShotList };
}

/** A finger through the browser's input pipeline, so that it scrolls as a real one does. */
async function dragTouch(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points });
  await touch('touchStart', [from]);
  for (let step = 1; step <= 10; step++)
    await touch('touchMove', [
      { x: from.x + ((to.x - from.x) * step) / 10, y: from.y + ((to.y - from.y) * step) / 10 },
    ]);
  // Held still before lifting, so that no fling goes on to swallow the next tap.
  await page.waitForTimeout(200);
  await touch('touchEnd', []);
  await cdp.detach();
}

test('the editor points assistive technology at the item of the phone menu', async ({
  browser,
  baseURL,
}) => {
  const { context, page, editor, slash, insert } = await noteWithShots(browser, baseURL!);
  await expect(editor).toHaveRole('textbox');
  await expect(editor).not.toHaveAttribute('aria-controls');
  await slash.tap();
  const options = insert.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(insert.locator('button')).toHaveCount(0);
  await expect(editor).toHaveAttribute('aria-controls', (await insert.getAttribute('id'))!);
  await expect(editor).toHaveAttribute('aria-autocomplete', 'list');
  await expect(editor).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(0).getAttribute('id'))!,
  );
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(1).getAttribute('id'))!,
  );
  await page.keyboard.press('Escape');
  await expect(insert).toBeHidden();
  await expect(editor).not.toHaveAttribute('aria-controls');
  await expect(editor).not.toHaveAttribute('aria-activedescendant');
  await context.close();
});

test('the shot list of a phone note closes when the note moves on', async ({
  browser,
  baseURL,
}) => {
  const { context, page, sheet, editor, shotList, openShotList } = await noteWithShots(
    browser,
    baseURL!,
  );
  // A tap in the text, with no Escape key on a phone.
  await openShotList();
  await editor.locator('p').first().tap();
  await expect(shotList).toBeHidden();
  // A tap outside the note's text.
  await openShotList();
  await sheet.locator('.note-phone__title').tap();
  await expect(shotList).toBeHidden();
  // The focus going elsewhere.
  await editor.locator('p').first().tap();
  await openShotList();
  await editor.evaluate((el) => (el as HTMLElement).blur());
  await expect(shotList).toBeHidden();
  // Typing on.
  await editor.locator('p').first().tap();
  await openShotList();
  await page.keyboard.type('x');
  await expect(shotList).toBeHidden();
  // Another person writing in the note is no reason to close it.
  await openShotList();
  await editBoard(page, baseURL!, seeded.rootBoardId, (doc) => {
    const body = roots(doc).elements.get(seeded.noteId)?.get('body') as Y.XmlFragment;
    const line = new Y.XmlElement('paragraph');
    line.insert(0, [new Y.XmlText('Riga di un altro.')]);
    body.insert(0, [line]);
  });
  await expect(editor).toContainText('Riga di un altro.');
  await expect(shotList).toBeVisible();
  await context.close();
});

test('touching the phone menu keeps the editor focused and the list scrolling', async ({
  browser,
  baseURL,
}) => {
  const { context, page, editor, shotList, openShotList } = await noteWithShots(browser, baseURL!);
  // A finger's area snaps to the nearest item across the real 6 px, so widen the bare background.
  await page.addStyleTag({ content: '.note-phone-menu { padding: 60px !important; }' });
  await openShotList();
  const box = (await shotList.boundingBox())!;
  const scrolled = () => shotList.evaluate((el) => el.scrollTop);
  const bare = box.x + 30;
  await dragTouch(
    page,
    { x: bare, y: box.y + box.height - 10 },
    { x: bare, y: box.y + box.height / 3 },
  );
  await expect.poll(scrolled).toBeGreaterThan(0);
  await expect(shotList).toBeVisible();
  await expect(editor).toBeFocused();
  await page.touchscreen.tap(bare, box.y + box.height / 2);
  await expect(shotList).toBeVisible();
  await expect(editor).toBeFocused();
  // On an item, back up: the list scrolls and nothing is picked.
  const before = await scrolled();
  const middle = box.x + box.width / 2;
  await dragTouch(
    page,
    { x: middle, y: box.y + box.height / 3 },
    { x: middle, y: box.y + box.height - 10 },
  );
  await expect.poll(scrolled).toBeLessThan(before);
  await expect(shotList).toBeVisible();
  await expect(editor).toBeFocused();
  await context.close();
});

test('a guest reviews a storyboard on a phone, compares v1 and sends the review', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'it-IT',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(guestUrl);
  const review = page.getByRole('region', { name: 'Revisione' });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.getByText('1 di 3')).toBeVisible();
  await expect(review.getByText('Antonio guarda il tabellone. Luce solo dal neon.')).toBeVisible();
  await fitsWidth(page);
  for (const name of ['Approva', 'Chiedi modifiche'])
    await touchSized(review.getByRole('button', { name, exact: true }));
  await expect(review.getByRole('button', { name: /^Invia revisione/ })).toBeDisabled();
  await shots(page, 'review-first');

  // v1 shows the shot as it was: the warmer picture.
  const versions = review.getByRole('group', { name: 'Versione da mostrare' });
  await versions.getByRole('radio', { name: 'v1' }).check({ force: true });
  await expect(versions.getByRole('radio', { name: 'v1' })).toBeChecked();
  await shots(page, 'review-v1');
  await versions.getByRole('radio', { name: 'Ora' }).check({ force: true });

  // Decisions are saved one at a time; the first asks for the guest's name.
  await review.getByRole('button', { name: 'Approva', exact: true }).click();
  const name = page.getByRole('dialog', { name: 'Come ti chiami?' });
  await name.getByLabel('Il tuo nome').fill('Cliente');
  await name.getByRole('button', { name: 'Continua' }).click();
  await expect(review.getByRole('button', { name: 'Approva', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await review.getByRole('button', { name: 'Inquadratura successiva', exact: true }).click();
  await expect(review.getByText('2 di 3')).toBeVisible();
  await review.getByRole('button', { name: 'Chiedi modifiche', exact: true }).click();
  await expect(
    review.getByRole('button', { name: 'Chiedi modifiche', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const send = review.getByRole('button', { name: 'Invia revisione · 1 approvata, 1 modifica' });
  await expect(send).toBeEnabled();
  await shots(page, 'review-decided');
  await send.click();
  await expect(page.getByText('Revisione inviata al team')).toBeVisible();
  await send.click();
  await expect(
    page.getByText('Già inviata: nessuna decisione nuova dall’ultimo invio'),
  ).toBeVisible();

  // The board is one tap away, and back.
  await review.getByRole('button', { name: 'Vedi la board', exact: true }).click();
  await expect(page.locator('.guest__canvas')).toBeVisible();
  await page.locator('.guest__header').getByRole('button', { name: 'Revisione' }).click();
  await expect(review).toBeVisible();

  // Without versions the review still works and says so.
  await page.route('**/versions', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.reload();
  await expect(review.getByText('Le versioni precedenti non sono disponibili ora.')).toBeVisible({
    timeout: 30_000,
  });
  await shots(page, 'review-versions-error');
  await context.close();
});

test('the team sees the review notification and the phone review view', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: teamState,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'it-IT',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const list = await (await page.request.get('/api/v1/me/notifications?limit=20')).json();
  expect(
    list.items.filter(
      (n: { type: string; boardId: string }) =>
        n.type === 'review_submitted' && n.boardId === seeded.storyboardId,
    ),
  ).toHaveLength(1);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}?view=review`);
  await expect(page.locator('.client-review')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.client-review__frames')).toBeHidden();
  await expect(page.locator('.client-review__caption')).toContainText('1 di 3');
  await fitsWidth(page);
  await shots(page, 'review-team');
  await context.close();
});
