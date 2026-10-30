// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const out = fileURLToPath(new URL('../../docs/screenshots/0.6-cards/', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** Fictional pictures drawn in the browser: a portrait silhouette and a night platform. */
async function pictures(page: Page) {
  const drawn = await page.evaluate(async () => {
    const make = async (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      draw(ctx);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    };
    const portrait = (bg: string, fg: string) => (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(320, 190, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(320, 470, 190, 160, 0, Math.PI, 0);
      ctx.fill();
    };
    return {
      marta: await make(portrait('#3a4e5c', '#d6af6a')),
      leo: await make(portrait('#4a3b33', '#9fb4c2')),
      station: await make((ctx) => {
        ctx.fillStyle = '#142330';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#20394a';
        ctx.fillRect(0, 260, 640, 220);
        ctx.fillStyle = '#d6af6a';
        for (let i = 0; i < 6; i++) ctx.fillRect(40 + i * 100, 120, 6, 140);
        ctx.fillRect(0, 380, 640, 5);
      }),
    };
  });
  return Object.fromEntries(
    Object.entries(drawn).map(([k, v]) => [k, Buffer.from(v)]),
  ) as Record<keyof typeof drawn, Buffer>;
}

async function seed(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Ultimo Treno', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  const pics = await pictures(page);
  const upload = async (name: string, body: Buffer) =>
    (await uploadFile(baseURL, cookie, project.id, { body, name, type: 'image/png' }))!;
  const ids = {
    marta: await upload('marta.png', pics.marta),
    leo: await upload('leo.png', pics.leo),
    station: await upload('stazione.png', pics.station),
  };
  await waitForAssets(baseURL, cookie, Object.values(ids));
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null };
  const marta = createElement(
    doc,
    'character',
    { x: 60, y: 60 },
    {
      name: 'Marta',
      role: 'Capotreno, protagonista',
      assetId: ids.marta,
      age: '34',
      description: 'Aspetta ogni notte l’ultimo treno, che non arriva mai.',
      actor: 'Giulia Neri',
      contact: 'Agenzia Lumen · 02 0000 0000',
      notes: 'Provino confermato il 12.',
      scenes: ['1', '3', '5'],
    },
    opts,
  );
  createElement(
    doc,
    'character',
    { x: 60, y: 200 },
    {
      name: 'Leo',
      role: 'Guardiano notturno',
      assetId: ids.leo,
      age: 'circa 60',
      actor: 'Marco Riva',
      scenes: ['2', '3'],
    },
    opts,
  );
  createElement(
    doc,
    'location',
    { x: 360, y: 60 },
    {
      name: 'Stazione Centrale',
      setting: 'int-ext',
      assetId: ids.station,
      address: 'Piazza della Stazione 1',
      mapUrl: 'https://www.openstreetmap.org/',
      light: 'Blu del crepuscolo, poi neon dei binari',
      availability: 'Solo dopo l’ultima corsa, 0:30–5:00',
      contact: 'Ufficio permessi',
      scenes: ['1', '5'],
    },
    opts,
  );
  const cabin = createElement(
    doc,
    'location',
    { x: 680, y: 60 },
    {
      name: 'Cabina del guardiano',
      setting: 'int',
      light: 'Lampada da tavolo, luce calda',
      notes: 'Le chiavi sono in portineria.',
      scenes: ['2'],
    },
    opts,
  );
  const frame = createElement(doc, 'frame', { x: 680, y: 260 }, { action: 'Marta guarda il tabellone vuoto.' }, opts);
  await pushBoardDoc(baseURL, cookie, project.rootBoardId, doc);
  return { cookie, project, ids: { marta: marta.id, cabin: cabin.id, frame: frame.id } };
}

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 412, 915],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`character and location cards ${device} ${theme}`, async ({ page, browser, baseURL }) => {
      test.setTimeout(120_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height });
      const { cookie, project, ids } = await seed(page, baseURL!, theme);
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      const marta = page.locator(`[data-el="${ids.marta}"]`);
      await expect(marta).toContainText('Marta');
      await expect(marta).toContainText('Capotreno, protagonista');
      await expect(marta.locator('img')).toBeVisible();
      await expect(page.locator(`[data-el="${ids.cabin}"]`)).toContainText('INT.');
      await page.screenshot({ path: `${out}/${device}-${theme}-canvas.png` });

      // The side sheet: every field, the private ones under "Solo team".
      await marta.dblclick();
      const sheet = page.getByRole('complementary', { name: 'Scheda personaggio' });
      await expect(sheet.getByLabel('Nome', { exact: true })).toHaveValue('Marta');
      await expect(sheet.getByLabel('Interprete')).toHaveValue('Giulia Neri');
      await expect(sheet.getByRole('heading', { name: 'Solo team' })).toBeVisible();
      await expect(sheet.getByLabel('Contatto (agenzia, telefono)')).toHaveValue(
        'Agenzia Lumen · 02 0000 0000',
      );
      await page.screenshot({ path: `${out}/${device}-${theme}-character.png` });
      await sheet.getByRole('button', { name: 'Chiudi la scheda' }).click();

      await page.locator(`[data-el="${ids.cabin}"]`).dblclick();
      const place = page.getByRole('complementary', { name: 'Scheda location' });
      await expect(place.getByLabel('Interno o esterno')).toHaveValue('int');
      await place.getByLabel('Indirizzo').fill('Via dei Binari 4');
      await place.getByLabel('Indirizzo').blur();
      await expect(
        place.getByRole('link', { name: 'Cerca l’indirizzo su OpenStreetMap' }),
      ).toHaveAttribute('href', /openstreetmap\.org\/search\?query=Via%20dei%20Binari%204/);
      await page.screenshot({ path: `${out}/${device}-${theme}-location.png` });
      await place.getByRole('button', { name: 'Chiudi la scheda' }).click();

      if (device === 'desktop' && theme === 'dark') {
        // A new character from the Canvas menu opens its sheet with the name to type.
        await page.getByRole('button', { name: 'Canvas', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Personaggio' }).click();
        const fresh = page.getByRole('complementary', { name: 'Scheda personaggio' });
        await expect(fresh.getByLabel('Nome', { exact: true })).toBeFocused();
        await page.keyboard.type('Bigliettaia');
        await fresh.getByLabel('Ruolo nella storia').click();
        await page.keyboard.type('Comparsa');
        await fresh.getByLabel('Età').click();
        await expect(page.locator('[data-type="character"]', { hasText: 'Bigliettaia' })).toContainText(
          'Comparsa',
        );
        await fresh.getByRole('button', { name: 'Chiudi la scheda' }).click();

        // The frame's cast links to character cards by name; free text stays.
        await page.locator(`[data-el="${ids.frame}"]`).dblclick();
        const panel = page.getByRole('complementary', { name: 'Dettagli', exact: true });
        await panel.getByLabel('Personaggi', { exact: true }).fill('Passeggero');
        await panel.getByLabel('Personaggi', { exact: true }).blur();
        await panel.getByRole('button', { name: 'Aggiungi Marta al cast' }).click();
        await expect(panel.getByLabel('Personaggi', { exact: true })).toHaveValue('Passeggero, Marta');
        await expect(panel.getByRole('button', { name: 'Marta è nel cast' })).toBeDisabled();

        await expect
          .poll(async () => {
            const saved = await readBoard(baseURL!, cookie, project.rootBoardId);
            const map = roots(saved).elements.get(ids.frame);
            return map ? readElement(map) : null;
          })
          .toMatchObject({ cast: ['Passeggero', 'Marta'] });

        // Search finds characters by actor, as cards of their own type.
        await page.keyboard.press('Control+k');
        await page.getByRole('combobox', { name: 'Cerca' }).fill('Giulia Neri');
        await expect(page.getByRole('option', { name: /Marta/ })).toBeVisible();
        await page.keyboard.press('Escape');
      }

      // Guests see the faces, never contacts, notes or addresses.
      const created = await page.request.post(
        `/api/v1/boards/${project.rootBoardId}/share-links`,
        { headers: { origin: baseURL! }, data: { role: 'guest_view', label: 'Produzione' } },
      );
      expect(created.ok()).toBe(true);
      const { url } = await created.json();
      const guest = await browser.newContext({
        viewport: { width, height },
        locale: 'it-IT',
        colorScheme: theme,
      });
      const guestPage = await guest.newPage();
      await guestPage.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      const snapshots: string[] = [];
      guestPage.on('response', async (res) => {
        if (res.url().includes('/api/v1/guest') && res.request().method() === 'GET')
          snapshots.push(await res.text().catch(() => ''));
      });
      await guestPage.goto(url);
      await expect(guestPage.locator('[data-type="character"]').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(guestPage.locator(`[data-el="${ids.marta}"]`)).toContainText('Giulia Neri');
      const seen = snapshots.join('\n');
      for (const secret of ['Agenzia Lumen', 'Provino', 'Piazza della Stazione', 'portineria'])
        expect(seen).not.toContain(secret);
      await guestPage.screenshot({ path: `${out}/${device}-${theme}-guest.png` });
      await guest.close();
      await page.request.delete(`/api/v1/projects/${project.id}`, { headers: { origin: baseURL! } });
    });
  }
}
