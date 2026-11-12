// SPDX-License-Identifier: AGPL-3.0-only
// The end of the interim of decision 0121 (decision 0123, step 6): storyboards have no Schedule
// or Troupe. A project with days but no Production board is told where they go, and a project
// whose days are on two storyboards is moved by the server's startup step. Runs after
// first-run.spec.ts as the administrator, on projects of its own. END_INTERIM_SHOTS=<dir> saves
// light and dark screenshots at 1280 and 390 px.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { perfUser, pushBoardDoc, signIn } from './perf/seed.ts';

const shots = process.env.END_INTERIM_SHOTS;
const opts = { userId: null };
test.use({ viewport: { width: 1280, height: 800 } });

type Project = { id: string; rootBoardId: string; name: string };

/** Signs the page in and makes a project with storyboards, each with one scene of one frame. */
async function seed(page: Page, baseURL: string, name: string, titles: string[]) {
  const cookie = await signIn(baseURL, perfUser);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  const headers = { origin: baseURL };
  const created = await page.request.post('/api/v1/projects', { headers, data: { name } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as Project;
  const storyboards: Array<{ id: string; title: string; frame: string }> = [];
  for (const title of titles) {
    const res = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, title, kind: 'storyboard' },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    const doc = new Y.Doc();
    initBoardDoc(doc, id);
    let frame = '';
    doc.transact(() => {
      const scene = addScene(doc, { number: '1', title: `${title} opens` }, opts);
      frame = addFrame(doc, scene.id, null, { action: `${title}: the train comes in` }, opts).id;
    });
    await pushBoardDoc(baseURL, cookie, id, doc);
    storyboards.push({ id, title, frame });
  }
  /** A day on a board, as a project without a Production board still takes it. */
  const day = async (boardId: string, date: string, shotId: string) => {
    const res = await page.request.post(`/api/v1/boards/${boardId}/schedule`, {
      headers,
      data: {
        date,
        callTime: '07:00',
        wrap: null,
        location: 'Stazione',
        notes: '',
        blocks: [
          {
            id: randomUUID(),
            type: 'shot',
            title: '',
            start: null,
            duration: 45,
            shotId,
            cast: [],
            departments: [],
          },
        ],
      },
    });
    expect(res.status()).toBe(201);
  };
  return { project, storyboards, day };
}

async function productionOf(page: Page, projectId: string) {
  const boards = (await (
    await page.request.get(`/api/v1/projects/${projectId}/boards`)
  ).json()) as {
    items: Array<{ id: string; kind: string; parentBoardId: string | null }>;
  };
  return boards.items.filter((b) => b.kind === 'production');
}

/** Light and dark pictures of the page as it is, at 1280 and 390 px, for the pull request. */
async function shoot(page: Page, name: string, open?: () => Promise<void>) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('inkadra.theme', value);
        window.dispatchEvent(new Event('inkadra-theme-change'));
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (open) await open();
      await page.mouse.move(width - 2, height - 2);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(shots, `${name}-${width}-${theme}.png`) });
      if (open) await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

const boardMenu = (page: Page) =>
  page.getByRole('button', { name: 'Menu della board', exact: true });

