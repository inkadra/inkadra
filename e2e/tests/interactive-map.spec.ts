// SPDX-License-Identifier: AGPL-3.0-only
// Exploring a map card (#373): "Esplora" turns the picture into a map that pans and zooms, with
// tiles from Inkadra only (the stand-in tile server of playwright.config.ts behind it). Runs
// after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const out = process.env.INTERACTIVE_MAP_SHOTS ?? join(tmpdir(), 'inkadra-interactive-map');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const OSM = 'https://www.openstreetmap.org/?mlat=46.3349&mlon=9.5512#map=14/46.3349/9.5512';

function trailGpx(): string {
  const points: string[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const lat = 46.305 + 0.06 * t + 0.008 * Math.sin(t * 9);
    const lon = 9.42 + 0.18 * t + 0.01 * Math.cos(t * 7);
    points.push(
      `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${800 + 1000 * t}</ele></trkpt>`,
    );
  }
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
}

async function seed(page: Page, baseURL: string) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  const headers = { origin: baseURL };
  const created = await page.request.post(`${baseURL}/api/v1/projects`, {
    headers,
    data: { name: 'Mappe da esplorare' },
  });
  const project = await created.json();
  const root = project.rootBoardId as string;
  const gpx = await uploadFile(baseURL, cookie, project.id, {
    body: Buffer.from(trailGpx()),
    name: 'sentiero.gpx',
    type: 'application/gpx+xml',
  });
  const preview = await page.request.post(`${baseURL}/api/v1/map-previews`, {
    headers,
    data: { projectId: project.id, url: OSM },
  });
  const place = await preview.json();
  await waitForAssets(baseURL, cookie, [gpx as string, place.imageAssetId]);
  const doc = createBoardDoc(root);
  const opts = { userId: null };
  const map = createElement(
    doc,
    'map',
    { x: 60, y: 60 },
    {
      name: 'Rifugio Lagunc',
      url: OSM,
      lat: place.lat,
      lon: place.lon,
      zoom: place.zoom,
      imageAssetId: place.imageAssetId,
      w: 420,
    },
    opts,
  );
  const file = createElement(
    doc,
    'file',
    { x: 540, y: 60 },
    { assetId: gpx as string, w: 420 },
    opts,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { cookie, project, root, map: map.id, file: file.id };
}

/** Opens a page of the board in a theme, recording a video when asked. */
async function board(context: BrowserContext, url: string, theme: 'light' | 'dark') {
  const page = await context.newPage();
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto(url);
  return page;
}

