// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists).
// Update a storyboard from a revised screenplay, in the suite's Italian (decision 0081): the dialog matches the draft to
// the scenes, the update keeps every frame and marks the scene the draft left out as omitted.
// Set E2E_SHOTS to a folder to also capture each state, light and dark, desktop and phone.
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addScenes, type NewScene } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

test.describe.configure({ mode: 'serial' });

const shots = process.env.E2E_SHOTS;
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const fixtures = new URL('../../apps/web/src/board/film/screenplay/fixtures/', import.meta.url);
const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ action: `Beat ${i + 1}` }));

/** The storyboard of an earlier draft of last-train.fountain, with frames already made. */
const EARLIER: NewScene[] = [
  { number: '0', title: 'Cold open teaser', frames: frames(1) },
  {
    number: '1',
    title: 'Central Station',
    setting: 'ext',
    location: 'CENTRAL STATION',
    time: 'day',
    synopsis: 'Mara waits for the train.',
    frames: frames(3),
  },
  { number: '2', title: 'Guard Booth', setting: 'int', location: 'GUARD BOOTH', frames: frames(2) },
  {
    number: '3',
    title: 'Platform 4',
    setting: 'ext',
    location: 'PLATFORM 4',
    time: 'dawn',
    frames: frames(2),
  },
  {
    number: '4',
    title: 'Parking Lot',
    setting: 'ext',
    location: 'PARKING LOT',
    time: 'night',
    synopsis: 'A car waits with its lights off.',
    frames: frames(4),
  },
];

let url = '';
let storyboardId = '';
let cookie = '';

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  cookie = await signIn(base, admin);
  const post = async <T>(path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Script revisions',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Last Train',
  });
  const doc = createBoardDoc(storyboard.id);
  addScenes(doc, EARLIER, { userId: null });
  await pushBoardDoc(base, cookie, storyboard.id, doc);
  storyboardId = storyboard.id;
  url = `/p/${project.id}/b/${storyboard.id}`;
});

async function open(page: Page, base: string) {
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  await page.goto(url);
  // The phone has no sync status in its header: the scenes say the board has arrived.
  await expect(page.locator('.story__scene')).toHaveCount(EARLIER.length);
}

async function importDraft(page: Page) {
  await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
  await dialog.getByLabel('Scegli un file').setInputFiles({
    name: 'last-train.fountain',
    mimeType: 'text/plain',
    buffer: await readFile(new URL('last-train.fountain', fixtures)),
  });
  return dialog;
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  // No leftover hover or focus.
  await page.mouse.move(1, 1);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shots, `${name}-${theme}.png`), animations: 'disabled' });
  }
}

test('the phone sheet lists the changes of the draft', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL as string);
  const dialog = await importDraft(page);
  await expect(dialog.getByLabel('Dove')).toHaveText(/Aggiorna da revisione/);
  await expect(dialog.getByRole('radio', { name: /Modifiche/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^Tutte/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Aggiorna lo storyboard' })).toBeEnabled();
  await shoot(page, 'revision-phone');
  await dialog.getByRole('button', { name: 'Annulla' }).click();
});

test('a revised draft updates the scenes, adds the new one and marks the omitted one', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, baseURL as string);
  const dialog = await importDraft(page);
  // The draft's title is the storyboard's: the update is preselected.
  await expect(dialog.getByRole('radio', { name: 'Aggiorna da revisione' })).toBeChecked();
  const list = dialog.getByRole('list', { name: 'Scene di questa stesura' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.getByText('Era GIORNO · sinossi riscritta')).toBeVisible();
  await expect(list.getByText('Era la scena 3')).toBeVisible();
  await expect(
    list.getByText('Non in 30 October 2026 · tenuta e segnata come omessa'),
  ).toBeVisible();
  await expect(list.getByText('Da verificare')).toBeVisible();
  await expect(dialog.getByText('1 scena invariata, 2 inquadrature')).toBeVisible();
  await shoot(page, 'revision-dialog');

  await dialog.getByRole('radio', { name: /^Tutte/ }).check();
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await shoot(page, 'revision-dialog-all');
  await dialog.getByRole('radio', { name: /^Modifiche/ }).check();

  await dialog.getByRole('button', { name: 'Aggiorna lo storyboard' }).click();
  await expect(dialog).toBeHidden();

  // Frames stay where they were; the new scene comes after scene 2 with its own frames, and
  // the omitted scene keeps its place, last.
  const scene = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(scene('Scena 1').getByLabel('Sinossi')).toHaveValue(
    'Mara misses the last train and meets Leo.',
  );
  await expect(scene('Scena 1').locator('.story__tile')).toHaveCount(3);
  await expect(scene('Scena 3A').locator('.story__tile')).toHaveCount(2);
  await expect(scene('Scena 2A')).toBeVisible();
  const omitted = scene('Scena 4, omessa');
  await expect(omitted.getByText('Omessa', { exact: true })).toBeVisible();
  await expect(omitted.locator('.story__tile')).toHaveCount(4);
  await expect(page.locator('.story__scene').nth(5)).toHaveAttribute(
    'aria-label',
    'Scena 4, omessa',
  );
  // The top, with the struck-through scene in the list, then the scene itself.
  await shoot(page, 'storyboard-omitted');
  await omitted.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shoot(page, 'storyboard-omitted-scene');

  await omitted.getByRole('button', { name: 'Menu della scena 4' }).click();
  await expect(page.getByRole('menuitem', { name: /Ripristina la scena/ })).toBeVisible();
  await shoot(page, 'storyboard-omitted-menu');
  await page.keyboard.press('Escape');

  const toggle = page.getByRole('button', { name: 'Omesse (1)' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(omitted).toBeHidden();
  await shoot(page, 'storyboard-omitted-hidden');
  await toggle.click();

  // The version saved first.
  const res = await fetch(`${baseURL}/api/v1/boards/${storyboardId}/versions`, {
    headers: { cookie },
  });
  const { items } = (await res.json()) as { items: Array<{ name: string | null }> };
  expect(items.map((v) => v.name)).toContain('Prima di 30 October 2026');

  // The shot list leaves the omitted scene's frames out.
  await page.goto(`${url}?view=shotlist`);
  await expect(page.getByText('Beat 4', { exact: true })).toHaveCount(0);

  // Phone: the storyboard with the omitted scene.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Scena 4, omessa' })).toBeVisible();
  await page
    .getByRole('region', { name: 'Scena 4, omessa' })
    .locator('header')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shoot(page, 'storyboard-omitted-phone');
});
