// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// An uploaded video plays in its card, from the play button on the thumbnail. Set E2E_SHOTS to a
// folder to also capture the cards for the pull request: light and dark, desktop and phone.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const fixtures = fileURLToPath(new URL('../../apps/server/src/media/fixtures/', import.meta.url));

/** A project whose board holds two cards of the same WebM, which browsers play as uploaded. */
async function seedVideos(page: Page, base: string) {
  const cookie = await signIn(base, admin);
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base };
    }),
  );
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: `Video in card ${Date.now()}` },
  });
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const assetId = await uploadFile(base, cookie, project.id, {
    body: await readFile(join(fixtures, 'inline-clip.webm')),
    name: 'ripresa.webm',
    type: 'video/webm',
  });
  if (!assetId) throw new Error('upload failed');
  await waitForAssets(base, cookie, [assetId]);
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null } as const;
  for (const x of [60, 420]) createElement(doc, 'file', { x, y: 80 }, { assetId, w: 320 }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  const boardUrl = `/p/${project.id}/b/${project.rootBoardId}`;
  const asset = await (await page.request.get(`/api/v1/assets/${assetId}`)).json();
  return { project, assetId, asset, boardUrl };
}

const running = (video: Locator) =>
  expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0))
    .toBe(true);

test('a video plays in its card and stops with the card, the viewer and other players', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const { asset, boardUrl } = await seedVideos(page, baseURL as string);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(boardUrl);
  const cards = page.locator('.card--file');
  const first = cards.nth(0);
  const second = cards.nth(1);
  await expect(cards).toHaveCount(2);
  await expect(first.locator('.fcard__play')).toBeVisible();
  // A board mounts no video until play is pressed.
  await expect(page.locator('video')).toHaveCount(0);

  // One press plays it here, with the browser's controls, without opening or selecting anything.
  await first.getByRole('button', { name: 'Riproduci ripresa.webm' }).click();
  const video = first.locator('video');
  await expect(video).toHaveAttribute('src', asset.url);
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toBeFocused();
  await running(video);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(first).not.toHaveClass(/is-selected/);

  // The keyboard belongs to the video: Space pauses it and it stays on the card.
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(video).toHaveCount(1);

  // The pointer on the video neither moves nor selects the card.
  const before = await first.boundingBox();
  const box = await video.boundingBox();
  if (!before || !box) throw new Error('no boxes');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  expect(await first.boundingBox()).toEqual(before);
  await expect(first).not.toHaveClass(/is-selected/);

  // Its footer still does both, and the video keeps going.
  const footer = await first.locator('.fcard__footer').boundingBox();
  if (!footer) throw new Error('no footer');
  await page.mouse.move(footer.x + 20, footer.y + 10);
  await page.mouse.down();
  await page.mouse.move(footer.x + 20, footer.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect(first).toHaveClass(/is-selected/);
  expect((await first.boundingBox())?.y).toBeGreaterThan(before.y + 30);
  await expect(video).toHaveCount(1);

  // Another player takes the turn.
  await second.locator('.fcard__play').click();
  await expect(second.locator('video')).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(1);
  await expect(first.locator('.fcard__play')).toBeVisible();
  await running(second.locator('video'));

  // Escape stops it and hands the focus back to the play button; Enter presses that button.
  await page.keyboard.press('Escape');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(second.locator('.fcard__play')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(second.locator('video')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Double click on the footer still opens the viewer, and the card's video stops.
  await second.locator('.fcard__footer').dblclick();
  await expect(page.getByRole('dialog').locator('video')).toBeVisible();
  await expect(second.locator('video')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // So does double click on the thumbnail, and the menu.
  const picture = await first.locator('.fcard__preview').boundingBox();
  if (!picture) throw new Error('no preview');
  await page.mouse.dblclick(picture.x + 24, picture.y + 24);
  await expect(page.getByRole('dialog').locator('video')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await first.locator('.fcard__play').click();
  await expect(first.locator('video')).toHaveCount(1);
  await first.locator('video').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apri file', exact: true }).click();
  await expect(page.getByRole('dialog').locator('video')).toBeVisible();
  await expect(first.locator('video')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Turning the preview off stops it; turning it on again shows the thumbnail.
  await first.locator('.fcard__play').click();
  await expect(first.locator('video')).toHaveCount(1);
  await first.locator('.fcard__footer').click();
  await page.locator('.ctxbar [aria-haspopup=menu]').last().click();
  await page.getByRole('menuitem', { name: 'Aspetto', exact: true }).click();
  const preview = page.locator('.ctxbar').getByRole('switch', { name: 'Anteprima', exact: true });
  await preview.click();
  await expect(first.locator('.fcard__preview')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  await preview.click();
  await expect(first.locator('.fcard__play')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Far zoom hides the text on cards but keeps their pictures: a video playing and the other
  // card's thumbnail, not a grey block (inkadra-feedback#21). Forced with the class: on a small
  // board like this one how far the zoom goes depends on the timing of the view's limits.
  await first.locator('.fcard__play').click();
  const world = page.locator('.canvas__world');
  await world.evaluate((el) => el.classList.add('canvas__world--far'));
  await expect(first.locator('video')).toBeVisible();
  await expect(second.locator('.fcard__media')).toBeVisible();
  await expect(second.locator('.fcard__footer')).toBeHidden();
  await expect(first.locator('.fcard__footer')).toBeHidden();
  await world.evaluate((el) => el.classList.remove('canvas__world--far'));
  await page.keyboard.press('Escape');
  await expect(page.locator('video')).toHaveCount(0);

  // Removing the card leaves nothing playing, and leaving the board does the same.
  await first.locator('.fcard__play').click();
  await running(first.locator('video'));
  const removed = await first.locator('video').elementHandle();
  await first.locator('.fcard__footer').click();
  await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(1);
  expect(await removed?.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true);
  await cards.first().locator('.fcard__play').click();
  await running(cards.first().locator('video'));
  const left = await cards.first().locator('video').elementHandle();
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(cards).toHaveCount(0);
  expect(await left?.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true);
});

test('the card plays the converted copy once ready and stays as it is while preparing', async ({
  page,
  baseURL,
}) => {
  const { asset, assetId, boardUrl } = await seedVideos(page, baseURL as string);
  const copy = `${asset.url}${asset.url.includes('?') ? '&' : '?'}copy=1`;
  let proxy: unknown = { status: 'processing', progress: 42, url: null };
  await page.route(`**/api/v1/assets/${assetId}`, (route) =>
    route.fulfill({ json: { ...asset, proxy } }),
  );
  await page.goto(boardUrl);
  const first = page.locator('.card--file').first();
  await expect(first.locator('.fcard__prep')).toBeVisible();
  await expect(first.locator('.fcard__play')).toHaveCount(0);

  proxy = { status: 'failed', progress: null, url: null };
  await page.reload();
  await expect(first.locator('.fcard__prep')).toBeVisible();
  await expect(first.locator('.fcard__play')).toHaveCount(0);

  proxy = { status: 'ready', progress: 100, url: copy };
  await page.reload();
  await first.locator('.fcard__play').click();
  await expect(first.locator('video')).toHaveAttribute('src', copy);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a guest plays on the card when the link gives the video, and sees the viewer otherwise', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL as string;
  const { project } = await seedVideos(page, base);
  const linkFor = async (allowDownload: boolean) => {
    const created = await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
      headers: { origin: base },
      data: { allowDownload },
    });
    expect(created.ok()).toBe(true);
    return ((await created.json()) as { url: string }).url;
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await context.newPage();

  await guest.goto(await linkFor(true));
  const card = guest.locator('.card--file').first();
  await card.locator('.fcard__play').click();
  await expect(card.locator('video')).toHaveAttribute('src', /\/guest\/links\/.+\/file/);
  await running(card.locator('video'));
  await expect(guest.getByRole('dialog')).toHaveCount(0);

  // No downloads, no video for this guest: the button opens the picture, as before.
  await guest.goto(await linkFor(false));
  await card.locator('.fcard__play').click();
  await expect(guest.getByRole('dialog')).toBeVisible();
  await expect(guest.locator('video')).toHaveCount(0);
  await context.close();
});

test('a finger plays a video on a phone', async ({ page, browser, baseURL }) => {
  const { boardUrl } = await seedVideos(page, baseURL as string);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    storageState: await page.context().storageState(),
  });
  const phone = await context.newPage();
  await phone.goto(boardUrl);
  const card = phone.locator('.card--file').first();
  await card.locator('.fcard__play').tap();
  await expect(card.locator('video')).toHaveCount(1);
  await expect(phone.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('screenshots for the pull request', async ({ browser, page, baseURL }) => {
  test.skip(!shots, 'Only when E2E_SHOTS is set');
  test.setTimeout(120_000);
  const { boardUrl } = await seedVideos(page, baseURL as string);
  const storageState = await page.context().storageState();
  for (const [name, viewport] of [
    ['1280', { width: 1280, height: 800 }],
    ['390', { width: 390, height: 844 }],
  ] as const)
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport, storageState });
      const shot = await context.newPage();
      await shot.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
      await shot.goto(boardUrl);
      const card = shot.locator('.card--file').first();
      await card.locator('.fcard__play').waitFor();
      await shot.mouse.move(0, 0);
      await shot.waitForTimeout(600);
      await shot.screenshot({ path: `${shots}/${name}-${theme}-thumbnail.png` });
      await card.locator('.fcard__play').click();
      const video = card.locator('video');
      await running(video);
      await video.evaluate((v: HTMLVideoElement) => {
        v.pause();
        v.currentTime = 1;
      });
      await shot.mouse.move(viewport.width - 4, viewport.height - 4);
      await shot.waitForTimeout(400);
      await shot.screenshot({ path: `${shots}/${name}-${theme}-playing.png` });
      if (name === '1280') {
        // The rings of keyboard focus, on the video and then on the play button of the next card.
        await shot.keyboard.press('Tab');
        await video.focus();
        await shot.screenshot({ path: `${shots}/${name}-${theme}-focus-video.png` });
        await shot.locator('.fcard__play').first().focus();
        await shot.screenshot({ path: `${shots}/${name}-${theme}-focus-play.png` });
      }
      await context.close();
    }
});
