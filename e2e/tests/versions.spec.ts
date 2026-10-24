import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createElement, moveIntoParent } from '@inkadra/canvas-core';
import { boardDocName, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import WebSocket from 'ws';
import * as Y from 'yjs';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

async function login(page: Page, baseURL: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const result = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin: baseURL }, data: account },
  );
  expect(result.ok()).toBe(true);
}

async function seed(page: Page, baseURL: string) {
  await login(page, baseURL);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: `Versions ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
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
  const column = createElement(doc, 'column', { x: 80, y: 80 }, { title: 'Team references' }, opts);
  const child = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const note = createElement(doc, 'note', { x: 480, y: 80 }, {}, opts);
  for (const [id, text] of [
    [child.id, 'Container note'],
    [note.id, 'Original note'],
  ]) {
    const body = roots(doc).elements.get(id!)!.get('body') as Y.XmlFragment;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text!)]);
    body.insert(0, [paragraph]);
  }
  moveIntoParent(doc, [child.id], column.id, 0);
  await expect.poll(() => provider.hasUnsyncedChanges).toBe(false);
  provider.destroy();
  socket.destroy();
  doc.destroy();
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato', { exact: true })).toBeVisible();
  await expect(page.locator('[data-el]')).toHaveCount(3);
  return { project, column, child, note };
}

async function openVersions(page: Page) {
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Versioni della board' }).click();
  return page.getByRole('dialog', { name: 'Versioni della board', exact: true });
}

async function saveVersion(page: Page, name: string) {
  const dialog = await openVersions(page);
  await dialog.getByRole('textbox', { name: 'Nome della versione' }).fill(name);
  await dialog.getByRole('button', { name: 'Salva versione', exact: true }).click();
  await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  return dialog;
}

test('named versions preview an isolated read-only canvas and restore every open client', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project } = await seed(page, baseURL!);
  const secondContext = await browser.newContext({ locale: 'it-IT' });
  const other = await secondContext.newPage();
  try {
    await login(other, baseURL!);
    await other.goto(`/p/${project.id}`);
    await expect(other.locator('[data-el]')).toHaveCount(3);
    const dialog = await saveVersion(page, 'Primo montaggio');
    const saved = dialog.locator('li').filter({ hasText: 'Primo montaggio' });
    await expect(saved).toContainText('3 elementi');
    await saved.getByRole('button', { name: 'Rinomina', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Rinomina', exact: true }).fill('Taglio approvato');
    await dialog.getByRole('button', { name: 'Rinomina', exact: true }).first().click();
    await expect(dialog.getByText('Taglio approvato', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.getByTestId('canvas').dblclick({ position: { x: 950, y: 500 } });
    await page.keyboard.type('New live note');
    await page.keyboard.press('Escape');
    await expect(other.locator('[data-el]')).toHaveCount(4);
    const list = await openVersions(page);
    await list
      .locator('li')
      .filter({ hasText: 'Taglio approvato' })
      .getByRole('button', { name: 'Anteprima', exact: true })
      .click();
    await expect(page.getByRole('region', { name: 'Anteprima', exact: true })).toContainText(
      'Anteprima della versione del',
    );
    await expect(page.locator('[data-el]')).toHaveCount(3);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await page.getByTestId('canvas').dblclick({ position: { x: 950, y: 500 } });
    await page.keyboard.press('n');
    await expect(page.locator('[data-el]')).toHaveCount(3);
    await expect(other.locator('[data-el]')).toHaveCount(4);
    await page
      .getByRole('region', { name: 'Anteprima', exact: true })
      .getByRole('button', { name: 'Ripristina', exact: true })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Ripristinare questa versione?' });
    await expect(confirm).toContainText('modifiche offline');
    await confirm.getByRole('button', { name: 'Ripristina', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Anteprima', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-el]')).toHaveCount(3);
    await expect(other.locator('[data-el]')).toHaveCount(3);
    await expect(
      other
        .getByRole('status')
        .filter({ hasText: 'La board è stata ripristinata a Taglio approvato.' }),
    ).toBeVisible();
    const versions = await openVersions(page);
    await expect(versions.getByText('Prima del ripristino', { exact: true }).first()).toBeVisible();
    const named = versions.locator('li').filter({ hasText: 'Taglio approvato' });
    await named.getByRole('button', { name: 'Elimina', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Eliminare questa versione?' })
      .getByRole('button', { name: 'Elimina', exact: true })
      .click();
    await expect(versions.getByText('Taglio approvato', { exact: true })).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});

test('guest hiding inherits through containers, supports multi-select, undo and live updates', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project, column, child, note } = await seed(page, baseURL!);
  const otherContext = await browser.newContext({ locale: 'it-IT' });
  const other = await otherContext.newPage();
  try {
    await login(other, baseURL!);
    await other.goto(`/p/${project.id}`);
    await expect(other.locator('[data-el]')).toHaveCount(3);
    await page.locator(`[data-el="${column.id}"] .column__title`).click();
    await page.getByRole('button', { name: 'Nascondi agli ospiti', exact: true }).click();
    await expect(
      page.locator(`[data-el="${column.id}"] > .column__head > [data-guest-hidden="hidden"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-el="${child.id}"] > [data-guest-hidden="inherited"]`),
    ).toBeVisible();
    await expect(
      other.locator(`[data-el="${child.id}"] > [data-guest-hidden="inherited"]`),
    ).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('[data-guest-hidden]')).toHaveCount(0);
    await page.locator(`[data-el="${note.id}"]`).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Nascondi agli ospiti', exact: true }).click();
    await expect(
      page.locator(`[data-el="${note.id}"] > [data-guest-hidden="hidden"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-el="${column.id}"] > .column__head > [data-guest-hidden="hidden"]`),
    ).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('[data-guest-hidden]')).toHaveCount(0);
    // The context menu handles a card inside a column too.
    await page.locator(`[data-el="${child.id}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Nascondi agli ospiti', exact: true }).click();
    await expect(
      page.locator(`[data-el="${child.id}"] > [data-guest-hidden="hidden"]`),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(`[data-el="${child.id}"] > [data-guest-hidden="hidden"]`),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('version failures explain rate limits and let the editor recover', async ({
  page,
  baseURL,
}) => {
  await seed(page, baseURL!);
  const menuButton = page.getByRole('button', { name: 'Menu della board', exact: true });
  await menuButton.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await menuButton.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await menuButton.click();
  await expect(page.getByRole('menuitem', { name: 'Versioni della board' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  const dialog = await saveVersion(page, 'Recovery');
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.route('**/api/v1/boards/*/versions', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'limit' } }),
    }),
  );
  const list = await openVersions(page);
  await expect(list.getByRole('alert')).toContainText('Attendi prima di riprovare');
  await page.unroute('**/api/v1/boards/*/versions');
  await list.getByRole('button', { name: 'Ricarica elenco' }).click();
  await expect(list.getByRole('alert')).toHaveCount(0);
  await list
    .locator('li')
    .filter({ hasText: 'Recovery' })
    .getByRole('button', { name: 'Ripristina', exact: true })
    .click();
  await page.route('**/versions/*/restore', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'limit' } }),
    }),
  );
  const confirm = page.getByRole('dialog', { name: 'Ripristinare questa versione?' });
  await confirm.getByRole('button', { name: 'Ripristina', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('Attendi prima di riprovare');
  await confirm.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(page.locator('[data-el]')).toHaveCount(3);
});
