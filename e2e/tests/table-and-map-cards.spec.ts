// SPDX-License-Identifier: AGPL-3.0-only
// Table cards (#317), map cards and GPX routes (#319). Map tiles come from the stand-in tile
// server of playwright.config.ts. Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, newTable, tableGrid } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const out = process.env.TABLE_MAP_SHOTS ?? join(tmpdir(), 'inkadra-table-map');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
const OSM = 'https://www.openstreetmap.org/?mlat=46.3349&mlon=9.5512#map=14/46.3349/9.5512';

/** A winding climb of about 20 km, from 800 to 1850 m, with a little GPS noise. */
function trailGpx(): string {
  const points: string[] = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const lat = 46.305 + 0.06 * t + 0.008 * Math.sin(t * 9);
    const lon = 9.42 + 0.18 * t + 0.01 * Math.cos(t * 7);
    const ele = 800 + 1050 * t ** 1.3 + (i % 3) - 1;
    points.push(
      `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Val Bregaglia Trail</name><trkseg>${points.join('')}</trkseg></trk></gpx>`;
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
  const headers = { origin: baseURL };
  const created = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Sopralluoghi Val Bregaglia' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;

  const gpx = await uploadFile(baseURL, cookie, project.id, {
    body: Buffer.from(trailGpx()),
    name: 'val-bregaglia-trail.gpx',
    type: 'application/gpx+xml',
  });
  expect(gpx).toBeTruthy();
  // The server places the link and composites its map, as for a pasted link.
  const preview = await page.request.post('/api/v1/map-previews', {
    headers,
    data: { projectId: project.id, url: OSM },
  });
  expect(preview.ok()).toBe(true);
  const place = await preview.json();
  expect(place).toMatchObject({ lat: 46.3349, lon: 9.5512, zoom: 14 });
  await waitForAssets(baseURL, cookie, [gpx as string, place.imageAssetId]);

  const doc = createBoardDoc(root);
  const fields = newTable(4, 4);
  const [c0, c1, c2, c3] = fields.columns.map((c) => c.id) as [string, string, string, string];
  const rows: string[][] = [
    ['Operatore', 'Zona', 'Cosa riprendere', 'Mappa'],
    ['Matteo', 'Lagunc', 'Arrivi e interviste', 'https://maps.app.goo.gl/lagunc'],
    ['Niccolò', 'Loreto → Lagunc', 'Partenze, salita', 'https://maps.app.goo.gl/loreto'],
    ['Riccardo', 'Pianazzola', 'Sentiero e paese', 'https://maps.app.goo.gl/pianazzola'],
  ];
  fields.rows.forEach((row, r) => {
    const cells = rows[r] as string[];
    row.cells = { [c0]: cells[0]!, [c1]: cells[1]!, [c2]: cells[2]!, [c3]: cells[3]! };
  });
  fields.columns[0]!.width = 90;
  fields.columns[3]!.width = 120;
  const table = createElement(
    doc,
    'table',
    { x: 60, y: 60 },
    { ...fields, header: true, color: 'orange', w: 460 },
    opts,
  );
  const map = createElement(
    doc,
    'map',
    { x: 560, y: 60 },
    {
      name: 'Rifugio Lagunc',
      address: 'Lagunc, Val Bregaglia',
      url: OSM,
      lat: place.lat,
      lon: place.lon,
      zoom: place.zoom,
      imageAssetId: place.imageAssetId,
      w: 240,
    },
    opts,
  );
  const file = createElement(
    doc,
    'file',
    { x: 830, y: 60 },
    { assetId: gpx as string, w: 260 },
    opts,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { cookie, project, ids: { table: table.id, map: map.id, file: file.id } };
}

for (const theme of ['dark', 'light'] as const) {
  test(`table, map and GPX cards (${theme})`, async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const { cookie, project, ids } = await seed(page, baseURL!, theme);
    const root = project.rootBoardId as string;
    await page.goto(`/p/${project.id}?view=canvas`);
    const el = (id: string) => page.locator(`[data-el="${id}"]`);
    const saved = async (id: string) => {
      const doc = await readBoard(baseURL!, cookie, root);
      const map = roots(doc).elements.get(id);
      return (map ? readElement(map) : null) as Extract<Element, { type: 'table' }> | null;
    };

    // The table: a tinted header row, plain cells, links shown by host.
    const table = el(ids.table);
    await expect(table.locator('th')).toHaveText(['Operatore', 'Zona', 'Cosa riprendere', 'Mappa']);
    await expect(table.locator('.tcard__grid')).toHaveClass(/tcard__grid--orange/);
    await expect(table.getByRole('link', { name: 'maps ↗' })).toHaveCount(3);
    await expect(table.getByRole('link').first()).toHaveAttribute(
      'href',
      'https://maps.app.goo.gl/lagunc',
    );

    // The map card: its picture, a pin, the credit and "Open in Maps".
    const map = el(ids.map);
    await expect(map.locator('img')).toBeVisible();
    await expect(map.locator('.mcard__pin')).toBeVisible();
    await expect(map).toContainText('Rifugio Lagunc');
    await expect(map.getByRole('link', { name: 'Apri in Mappe ↗' })).toHaveAttribute('href', OSM);

    // The GPX file: the route over its map, length and climb in the footer.
    const gpx = el(ids.file);
    await expect(gpx.locator('.fbadge')).toHaveText('GPX');
    await expect(gpx.locator('.mcard__track polyline').last()).toBeVisible();
    await expect(gpx.locator('img')).toBeVisible();
    await expect(gpx.locator('.fcard__meta-text')).toHaveText(/^\d+(,\d)? km · \+10\d\d m$/);
    await page.mouse.click(1200, 700);
    await page.screenshot({ path: join(out, `desktop-${theme}.png`) });

    // Editing: Tab moves along the row, Enter down; typed text is saved per cell.
    await table.locator('td', { hasText: 'Arrivi e interviste' }).dblclick();
    const cell = (r: number, c: number) => page.getByLabel(`Riga ${r}, colonna ${c}`);
    // The cell double-clicked takes the focus, its text selected.
    await expect(cell(2, 3)).toBeFocused();
    await page.keyboard.type('Arrivi, interviste e premiazione');
    await page.keyboard.press('Tab');
    await expect(cell(2, 4)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cell(3, 4)).toBeFocused();
    await page.screenshot({ path: join(out, `desktop-${theme}-editing.png`) });

    if (theme === 'dark') {
      // A spreadsheet range pasted into the last row fills it and adds the rows it needs.
      await cell(4, 1).focus();
      await cell(4, 1).evaluate((input) => {
        const data = new DataTransfer();
        data.setData('text/plain', 'Luca\tCasaccia\tDrone\nSara\tSoglio\t"Paese,\nfontane"\n');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      });
      await expect(table.locator('tr')).toHaveCount(5);
      await page.keyboard.press('Escape');
      await expect
        .poll(async () => {
          const t = await saved(ids.table);
          return t
            ? tableGrid(t)
                .slice(1)
                .map((r) => r.slice(0, 3))
            : null;
        })
        .toEqual([
          ['Matteo', 'Lagunc', 'Arrivi, interviste e premiazione'],
          ['Niccolò', 'Loreto → Lagunc', 'Partenze, salita'],
          ['Luca', 'Casaccia', 'Drone'],
          ['Sara', 'Soglio', 'Paese,\nfontane'],
        ]);

      // The cell menu inserts a row under the cell it was opened on, and deletes it again.
      await table.locator('td', { hasText: 'Niccolò' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Inserisci riga sotto' }).click();
      await expect(table.locator('tr')).toHaveCount(6);
      await expect(table.locator('tr').nth(3)).toHaveText('');
      await table.locator('tr').nth(3).locator('td').first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Elimina riga' }).click();
      await expect(table.locator('tr')).toHaveCount(5);

      // A map card from the Canvas menu: the link is placed and its map made by the server.
      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Mappa' }).click();
      await page
        .getByLabel('Indirizzo o link di una mappa')
        .fill('https://www.google.com/maps/place/Soglio/@46.3407,9.5383,15z');
      await page.keyboard.press('Enter');
      const fresh = page.locator('[data-type="map"]', { hasText: 'Soglio' });
      await expect(fresh.locator('img')).toBeVisible({ timeout: 20_000 });
      await expect(fresh.getByRole('link', { name: 'Apri in Mappe ↗' })).toHaveAttribute(
        'href',
        /google\.com\/maps\/place\/Soglio/,
      );
    }

    // Phones: the same cards, rows 44 px tall for fingers.
    await page.keyboard.press('Escape');
    const state = await page.context().storageState();
    // No second cursor of the same person in the phone's shots.
    await page.close();
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: 'it-IT',
      colorScheme: theme,
      reducedMotion: 'reduce',
      storageState: state,
    });
    try {
      const mobile = await phone.newPage();
      await mobile.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await mobile.goto(`${baseURL}/p/${project.id}?view=canvas`);
      const head = mobile.locator(`[data-el="${ids.table}"] th`).first();
      await expect(head).toBeVisible();
      expect(await head.evaluate((cell) => getComputedStyle(cell).height)).toBe('44px');
      await mobile.screenshot({ path: join(out, `phone-${theme}.png`) });
      // The map and the route, further right on the board.
      await mobile.getByRole('button', { name: 'Adatta alla vista' }).click();
      for (let i = 0; i < 2; i++) await mobile.getByRole('button', { name: 'Ingrandisci' }).click();
      await mobile.screenshot({ path: join(out, `phone-${theme}-all.png`) });
    } finally {
      await phone.close();
    }
  });
}