test('explores a map card in place: pan, drag by the frame, Esc', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(150_000);
  mkdirSync(out, { recursive: true });
  const seeded = await seed(page, baseURL!);
  const state = await page.context().storageState();
  await page.close();

  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'it-IT',
      colorScheme: theme,
      reducedMotion: 'reduce',
      storageState: state,
      ...(theme === 'dark'
        ? { recordVideo: { dir: out, size: { width: 1280, height: 800 } } }
        : {}),
    });
    const elsewhere: string[] = [];
    context.on('request', (req) => {
      if (/^https?:/.test(req.url()) && !req.url().startsWith(baseURL!)) elsewhere.push(req.url());
    });
    const desk = await board(context, `${baseURL}/p/${seeded.project.id}?view=canvas`, theme);
    const card = desk.locator(`[data-el="${seeded.map}"]`);
    const explore = card.getByRole('button', { name: 'Esplora la mappa di Rifugio Lagunc' });
    await expect(explore).toBeVisible({ timeout: 20_000 });
    await desk.screenshot({ path: join(out, `desktop-${theme}-static.png`) });

    const tiles = desk.waitForResponse(
      (res) => res.url().includes('/api/v1/map-tiles/') && res.ok(),
    );
    await explore.click();
    const live = card.locator('[data-explored]');
    await expect(live).toBeVisible();
    await tiles;
    await expect(card.locator('.leaflet-tile-loaded').first()).toBeVisible();
    await expect(card.locator('.mcard__live-pin')).toBeVisible();
    await expect(card.locator('.mcard__credit')).toHaveText('© OpenStreetMap contributors');

    // Dragging inside the map pans it; the card stays where it was.
    const xOf = async () => {
      const doc = await readBoard(baseURL!, seeded.cookie, seeded.root);
      return (readElement(roots(doc).elements.get(seeded.map)!) as { x: number }).x;
    };
    const x0 = await xOf();
    const pane = card.locator('.leaflet-map-pane');
    const before = await pane.evaluate((el) => getComputedStyle(el).transform);
    const box = (await live.boundingBox())!;
    await desk.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await desk.mouse.down();
    await desk.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 8 });
    await desk.mouse.up();
    await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
    expect(await xOf()).toBe(x0);
    await expect(card.locator('.leaflet-tile:not(.leaflet-tile-loaded)')).toHaveCount(0);
    await desk.screenshot({ path: join(out, `desktop-${theme}-interactive.png`) });

    if (theme === 'dark') {
      // The frame around the map drags the card, and the map stays explored.
      const frame = (await card.locator('.mcard__live').boundingBox())!;
      await desk.mouse.move(frame.x + 3, frame.y + frame.height / 2);
      await desk.mouse.down();
      await desk.mouse.move(frame.x + 123, frame.y + frame.height / 2 + 20, { steps: 10 });
      await desk.mouse.up();
      await expect.poll(xOf).toBeGreaterThan(x0 + 60);
      await expect(live).toBeVisible();
      // And back, for the shots of the light theme.
      const moved = (await card.locator('.mcard__live').boundingBox())!;
      await desk.mouse.move(moved.x + 3, moved.y + moved.height / 2);
      await desk.mouse.down();
      await desk.mouse.move(moved.x - 117, moved.y + moved.height / 2 - 20, { steps: 10 });
      await desk.mouse.up();
      await expect.poll(xOf).toBeLessThan(x0 + 20);

      // Esc: back to the picture.
      await desk.keyboard.press('Escape');
      await expect(live).toHaveCount(0);
      await expect(explore).toBeVisible();

      // A double click explores too; one map at a time; a press outside ends it.
      const picture = (await card.locator('.mcard__map').boundingBox())!;
      await desk.mouse.dblclick(picture.x + 40, picture.y + picture.height - 30);
      await expect(live).toBeVisible();
      const route = desk.locator(`[data-el="${seeded.file}"]`);
      await route.getByRole('button', { name: 'Esplora la mappa di sentiero.gpx' }).click();
      await expect(route.locator('.mcard__live-route')).toBeVisible();
      await expect(route.locator('.mcard__live-start')).toBeVisible();
      await expect(live).toHaveCount(0);
      await expect(route.locator('.leaflet-tile:not(.leaflet-tile-loaded)')).toHaveCount(0);
      await desk.screenshot({ path: join(out, `desktop-${theme}-route.png`) });
      await desk.mouse.click(1200, 560);
      await expect(route.locator('[data-explored]')).toHaveCount(0);
    }
    expect(elsewhere).toEqual([]);
    await context.close();
  }

  // Guests explore through their link; phones too, with the same button.
  const team = await browser.newContext({ storageState: state, baseURL });
  const share = await team.request.post(`/api/v1/boards/${seeded.root}/share-links`, {
    headers: { origin: baseURL! },
    data: { role: 'guest_view', label: 'Mappe' },
  });
  expect(share.ok()).toBe(true);
  const { url } = await share.json();
  await team.close();
  for (const theme of ['dark', 'light'] as const) {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: 'it-IT',
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const mobile = await board(phone, url, theme);
    const card = mobile.locator(`[data-el="${seeded.map}"]`);
    const explore = card.getByRole('button', { name: 'Esplora la mappa di Rifugio Lagunc' });
    await expect(explore).toBeVisible({ timeout: 20_000 });
    await mobile.screenshot({ path: join(out, `phone-${theme}-static.png`) });
    const tiles = mobile.waitForResponse(
      (res) => /\/api\/v1\/guest\/links\/[^/]+\/map-tiles\//.test(res.url()) && res.ok(),
    );
    await explore.tap();
    await tiles;
    await expect(card.locator('.leaflet-tile:not(.leaflet-tile-loaded)')).toHaveCount(0);
    await mobile.screenshot({ path: join(out, `phone-${theme}-interactive.png`) });
    await phone.close();
  }
});
