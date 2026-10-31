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
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-el]')).toHaveCount(3);
  return { project, column, child, note };
}

async function openVersions(page: Page) {
  // The clock icon in the header; the ⋯ menu lists Versions only on phones.
  await page.getByRole('button', { name: 'Versioni della board', exact: true }).click();
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
  const { project, note } = await seed(page, baseURL!);
  // A comment on a card: its badge belongs to the live board, never to a preview.
  await expect
    .poll(
      async () =>
        (
          await page.request.post(`/api/v1/boards/${project.rootBoardId}/comments`, {
            headers: { origin: baseURL! },
            data: { body: 'Da rivedere', elementId: note.id },
          })
        ).ok(),
      { timeout: 15_000 },
    )
    .toBe(true);
  const badge = page.locator(`[data-el="${note.id}"] .card-review`);
  await expect(badge).toBeVisible();
  const noteBox = await page.locator(`[data-el="${note.id}"]`).boundingBox();
  const badgeBox = await badge.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  if (badgeBox && noteBox) {
    expect(badgeBox.y).toBeGreaterThanOrEqual(noteBox.y);
  }
  const commentsButton = page.getByRole('button', { name: /^Commenti:/ });
  const secondContext = await browser.newContext({ locale: 'it-IT' });
  const other = await secondContext.newPage();
  try {
    await login(other, baseURL!);
    await other.goto(`/p/${project.id}`);
    await expect(other.locator('[data-el]')).toHaveCount(3);
    // An edit the other client can still undo when the version is saved.
    // An empty spot below the cards; the canvas starts at the window's edge (#333).
    await other.getByTestId('canvas').dblclick({ position: { x: 940, y: 498 } });
    await other.keyboard.type('Other early note');
    await other.keyboard.press('Escape');
    await expect(page.locator('[data-el]')).toHaveCount(4);
    const dialog = await saveVersion(page, 'Primo montaggio');
    const saved = dialog.locator('li').filter({ hasText: 'Primo montaggio' });
    await expect(saved).toContainText('4 elementi');
    await saved.getByRole('button', { name: 'Rinomina', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Nuovo nome della versione', exact: true })
      .fill('Taglio approvato');
    await dialog.getByRole('button', { name: 'Salva il nuovo nome', exact: true }).click();
    await expect(dialog.getByText('Taglio approvato', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.getByTestId('canvas').dblclick({ position: { x: 1190, y: 548 } });
    await page.keyboard.type('New live note');
    await page.keyboard.press('Escape');
    await expect(other.locator('[data-el]')).toHaveCount(5);
    const banner = page.getByRole('region', { name: 'Anteprima', exact: true });
    const previewVersion = async () => {
      const list = await openVersions(page);
      await list
        .locator('li')
        .filter({ hasText: 'Taglio approvato' })
        .getByRole('button', { name: 'Anteprima', exact: true })
        .click();
      await expect(list).toBeHidden();
      await expect(banner.getByText('Anteprima della versione del')).toBeFocused();
    };
    await previewVersion();
    await expect(page.locator('[data-el]')).toHaveCount(4);
    await expect(page.getByText('New live note')).toHaveCount(0);
    await expect(page.locator('.card-review, .comment-pin')).toHaveCount(0);
    await expect(commentsButton).toHaveCount(0);
    await page.locator(`[data-el="${note.id}"]`).click();
    await expect(page.getByRole('button', { name: 'Commenti e revisione' })).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await page.getByTestId('canvas').dblclick({ position: { x: 1190, y: 548 } });
    await page.keyboard.press('n');
    await expect(page.locator('[data-el]')).toHaveCount(4);
    await expect(other.locator('[data-el]')).toHaveCount(5);
    // Escape leaves the preview for the live board.
    await page.keyboard.press('Escape');
    await expect(banner).toHaveCount(0);
    await expect(page.getByText('New live note')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menu della board', exact: true })).toBeFocused();
    await expect(badge).toBeVisible();
    await expect(commentsButton).toBeVisible();
    await previewVersion();
    await banner.getByRole('button', { name: 'Ripristina', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Ripristinare questa versione?' });
    await expect(confirm).toContainText('modifiche offline');
    await confirm.getByRole('button', { name: 'Ripristina', exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByText('New live note')).toHaveCount(0);
    await expect(page.locator('[data-el]')).toHaveCount(4);
    await expect(other.locator('[data-el]')).toHaveCount(4);
    await expect(
      other
        .getByRole('status')
        .filter({ hasText: 'La board è stata ripristinata a Taglio approvato.' }),
    ).toBeVisible();
    // Undo history from before the restore is gone: the early note is not taken away again.
    for (const client of [other, page]) {
      await client.keyboard.press('ControlOrMeta+z');
      await client.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
    }
    await expect(page.getByText('Other early note')).toBeVisible();
    await expect(other.getByText('Other early note')).toBeVisible();
    await expect(other.locator('[data-el]')).toHaveCount(4);
    await expect(page.locator('[data-el]')).toHaveCount(4);
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
    const hide = page.getByRole('button', { name: 'Nascondi agli ospiti', exact: true });
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await hide.click();
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
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

test('viewers and commenters get no board menu, no guest hiding and no scene toggle', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project, note } = await seed(page, baseURL!);
  const origin = { origin: baseURL! };
  await page.keyboard.press('s');
  const storyboard = page.locator('[data-type="board"]', { hasText: 'Storyboard' });
  await expect(storyboard).toHaveCount(1);
  await page.keyboard.type('Scene private');
  await page.keyboard.press('Escape');
  await storyboard.dblclick();
  // The Storyboard template: one scene with three frames.
  const ownerScene = page.getByRole('region', { name: 'Scena 1' });
  await expect(ownerScene.locator('.story__tile')).toHaveCount(3);
  await expect(
    ownerScene.locator('header').getByRole('button', { name: 'Nascondi agli ospiti', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await ownerScene.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  await expect(page.locator('.story__tile')).toHaveCount(4);
  const storyboardUrl = page.url();

  const invited = await page.request.post('/api/v1/invitations', {
    headers: origin,
    data: { kind: 'link', projectId: project.id, role: 'commenter' },
  });
  expect(invited.ok()).toBe(true);
  const token = (await invited.json()).invitation.url.split('/').at(-1);
  const otherContext = await browser.newContext({ locale: 'it-IT' });
  const other = await otherContext.newPage();
  try {
    expect(
      (
        await other.request.post(`/api/v1/invitations/by-token/${token}/claim`, { headers: origin })
      ).ok(),
    ).toBe(true);
    const signUp = await other.request.post('/api/auth/sign-up/email', {
      headers: origin,
      data: {
        name: 'Marta Neri',
        email: `marta-${Date.now()}@example.com`,
        password: 'yet-another-horse-battery',
      },
    });
    expect(signUp.ok()).toBe(true);
    const userId = (await signUp.json()).user.id;
    for (const role of ['commenter', 'viewer']) {
      if (role === 'viewer') {
        const changed = await page.request.put(`/api/v1/projects/${project.id}/members/${userId}`, {
          headers: origin,
          data: { role },
        });
        expect(changed.ok()).toBe(true);
      }
      await other.goto(storyboardUrl);
      await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();
      await expect(other.getByRole('region', { name: 'Scena 1' })).toBeVisible();
      await expect(other.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Menu della board' })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Versioni della board' })).toHaveCount(0);
      await expect(other.locator('.story__tile')).toHaveCount(4);
      await other.getByRole('button', { name: 'Comprimi la scena' }).click();
      await expect(other.locator('.story__tile')).toHaveCount(0);
      await expect(page.locator('.story__tile')).toHaveCount(4);
      await other.getByRole('tab', { name: 'Shot list' }).click();
      await expect(other.getByRole('row', { name: /^1A\b/ })).toBeVisible();
      await expect(other.getByLabel('Azione', { exact: true }).first()).not.toBeEditable();
      await expect(other.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveCount(0);
      await other.goto(`/p/${project.id}`);
      await expect(other.getByRole('status').getByText('Sola lettura')).toBeVisible();
      await expect(other.locator('[data-el]')).toHaveCount(4);
      await expect(other.getByRole('button', { name: 'Menu della board' })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Versioni della board' })).toHaveCount(0);
      await other.locator(`[data-el="${note.id}"]`).click();
      await expect(other.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveCount(0);
      await other.locator(`[data-el="${note.id}"]`).click({ button: 'right' });
      await expect(other.getByRole('menuitem', { name: /ospiti/ })).toHaveCount(0);
      await other.keyboard.press('Escape');
    }
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
  await expect(page.getByRole('menuitem', { name: 'Esporta…' })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: 'Versioni della board' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  // A click elsewhere closes the menu and leaves focus where the person clicked.
  await menuButton.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByTestId('canvas').click({ position: { x: 900, y: 600 } });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).not.toBeFocused();
  const dialog = await saveVersion(page, 'Recovery');
  // Escape while a save is pending keeps the panel open until the answer arrives.
  let releaseSave = () => {};
  const saveHeld = new Promise<void>((done) => {
    releaseSave = done;
  });
  await page.route('**/api/v1/boards/*/versions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await saveHeld;
    await route.fallback();
  });
  await dialog.getByRole('textbox', { name: 'Nome della versione' }).fill('Held save');
  await dialog.getByRole('button', { name: 'Salva versione', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Chiudi', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  releaseSave();
  await expect(dialog.getByText('Held save', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Recovery', { exact: true })).toBeVisible();
  await page.unroute('**/api/v1/boards/*/versions');
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(dialog).toBeHidden();
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
  await page.unroute('**/versions/*/restore');

  // Escape during a pending restore keeps the confirmation, which shows the answer and can be
  // opened again afterwards.
  let releaseRestore = () => {};
  const restoreHeld = new Promise<void>((done) => {
    releaseRestore = done;
  });
  await page.route('**/versions/*/restore', async (route) => {
    await restoreHeld;
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'limit' } }),
    });
  });
  const restoreRecovery = list
    .locator('li')
    .filter({ hasText: 'Recovery' })
    .getByRole('button', { name: 'Ripristina', exact: true });
  await restoreRecovery.click();
  await confirm.getByRole('button', { name: 'Ripristina', exact: true }).click();
  await expect(confirm.getByRole('button', { name: 'Annulla', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeVisible();
  await expect(list).toBeVisible();
  releaseRestore();
  await expect(confirm.getByRole('alert')).toContainText('Attendi prima di riprovare');
  await confirm.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(confirm).toBeHidden();
  await restoreRecovery.click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('alert')).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Annulla', exact: true }).click();
  await page.unroute('**/versions/*/restore');
});

test('refreshing versions preserves uncertain save warnings without retrying', async ({
  page,
  baseURL,
}) => {
  await seed(page, baseURL!);
  const dialog = await saveVersion(page, 'Before uncertain save');
  let attempts = 0;
  const reasons = [undefined, { reason: 'outcome_unknown' }, { reason: 'later' }, 'malformed'];
  await page.route('**/api/v1/boards/*/versions', async (route) => {
    if (route.request().method() === 'POST') {
      const details = reasons[attempts++];
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Unconfirmed', details } }),
      });
    }
    const response = await route.fetch();
    const body = await response.json();
    // The visible metadata proves the refresh has rendered before checking the warning.
    body.items = body.items.map((v: { name: string | null }) =>
      v.name === 'Before uncertain save' ? { ...v, name: `Refreshed ${attempts}` } : v,
    );
    await route.fulfill({ response, json: body });
  });
  for (let i = 1; i <= reasons.length; i++) {
    await dialog.getByRole('textbox', { name: 'Nome della versione' }).fill(`Uncertain ${i}`);
    await dialog.getByRole('button', { name: 'Salva versione', exact: true }).click();
    await expect(dialog.getByText(`Refreshed ${i}`, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('prima di riprovare');
    expect(attempts).toBe(i);
  }
});

test('the versions panel follows other editors, and leaving a preview keeps the selection', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project, note } = await seed(page, baseURL!);
  const otherContext = await browser.newContext({ locale: 'it-IT' });
  const other = await otherContext.newPage();
  try {
    await login(other, baseURL!);
    await other.goto(`/p/${project.id}`);
    await expect(other.locator('[data-el]')).toHaveCount(3);
    const otherList = await openVersions(other);
    await expect(otherList).toBeVisible();

    // Saved, renamed and deleted elsewhere: the open panel follows without a reload.
    const dialog = await saveVersion(page, 'Da un altro editor');
    await expect(otherList.getByText('Da un altro editor', { exact: true })).toBeVisible();
    const saved = dialog.locator('li').filter({ hasText: 'Da un altro editor' });
    await saved.getByRole('button', { name: 'Rinomina', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Nuovo nome della versione', exact: true })
      .fill('Rinominata altrove');
    await dialog.getByRole('button', { name: 'Salva il nuovo nome', exact: true }).click();
    await expect(otherList.getByText('Rinominata altrove', { exact: true })).toBeVisible();
    await expect(otherList.getByText('Da un altro editor', { exact: true })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Nome della versione' }).fill('Da eliminare');
    await dialog.getByRole('button', { name: 'Salva versione', exact: true }).click();
    const extra = dialog;
    await expect(otherList.getByText('Da eliminare', { exact: true })).toBeVisible();
    await extra
      .locator('li')
      .filter({ hasText: 'Da eliminare' })
      .getByRole('button', { name: 'Elimina', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Eliminare questa versione?' })
      .getByRole('button', { name: 'Elimina', exact: true })
      .click();
    await expect(otherList.getByText('Da eliminare', { exact: true })).toHaveCount(0);
    await extra.getByRole('button', { name: 'Chiudi', exact: true }).click();

    // Escape closes the menu or the panel opened over a preview, and only then the preview.
    const hide = page.getByRole('button', { name: 'Nascondi agli ospiti', exact: true });
    await page.locator(`[data-el="${note.id}"]`).click();
    await expect(hide).toBeVisible();
    const banner = page.getByRole('region', { name: 'Anteprima', exact: true });
    const list = await openVersions(page);
    await list
      .locator('li')
      .filter({ hasText: 'Rinominata altrove' })
      .getByRole('button', { name: 'Anteprima', exact: true })
      .click();
    await expect(banner).toBeVisible();
    const menuButton = page.getByRole('button', { name: 'Menu della board', exact: true });
    await menuButton.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(banner).toBeVisible();
    const again = await openVersions(page);
    await expect(again).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(again).toBeHidden();
    await expect(banner).toBeVisible();
    // Dialog visibility changes before its focus restoration finishes. Wait until the
    // closed dialog no longer owns focus, otherwise its Escape can swallow this key.
    await expect(page.locator('dialog[open], [role="menu"]')).toHaveCount(0);
    // Focus goes back to the control that opened the dialog: the clock icon.
    await expect(
      page.getByRole('button', { name: 'Versioni della board', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(banner).toHaveCount(0);
    // The live selection is the one from before the preview.
    await expect(hide).toBeVisible();
    await expect(hide).toHaveAttribute('aria-pressed', 'false');

    // A restore names a version that is gone with the generic text, and refreshes the panel.
    await other.route('**/api/v1/boards/*/versions/*', (route) =>
      route.request().method() === 'GET' && !route.request().url().endsWith('/state')
        ? route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'not_found', message: 'Version not found.' } }),
          })
        : route.fallback(),
    );
    const restoreList = await openVersions(page);
    await restoreList
      .locator('li')
      .filter({ hasText: 'Rinominata altrove' })
      .getByRole('button', { name: 'Ripristina', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Ripristinare questa versione?' })
      .getByRole('button', { name: 'Ripristina', exact: true })
      .click();
    await expect(
      other
        .getByRole('status')
        .filter({ hasText: 'La board è stata ripristinata a una versione salvata.' }),
    ).toBeVisible();
    await expect(
      otherList.getByText('Prima del ripristino', { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('storyboard and shot list preview a version read-only, and editors hide frames from guests', async ({
  page,
  baseURL,
}) => {
  await seed(page, baseURL!);
  await page.keyboard.press('s');
  const card = page.locator('[data-type="board"]', { hasText: 'Storyboard' });
  await page.keyboard.type('Preview film');
  await page.keyboard.press('Escape');
  await card.dblclick();
  const scene = page.getByRole('region', { name: 'Scena 1' });
  await expect(scene.locator('.story__tile')).toHaveCount(3);
  await scene.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  const panel = page.getByRole('complementary', { name: 'Dettagli' });
  const action = panel.getByLabel('Azione', { exact: true });
  await action.fill('Azione salvata');
  await action.press('Tab');
  await expect(page.locator('.story__tile-action')).toHaveText('Azione salvata');
  const dialog = await saveVersion(page, 'Storyboard v1');
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await action.fill('Azione dal vivo');
  await action.press('Tab');
  await expect(page.locator('.story__tile-action')).toHaveText('Azione dal vivo');

  const banner = page.getByRole('region', { name: 'Anteprima', exact: true });
  const list = await openVersions(page);
  await list
    .locator('li')
    .filter({ hasText: 'Storyboard v1' })
    .getByRole('button', { name: 'Anteprima', exact: true })
    .click();
  await expect(banner).toBeVisible();
  const previewScene = page.getByRole('region', { name: 'Scena 1' });
  await expect(page.locator('.story__tile-action')).toHaveText('Azione salvata');
  await expect(page.getByRole('button', { name: 'Nuova scena' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuova inquadratura' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveCount(0);
  // Folding a scene of the preview is local to it.
  await previewScene.getByRole('button', { name: 'Comprimi la scena' }).click();
  await expect(page.locator('.story__tile-action')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Shot list' }).click();
  await expect(banner).toBeVisible();
  const row = page.getByRole('row', { name: /1D/ });
  await expect(row.getByLabel('Azione', { exact: true })).toHaveValue('Azione salvata');
  await expect(row.getByLabel('Azione', { exact: true })).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Nascondi agli ospiti' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(banner).toHaveCount(0);
  await expect(row.getByLabel('Azione', { exact: true })).toHaveValue('Azione dal vivo');
  const hideRow = row.getByRole('button', { name: 'Nascondi agli ospiti', exact: true });
  await expect(hideRow).toHaveAttribute('aria-pressed', 'false');
  await hideRow.click();
  await expect(hideRow).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Storyboard' }).click();
  // The live scene was never folded.
  const tile = page.locator('.story__tile').filter({ hasText: 'Azione dal vivo' });
  await expect(tile.locator('.story__tile-action')).toHaveText('Azione dal vivo');
  const hideTile = tile.getByRole('button', { name: 'Nascondi agli ospiti', exact: true });
  await expect(hideTile).toHaveAttribute('aria-pressed', 'true');
  await hideTile.click();
  await expect(hideTile).toHaveAttribute('aria-pressed', 'false');
});

test('card badges stay clear of the header of a column and inside other cards', async ({
  page,
  baseURL,
}) => {
  const { project, column, note } = await seed(page, baseURL!);
  for (const elementId of [column.id, note.id]) {
    await expect
      .poll(
        async () =>
          (
            await page.request.post(`/api/v1/boards/${project.rootBoardId}/comments`, {
              headers: { origin: baseURL! },
              data: { body: 'Da rivedere', elementId },
            })
          ).ok(),
        { timeout: 15_000 },
      )
      .toBe(true);
  }
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const columnCard = page.locator(`[data-el="${column.id}"]`);
  const columnBadge = columnCard.locator(':scope > .card-review');
  await expect(columnBadge).toBeVisible();
  const badgeBox = (await columnBadge.boundingBox())!;
  for (const part of ['.column__title', '.column__count', '.column__toggle']) {
    const box = await columnCard.locator(part).first().boundingBox();
    expect(box, part).not.toBeNull();
    expect(overlaps(badgeBox, box!), `${part} is covered by the badges`).toBe(false);
  }
  const noteCard = page.locator(`[data-el="${note.id}"]`);
  await expect(noteCard.locator('.card-review')).toBeVisible();
  const noteBox = (await noteCard.boundingBox())!;
  const noteBadge = (await noteCard.locator('.card-review').boundingBox())!;
  expect(noteBadge.y).toBeGreaterThanOrEqual(noteBox.y);
  expect(noteBadge.x + noteBadge.width).toBeLessThanOrEqual(noteBox.x + noteBox.width);
});

test('visible header icon button opens the versions dialog', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  const headerButton = page.getByRole('button', { name: 'Versioni della board', exact: true });
  await expect(headerButton).toBeVisible();
  await headerButton.click();
  const dialog = page.getByRole('dialog', { name: 'Versioni della board', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(dialog).toBeHidden();
});
