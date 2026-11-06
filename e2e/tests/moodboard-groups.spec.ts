// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// The reworked moodboard (decision 0077): the grid without groups, named groups, the palette, the
// selection bar and sending pictures to the storyboard, which is another board's document.
// Set E2E_SHOTS to a folder to also capture each state, light and dark.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';
import { png } from './support/archive.ts';

test.describe.configure({ mode: 'serial' });

const shots = process.env.E2E_SHOTS;
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

const PICTURES = [
  { w: 300, h: 450, seed: 1, note: 'Controluce caldo, fine giornata' },
  { w: 480, h: 270, seed: 2 },
  { w: 300, h: 450, seed: 3, note: 'Mosso da riprendere in pista' },
  { w: 480, h: 270, seed: 4 },
  { w: 480, h: 270, seed: 5 },
];

interface Seeded {
  cookie: string;
  url: string;
  storyboard: string;
}

async function seed(base: string): Promise<Seeded> {
  const cookie = await signIn(base, account);
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Ultimo treno',
    type: 'short_film',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    title: 'Storyboard',
    kind: 'storyboard',
  });
  const ids: string[] = [];
  for (const [i, { w, h, seed: tint }] of PICTURES.entries()) {
    const id = await uploadFile(base, cookie, project.id, {
      body: png(w, h, tint),
      name: `ref-${i}.png`,
      type: 'image/png',
    });
    if (!id) throw new Error('upload failed');
    ids.push(id);
  }
  await waitForAssets(base, cookie, ids);
  const doc = createBoardDoc(project.rootBoardId);
  const opts = { userId: null };
  PICTURES.forEach(({ note }, i) => {
    createElement(
      doc,
      'image',
      { x: i * 320, y: 0 },
      {
        w: 300,
        assetId: ids[i] as string,
        ...(note ? { caption: note } : {}),
        tags: i % 2 ? ['notte'] : [],
      },
      opts,
    );
  });
  createElement(
    doc,
    'link',
    { x: 0, y: 500 },
    {
      url: 'https://www.cined.com/riedel-refcam',
      title: 'Riedel RefCam',
      imageAssetId: ids[4] as string,
    },
    opts,
  );
  createElement(doc, 'color', { x: 320, y: 500 }, { hex: '#23236C' }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  return {
    cookie,
    url: `/p/${project.id}/b/${project.rootBoardId}?view=moodboard`,
    storyboard: storyboard.id,
  };
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  // No leftover hover or focus: the states come from the selection.
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shots, `${name}-${theme}.png`), animations: 'disabled' });
  }
}

test('the moodboard groups, selects and sends references to the storyboard', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const { cookie, url, storyboard } = await seed(base);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);

  const gallery = page.getByRole('region', { name: 'Moodboard', exact: true });
  await expect(gallery.locator('.moodboard__tile')).toHaveCount(7);
  // Nobody made a group: the grid and nothing else, with more than four tiles a row.
  await expect(gallery.locator('.moodboard__group')).toHaveCount(0);
  const columns = await gallery
    .locator('.moodboard__gallery')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBeGreaterThan(4);
  await expect(gallery.locator('.moodboard__card--image img').first()).toBeVisible();
  // The palette comes from the pictures, without new data on the board.
  await expect(gallery.locator('.moodboard__palette li').first()).toBeVisible();
  await shoot(page, 'moodboard-1280-no-groups');

  // By keyboard: the checkbox of a tile, Space, and the bar appears.
  const check = gallery.getByRole('checkbox');
  await check.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(gallery.locator('.moodboard__selection')).toBeVisible();
  await check.nth(2).check();
  await expect(gallery.getByRole('group', { name: 'Riferimenti selezionati' })).toContainText(
    /2 selezionati|2 selected/,
  );
  await shoot(page, 'moodboard-1280-selection-no-groups');

  // Into a new group, then a second one, from the bar.
  const bar = gallery.locator('.moodboard__selection');
  await bar.getByRole('button', { name: 'Sposta nel gruppo' }).click();
  await bar.getByRole('textbox').fill('Luce');
  await page.keyboard.press('Enter');
  await expect(gallery.locator('.moodboard__group-title').first()).toContainText('Luce');
  await expect(gallery.locator('.moodboard__group-title').first()).toContainText('2');
  await expect(gallery.locator('.moodboard__group-title').last()).toContainText('5');

  // Tag together.
  await bar.getByRole('button', { name: 'Tag', exact: true }).click();
  await bar.getByRole('textbox').fill('tramonto');
  await page.keyboard.press('Enter');
  await expect(gallery.getByRole('button', { name: '#tramonto' })).toBeVisible();
  await shoot(page, 'moodboard-1280-groups-selection');

  // Confronta opens the viewer on the selection only.
  await bar.getByRole('button', { name: 'Confronta' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toContainText('1 / 2');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // To the storyboard, a document of its own: confirmed by the server, so read it back.
  await bar.getByRole('button', { name: 'Manda allo storyboard' }).click();
  await expect(page.locator('.toast:not(.ink-motion-exit)')).toContainText('2');
  const framesSent = async () => {
    const sent = await readBoard(base, cookie, storyboard);
    return [...roots(sent).elements.values()]
      .map((map) => readElement(map))
      .filter((el) => el?.type === 'frame');
  };
  await expect.poll(async () => (await framesSent()).length, { timeout: 15_000 }).toBe(2);
  const frames = await framesSent();
  expect(frames.map((f) => f?.type === 'frame' && f.action).sort()).toEqual([
    'Controluce caldo, fine giornata',
    'Mosso da riprendere in pista',
  ]);

  // Escape ends the selection and the groups stay after a reload.
  await page.locator('h2.moodboard__title').click();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.toast:not(.ink-motion-exit)')).toHaveCount(0, { timeout: 15_000 });
  await shoot(page, 'moodboard-1280-groups');
  await page.reload();
  await expect(gallery.locator('.moodboard__group')).toHaveCount(2);

  // Rename by keyboard, and the heading gets the focus back.
  const rename = gallery.getByRole('button', { name: /Rinomina il gruppo Luce/ });
  await rename.focus();
  await page.keyboard.press('Enter');
  await gallery.getByRole('textbox', { name: 'Nome del gruppo' }).fill('Fine giornata');
  await page.keyboard.press('Enter');
  const renamed = gallery.getByRole('button', { name: /Rinomina il gruppo Fine giornata/ });
  await expect(renamed).toBeFocused();

  // Phone: the bar and the grid fit, without scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await gallery.getByRole('checkbox').nth(0).check();
  await gallery.getByRole('checkbox').nth(1).check();
  await expect(bar).toBeVisible();
  const overflow = await gallery.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shoot(page, 'moodboard-390-selection');
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await shoot(page, 'moodboard-390-groups');

  // Presenting goes through the pictures on screen.
  await page.setViewportSize({ width: 1280, height: 800 });
  await gallery.getByRole('button', { name: 'Presenta' }).click();
  await expect(page.locator('.present-view')).toBeVisible();
  await expect(page.locator('.present-strip button')).toHaveCount(6);
  await page.locator('.present-view').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'moodboard-present.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.present-view')).toHaveCount(0);
});