test('a project with days but no Production board says where they are, and adds it', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { project, storyboards, day } = await seed(page, baseURL!, 'Senza Produzione', ['Spot']);
  const spot = storyboards[0]!;
  await day(spot.id, '2031-03-03', spot.frame);

  // The storyboard has no Schedule or Troupe, and its ⋯ menu says where they went.
  await page.goto(`/p/${project.id}/b/${spot.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Storyboard', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Piano riprese', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Troupe', exact: true })).toHaveCount(0);
  const entry = page.getByRole('menuitem', {
    name: 'Piano riprese e Troupe ora sono in Produzione · Aggiungila',
    exact: true,
  });
  await boardMenu(page).click();
  await expect(entry).toBeVisible();
  // Views of this board offer only the storyboard's own.
  await expect(page.getByRole('menuitemcheckbox', { name: 'Piano riprese' })).toHaveCount(0);
  await expect(page.getByRole('menuitemcheckbox', { name: 'Troupe' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await shoot(page, 'no-production-menu', async () => {
    await boardMenu(page).click();
    await expect(entry).toBeVisible();
  });

  // It adds the Production board, which takes the day, and opens it.
  await boardMenu(page).click();
  await entry.click();
  await expect(page.getByRole('tab', { name: 'Troupe', exact: true })).toBeVisible();
  const [production] = await productionOf(page, project.id);
  if (!production) throw new Error('no Production board');
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}`));
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await expect(schedule.locator('.schedule__day .schedule__block')).toHaveCount(1);

  // In the trash, the entry comes back and brings that board back with the day.
  const binned = await page.request.delete(`/api/v1/boards/${production.id}`, {
    headers: { origin: baseURL! },
  });
  expect(binned.ok()).toBe(true);
  await page.goto(`/p/${project.id}/b/${spot.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await boardMenu(page).click();
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}`));
  await expect(schedule.locator('.schedule__day .schedule__block')).toHaveCount(1);

  // With the board back, the entry gives way to the link to it.
  await page.goto(`/p/${project.id}/b/${spot.id}`);
  await boardMenu(page).click();
  await expect(entry).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: 'Giornate di ripresa: 1 · Apri Produzione', exact: true }),
  ).toBeVisible();
});

test('the startup step moves the days of two storyboards to a Production board', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const { project, storyboards, day } = await seed(page, baseURL!, 'Progetto migrato', [
    'Teaser',
    'Film',
  ]);
  const [teaser, film] = storyboards as [(typeof storyboards)[0], (typeof storyboards)[0]];
  await day(teaser.id, '2031-03-03', teaser.frame);
  await day(film.id, '2031-03-04', film.frame);
  expect(await productionOf(page, project.id)).toEqual([]);

  // The server's startup step, as an upgrade runs it (`inkadra migrate`), on the same database.
  const main = fileURLToPath(new URL('../../apps/server/dist/main.js', import.meta.url));
  execFileSync(process.execPath, [main, 'migrate'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://inkadra:inkadra@localhost:5432/inkadra_e2e',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
      PUBLIC_URL: baseURL!,
      DATA_DIR: process.env.E2E_DATA_DIR ?? join(tmpdir(), 'inkadra-e2e'),
      LOG_LEVEL: 'warn',
      PRODUCTION_BOARD_MOVE: 'true',
    },
    stdio: 'inherit',
  });
  const made = await productionOf(page, project.id);
  expect(made).toHaveLength(1);
  const production = made[0]!;
  expect(production.parentBoardId).toBe(project.rootBoardId);

  // Its calendar shows the days of both storyboards, each block with its storyboard's dot.
  await page.goto(`/p/${project.id}/b/${production.id}`);
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await schedule.getByRole('radio', { name: 'Settimana', exact: true }).check();
  const blocks = schedule.locator('.schedule__day .schedule__block');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.locator('.schedule__dot[aria-label="Teaser"]')).toHaveCount(1);
  await expect(blocks.locator('.schedule__dot[aria-label="Film"]')).toHaveCount(1);
  await expect(blocks.filter({ hasText: '1A' })).toHaveCount(2);

  // The storyboards have no Schedule tab, and their ⋯ menu leads to the Production board.
  for (const board of [teaser, film]) {
    await page.goto(`/p/${project.id}/b/${board.id}`);
    await expect(page.getByRole('tab', { name: 'Storyboard', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Piano riprese', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Troupe', exact: true })).toHaveCount(0);
  }
  await shoot(page, 'storyboard');
  const link = page.getByRole('menuitem', {
    name: 'Giornate di ripresa: 1 · Apri Produzione',
    exact: true,
  });
  await shoot(page, 'storyboard-menu', async () => {
    await boardMenu(page).click();
    await expect(link).toBeVisible();
  });
  await boardMenu(page).click();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}`));

  // An old link to a storyboard's schedule or crew opens the Production board's.
  await page.goto(`/p/${project.id}/b/${film.id}?view=troupe`);
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}\\?view=troupe$`));
  await page.goto(`/p/${project.id}/b/${teaser.id}?view=schedule`);
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}$`));
  await expect(schedule).toBeVisible();

  // The root canvas gets the Production card from the first editor who opens it, once.
  const card = page.locator(`[data-el="production-${production.id}"]`);
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(card).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(card).toHaveCount(1);
});
