// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { createElement, type NewElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
/** With CHARACTER_SHOTS set, every state in every theme and size; in CI, the behaviour once. */
const shots = process.env.CHARACTER_SHOTS;
const LONG_NAME = 'Maria Antonietta Di Castelvecchio della Rovere';
const LONG_TEXT = 'Alta, capelli scuri raccolti, cicatrice sul sopracciglio destro. '.repeat(30);

async function png(page: Page, colour: string) {
  const bytes = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 320, 320);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, colour);
  return Buffer.from(bytes);
}

async function seed(page: Page, baseURL: string, theme: string) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Scheda personaggio', type: 'short_film' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const upload = async (name: string, colour: string) =>
    (await uploadFile(baseURL, cookie, project.id, {
      body: await png(page, colour),
      name,
      type: 'image/png',
    }))!;
  const assets = {
    portrait: await upload('marta.png', '#3a4e5c'),
    ref1: await upload('ref1.png', '#6a4e3c'),
    ref2: await upload('ref2.png', '#3c6a4e'),
    board: await upload('board.png', '#4e3c6a'),
  };
  await waitForAssets(baseURL, cookie, Object.values(assets));

  // The frames are on another board, as in a film project.
  const storyboard = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin: baseURL },
    data: { parentBoardId: project.rootBoardId, kind: 'storyboard', title: 'Storyboard' },
  });
  expect(storyboard.ok()).toBe(true);
  const storyboardId = (await storyboard.json()).id as string;
  const frames = createBoardDoc(storyboardId);
  const opts = { userId: null };
  const scene = createElement(
    frames,
    'scene',
    { x: 0, y: 0 },
    { number: '3A', title: 'Binario' },
    opts,
  );
  for (const x of [0, 400]) {
    const frame = createElement(frames, 'frame', { x, y: 0 }, { cast: ['MARTA FERRI'] }, opts);
    roots(frames).elements.get(frame.id)?.set('parent', scene.id);
  }
  await pushBoardDoc(baseURL, cookie, storyboardId, frames);

  const doc = createBoardDoc(project.rootBoardId);
  const add = (at: { x: number; y: number }, fields: NewElement<'character'>) =>
    createElement(doc, 'character', at, fields, opts);
  const paolo = add({ x: 60, y: 220 }, { name: 'Paolo Ferri', role: 'Coprotagonista', age: '41' });
  const hidden = add({ x: 60, y: 620 }, { name: 'Persona segreta', guestHidden: true });
  const ada = add(
    { x: 380, y: 220 },
    { name: 'Ada', role: 'Spalla', age: '36', actor: 'Elena Conti', scenes: ['1', '2'] },
  );
  const marta = add(
    { x: 60, y: 60 },
    {
      name: 'Marta Ferri',
      role: 'Protagonista',
      age: '34',
      assetId: assets.portrait,
      nickname: 'Mar',
      profession: 'Restauratrice',
      origin: 'Trieste',
      actor: 'Giulia Neri',
      appearance: 'Alta, capelli scuri raccolti.',
      references: [assets.ref1, assets.ref2],
      description: 'Torna in città dopo dieci anni.',
      wants: 'Chiudere con il passato.',
      fears: 'Scoprire la verità.',
      arc: 'Da chi scappa a chi resta.',
      costume: 'Giacca verde.',
      contact: 'Agenzia Lumen · 02 0000 0000',
      notes: 'Provino confermato il 12.',
      scenes: ['12'],
      relations: [
        { characterId: paolo.id, label: 'fratello' },
        { characterId: hidden.id, label: 'amante nascosta' },
      ],
    },
  );
  const long = add(
    { x: 60, y: 320 },
    {
      name: LONG_NAME,
      role: 'Antagonista',
      age: 'circa 60',
      nickname: LONG_NAME,
      profession: LONG_NAME,
      appearance: LONG_TEXT,
      relations: [{ characterId: paolo.id, label: LONG_NAME }],
    },
  );
  const locked = add({ x: 60, y: 440 }, { name: 'Bloccata', role: 'Comparsa', locked: true });
  const place = createElement(
    doc,
    'location',
    { x: 380, y: 420 },
    {
      name: 'Cabina del guardiano',
      setting: 'int',
      light: 'Lampada da tavolo',
      assetId: assets.ref1,
      address: 'Via dei Binari 4',
      notes: 'Le chiavi sono in portineria.',
      scenes: ['2'],
    },
    opts,
  );
  createElement(doc, 'image', { x: 700, y: 60 }, { assetId: assets.board }, opts);
  roots(doc).elements.get(ada.id)?.set('w', 300);
  await pushBoardDoc(baseURL, cookie, project.rootBoardId, doc);
  // The index that says which boards have frames follows the document by a few seconds.
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/api/v1/projects/${project.id}/cast-appearances?excludeBoardId=${project.rootBoardId}`,
            )
          ).json()
        ).items,
      { timeout: 30_000 },
    )
    .toContainEqual({ name: 'marta ferri', frames: 2, scenes: ['3A'] });
  return {
    cookie,
    project,
    assets,
    ids: {
      marta: marta.id,
      paolo: paolo.id,
      ada: ada.id,
      long: long.id,
      locked: locked.id,
      place: place.id,
    },
  };
}

/** Clicks a section open or closed. */
const toggle = (sheet: Locator, title: string) =>
  sheet.locator('summary', { hasText: title }).click();

const matrix = shots
  ? ([
      ['desktop', 1280, 900, 'light'],
      ['desktop', 1280, 900, 'dark'],
      ['phone', 390, 844, 'light'],
      ['phone', 390, 844, 'dark'],
    ] as const)
  : ([['desktop', 1280, 900, 'light']] as const);

for (const [device, width, height, theme] of matrix) {
  test(`character sheet ${device} ${theme}`, async ({ page, browser, baseURL }) => {
    test.setTimeout(shots ? 240_000 : 90_000);
    if (shots) mkdirSync(shots, { recursive: true });
    const shot = async (name: string, target: Page = page) => {
      if (shots) await target.screenshot({ path: `${shots}/${device}-${theme}-${name}.png` });
    };
    await page.setViewportSize({ width, height });
    const { cookie, project, assets, ids } = await seed(page, baseURL!, theme);
    const saved = async (id: string) => {
      const doc = await readBoard(baseURL!, cookie, project.rootBoardId);
      const map = roots(doc).elements.get(id);
      return map ? readElement(map) : null;
    };
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
    // An empty corner of the board on either screen.
    const emptyBoard = async () => {
      const box = (await page.locator('.canvas').boundingBox())!;
      await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
    };

    // The face: two sizes, one line for a long name, scenes merged from another board.
    const adaCard = page.locator(`[data-el="${ids.ada}"]`);
    await expect(adaCard).toContainText('Spalla · 36 anni');
    await expect(adaCard.getByText('Interprete: Elena Conti')).toBeVisible();
    await expect(adaCard.getByText('2 scene')).toBeVisible();
    const marta = page.locator(`[data-el="${ids.marta}"]`);
    await expect(marta).toContainText('Protagonista · 34 anni');
    await expect(marta.getByText('Interprete: Giulia Neri')).toBeHidden();
    const longCard = page.locator(`[data-el="${ids.long}"]`);
    const title = longCard.locator('.card__title');
    await expect.poll(() => title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await shot('faces');

    // Resizing: only the width, whatever the pointer does, and never unreadably narrow.
    const paoloCard = page.locator(`[data-el="${ids.paolo}"]`);
    await paoloCard.click();
    const before = (await paoloCard.boundingBox())!;
    const handle = page.locator('[data-handle="se"]');
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    // Short of 260 px, where the face would grow on purpose.
    await page.mouse.move(h.x + h.width / 2 + (15 * before.width) / 240, h.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await paoloCard.boundingBox())!.width)
      .toBeGreaterThan(before.width);
    expect((await paoloCard.boundingBox())!.height).toBeCloseTo(before.height, 0);
    const h2 = (await handle.boundingBox())!;
    await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x - 400, h2.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await saved(ids.paolo))?.w).toBe(160);
    await page.keyboard.press('Escape');

    // The sheet: sections with content open, Scenes merge the frames and the manual field.
    await marta.click();
    // The bar of the mockup: duplicate and delete are under "more".
    const bar = page.getByRole('toolbar', { name: 'Azioni sulla selezione' });
    await expect(bar.getByRole('button', { name: 'Duplica' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Elimina' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Altre azioni' }).click();
    await expect(page.getByRole('menuitem', { name: 'Duplica' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Elimina' })).toBeVisible();
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Scheda', exact: true }).click();
    const sheet = page.getByRole('complementary', { name: 'Scheda personaggio' });
    await expect(sheet.getByLabel('Soprannome')).toHaveValue('Mar');
    await expect(sheet.locator('summary', { hasText: 'Identità' })).toContainText('6 campi');
    await expect(sheet.locator('summary', { hasText: 'Aspetto' })).toContainText('2 riferimenti');
    await expect(sheet.locator('.story-panel__thumb img')).toHaveCount(2);
    await shot('identity');
    await toggle(sheet, 'Identità');
    await toggle(sheet, 'Aspetto');
    await toggle(sheet, 'Storia');
    await expect(sheet.getByLabel('Cosa vuole')).toHaveValue('Chiudere con il passato.');
    await toggle(sheet, 'Relazioni');
    await expect(
      sheet.getByRole('button', { name: 'Modifica la relazione con Paolo Ferri' }),
    ).toContainText('fratello');
    await shot('story-relations');
    await toggle(sheet, 'Storia');
    await toggle(sheet, 'Relazioni');
    await toggle(sheet, 'Scene');
    await expect(sheet.locator('.story-panel__scenes li')).toHaveText(['Sc. 3A', 'Sc. 12']);
    await expect(sheet.getByText('2 inquadrature')).toBeVisible();
    await expect(sheet.getByLabel('Scene manuali')).toHaveValue('12');
    await toggle(sheet, 'Solo team');
    await expect(sheet.getByLabel('Contatto (agenzia, telefono)')).toHaveValue(
      'Agenzia Lumen · 02 0000 0000',
    );
    await shot('scenes-team');
    await toggle(sheet, 'Scene');
    await toggle(sheet, 'Solo team');

    // Relations stay on this character alone.
    await toggle(sheet, 'Relazioni');
    // The list of characters closes without choosing, with Esc as well.
    await sheet.getByRole('button', { name: 'Aggiungi una relazione' }).click();
    await expect(sheet.getByRole('combobox', { name: 'Aggiungi una relazione' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet.getByRole('combobox', { name: 'Aggiungi una relazione' })).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Aggiungi una relazione' }).click();
    await sheet.getByRole('combobox', { name: 'Aggiungi una relazione' }).click();
    await page.getByRole('option', { name: 'Ada', exact: true }).click();
    // The label typed and left by clicking the board is saved, the panel closes.
    await sheet.getByRole('textbox', { name: 'Relazione con Ada' }).fill('vecchia amica');
    await emptyBoard();
    await expect(sheet).toHaveCount(0);
    await expect
      .poll(async () => ((await saved(ids.marta)) as { relations?: unknown[] }).relations?.length)
      .toBe(3);
    expect(await saved(ids.ada)).not.toHaveProperty('relations');

    // Notes typed and left by clicking the board are saved too.
    await marta.dblclick();
    await toggle(sheet, 'Solo team');
    await sheet.getByLabel('Note', { exact: true }).fill('Disponibile dal 12 maggio.');
    await emptyBoard();
    await expect(sheet).toHaveCount(0);
    await expect
      .poll(async () => ((await saved(ids.marta)) as { notes?: string }).notes)
      .toBe('Disponibile dal 12 maggio.');

    // The panel follows the selection: the draft stays on the first card, the panel moves on.
    await marta.dblclick();
    await toggle(sheet, 'Storia');
    await sheet.getByLabel('Cosa vuole').fill('Tornare a casa.');
    await adaCard.click();
    await expect(sheet.getByLabel('Nome', { exact: true })).toHaveValue('Ada');
    await expect
      .poll(async () => ((await saved(ids.marta)) as { wants?: string }).wants)
      .toBe('Tornare a casa.');
    expect(await saved(ids.ada)).not.toHaveProperty('wants');
    // Another kind of card, the location, has its own sheet; a card without one closes it.
    await emptyBoard();
    await expect(sheet).toHaveCount(0);
    await marta.dblclick();

    // "Dalla board" closes when told to: Esc leaves the sheet open.
    await sheet.getByRole('button', { name: 'Dalla board' }).click();
    const list = sheet.getByRole('list', { name: 'Dalla board' });
    await expect(list.locator('img').first()).toBeVisible();
    await shot('picker');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(sheet).toBeVisible();

    // A photo changes only when all its bytes have arrived.
    const photo = await png(page, '#7a5c2e');
    const file = sheet.locator('input[type="file"]');
    const assetId = async () => ((await saved(ids.marta)) as { assetId?: string }).assetId;

    // The bytes refused after the server created the asset: the old photo stays, with an error.
    await page.route('**/api/v1/uploads/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 403, body: '' })
        : route.continue(),
    );
    await file.setInputFiles({ name: 'refused.png', mimeType: 'image/png', buffer: photo });
    await expect(sheet.getByRole('alert')).toContainText('Foto non caricata');
    expect(await assetId()).toBe(assets.portrait);
    await shot('upload-error');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // "Dalla board" after the error: the error goes and the chosen picture shows, not the failed.
    await sheet.getByRole('alert').getByRole('button', { name: 'Dalla board' }).click();
    await sheet.getByRole('list', { name: 'Dalla board' }).getByRole('button').first().click();
    await expect(sheet.getByRole('alert')).toHaveCount(0);
    await expect.poll(assetId).toBe(assets.board);

    // Bytes on their way: progress and the local preview, the card unchanged until they land.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/uploads/*', async (route) => {
      if (route.request().method() === 'PATCH') await held;
      await route.continue();
    });
    await file.setInputFiles({ name: 'waiting.png', mimeType: 'image/png', buffer: photo });
    await expect(sheet.getByRole('status')).toContainText('Caricamento');
    await shot('uploading');
    expect(await assetId()).toBe(assets.board);
    release();
    await expect.poll(assetId).not.toBe(assets.board);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await expect
      .poll(() =>
        sheet
          .locator('.story-panel__picture img')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);

    // A reference: failed, it says so in its section; retried, it joins the list.
    await toggle(sheet, 'Aspetto');
    await page.route('**/api/v1/uploads/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 403, body: '' })
        : route.continue(),
    );
    await sheet.getByRole('button', { name: 'Aggiungi un riferimento' }).click();
    await file.setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: photo });
    await expect(sheet.getByRole('alert')).toContainText('reference.png');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await sheet.getByRole('alert').getByRole('button', { name: 'Riprova' }).click();
    await expect
      .poll(async () => ((await saved(ids.marta)) as { references?: string[] }).references?.length)
      .toBe(3);
    await toggle(sheet, 'Aspetto');
    await sheet.getByRole('button', { name: 'Chiudi la scheda' }).click();

    if (shots) {
      // Long name and long text, then a locked card, then a new one.
      await longCard.dblclick();
      await toggle(sheet, 'Storia');
      await expect(sheet.getByLabel('Nome', { exact: true })).toHaveValue(LONG_NAME);
      await shot('long');
      await sheet.getByRole('button', { name: 'Chiudi la scheda' }).click();
      await page.locator(`[data-el="${ids.locked}"]`).dblclick();
      await expect(sheet.getByText('Scheda bloccata')).toBeVisible();
      await shot('locked');
      await sheet.getByRole('button', { name: 'Chiudi la scheda' }).click();
      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Personaggio' }).click();
      await expect(sheet.getByLabel('Nome', { exact: true })).toBeFocused();
      await expect(sheet.locator('summary', { hasText: 'Identità' })).toContainText('vuota');
      await shot('empty');
      await sheet.getByRole('button', { name: 'Chiudi la scheda' }).click();
    }

    // A location has the same sections, no new fields; its picker closes with Esc and Chiudi.
    await page.locator(`[data-el="${ids.place}"]`).dblclick();
    const location = page.getByRole('complementary', { name: 'Scheda location' });
    await expect(location.locator('summary')).toHaveText([/Dettagli/, /Scene/, /Solo team/]);
    await expect(location.getByLabel('Luce e orario migliore')).toHaveValue('Lampada da tavolo');
    await expect(location.getByLabel('Indirizzo')).toBeHidden();
    await shot('location');
    const places = location.getByRole('list', { name: 'Dalla board' });
    await location.getByRole('button', { name: 'Dalla board' }).click();
    await expect(places).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(places).toHaveCount(0);
    await expect(location).toBeVisible();
    await location.getByRole('button', { name: 'Dalla board' }).click();
    await location.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(places).toHaveCount(0);
    await location.locator('summary', { hasText: 'Solo team' }).click();
    await location.getByLabel('Indirizzo').fill('Via dei Binari 5');
    await emptyBoard();
    await expect(location).toHaveCount(0);
    await expect
      .poll(async () => ((await saved(ids.place)) as { address?: string }).address)
      .toBe('Via dei Binari 5');

    // Guests: only what has content, nothing to edit, no contact, no notes.
    const link = await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
      headers: { origin: baseURL! },
      data: { role: 'guest_view', label: 'Produzione' },
    });
    expect(link.ok()).toBe(true);
    const guest = await browser.newContext({
      viewport: { width, height },
      locale: 'it-IT',
      colorScheme: theme,
    });
    const guestPage = await guest.newPage();
    await guestPage.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
    const received: string[] = [];
    guestPage.on('response', async (res) => {
      if (res.url().includes('/api/v1/guest') && res.request().method() === 'GET')
        received.push(await res.text().catch(() => ''));
    });
    await guestPage.goto((await link.json()).url);
    const guestMarta = guestPage.locator(`[data-el="${ids.marta}"]`);
    await expect(guestMarta).toBeVisible({ timeout: 20_000 });
    await guestMarta.dblclick();
    const guestSheet = guestPage.getByRole('complementary', { name: 'Scheda personaggio' });
    await expect(guestSheet).toContainText('Protagonista · 34 anni');
    await expect(guestSheet).toContainText('Interprete: Giulia Neri');
    await expect(guestSheet.locator('input:not([type="file"]), textarea')).toHaveCount(0);
    await expect(guestSheet.locator('summary', { hasText: 'Solo team' })).toHaveCount(0);
    await expect(guestSheet.locator('summary', { hasText: 'Storia' })).toHaveCount(1);
    const seen = received.join('\n');
    for (const secret of ['Agenzia Lumen', 'Provino confermato', 'amante nascosta'])
      expect(seen).not.toContain(secret);
    expect(seen).toContain('Restauratrice');
    await shot('guest', guestPage);
    await guest.close();
    await page.request.delete(`/api/v1/projects/${project.id}`, {
      headers: { origin: baseURL! },
    });
  });
}
