// SPDX-License-Identifier: AGPL-3.0-only
// The card of a sub-board previews it (decision 0121): one card per board, small tabs for its
// views, the chosen tab kept on this device, and opening the card opens that view.
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// BOARD_CARD_SHOTS=<folder> also saves the screenshots of the pull request there.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addFrame, addScene, createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { png, pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const shots = process.env.BOARD_CARD_SHOTS;
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
const SIZE = { w: 320, h: 260 };

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
  const project = await (
    await page.request.post('/api/v1/projects', { headers, data: { name: 'Ultimo treno' } })
  ).json();
  const root = project.rootBoardId as string;
  const pictures: string[] = [];
  for (let i = 0; i < 6; i++) {
    const body = png(i * 7 + 3, 192, 108);
    const id = await uploadFile(baseURL, cookie, project.id, {
      body,
      name: `binario-${i}.png`,
      type: 'image/png',
    });
    if (id) pictures.push(id);
  }
  await waitForAssets(baseURL, cookie, pictures);
  const board = async (title: string, kind: string, views?: string[]) => {
    const made = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: root, title, kind },
    });
    expect(made.status()).toBe(201);
    const { id } = await made.json();
    if (views)
      expect(
        (await page.request.patch(`/api/v1/boards/${id}`, { headers, data: { views } })).ok(),
      ).toBe(true);
    return id as string;
  };

  const notes = await board('Appunti', 'board');
  const notesDoc = createBoardDoc(notes);
  createElement(notesDoc, 'image', { x: 0, y: 0 }, { assetId: pictures[0] as string }, opts);
  createElement(notesDoc, 'image', { x: 260, y: 0 }, { assetId: pictures[1] as string }, opts);
  for (const [i, title] of [
    'Chiedere il permesso per il binario 4',
    'Pioggia finta: 2 torri, 1 autobotte',
  ].entries())
    createElement(notesDoc, 'todo', { x: i * 260, y: 300 }, { title, items: [] }, opts);
  await pushBoardDoc(baseURL, cookie, notes, notesDoc);

  const mood = await board('Luce', 'moodboard');
  const moodDoc = createBoardDoc(mood);
  for (const [i, id] of pictures.slice(2, 5).entries())
    createElement(moodDoc, 'image', { x: i * 260, y: 0 }, { assetId: id }, opts);
  for (const [i, hex] of ['#1E3A4C', '#F79B54', '#E8C468', '#0C141C'].entries())
    createElement(moodDoc, 'color', { x: i * 130, y: 300 }, { hex }, opts);
  await pushBoardDoc(baseURL, cookie, mood, moodDoc);

  const film = await board('Film', 'storyboard', ['shotlist', 'review']);
  const filmDoc = createBoardDoc(film);
  const scene = addScene(filmDoc, { number: '1' }, opts);
  const frames = (
    [
      ['ews', '24mm'],
      ['fs', '50mm'],
      ['ms', '35mm'],
      ['cu', '85mm'],
      ['ws', '32mm'],
      ['insert', '100mm'],
    ] as const
  ).map(([shot, lens], i) =>
    addFrame(
      filmDoc,
      scene.id,
      null,
      { shot, lens, ...(i < 3 ? { assetId: pictures[i + 3] } : {}) },
      opts,
    ),
  );
  await pushBoardDoc(baseURL, cookie, film, filmDoc);
  const teaser = await board('Teaser', 'storyboard');

  const doc = createBoardDoc(root);
  const card = (boardId: string, x: number, y: number) =>
    createElement(doc, 'board', { x, y }, { boardId, ...SIZE }, opts).id;
  const ids = {
    notes: card(notes, 0, 0),
    mood: card(mood, 340, 0),
    film: card(film, 680, 0),
    teaser: card(teaser, 0, 280),
    // A card from before the preview keeps its name only.
    old: createElement(doc, 'board', { x: 340, y: 280 }, { boardId: notes }, opts).id,
  };
  await pushBoardDoc(baseURL, cookie, root, doc);
  // The server stores boards shortly after the last edit: wait for what the cards show.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/projects/${project.id}/board-counts`);
        const { items } = await res.json();
        return items.find((c: { boardId: string }) => c.boardId === film)?.frameCount;
      },
      { timeout: 20_000 },
    )
    .toBe(6);
  // The client's decisions, once the frames are stored.
  for (const [frame, status] of [
    [frames[0], 'approved'],
    [frames[1], 'approved'],
    [frames[2], 'changes_requested'],
  ] as const)
    expect(
      (
        await page.request.put(`/api/v1/boards/${film}/elements/${frame?.id}/review`, {
          headers,
          data: { status },
        })
      ).ok(),
    ).toBe(true);
  return { project, ids, film };
}

for (const theme of ['light', 'dark'] as const) {
  test(`board cards preview their board (${theme})`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const { project, ids, film } = await seed(page, baseURL!, theme);
    await page.goto(`/p/${project.id}?view=canvas`);
    const el = (id: string) => page.locator(`[data-el="${id}"]`);

    // A board: pictures and what its cards say.
    await expect(el(ids.notes).locator('.board-card__excerpt').first()).toContainText(
      'Chiedere il permesso',
    );
    await expect(el(ids.notes).locator('.board-card__pictures img')).toHaveCount(2);
    // A moodboard: a mosaic of its pictures and its palette.
    await expect(el(ids.mood).locator('.board-card__mosaic img')).toHaveCount(3);
    await expect(el(ids.mood).locator('.board-card__swatch')).toHaveCount(4);
    // A storyboard: the first frames, then how many more.
    const story = el(ids.film);
    await expect(story.locator('.board-card__frame')).toHaveCount(3);
    await expect(story.locator('.board-card__frame img')).toHaveCount(3);
    await expect(story.locator('.board-card__more')).toHaveText('+3 inquadrature');
    await expect(story.getByRole('tab')).toHaveText(['Storyboard', 'Shot list', 'Revisione']);
    // Empty and old cards.
    await expect(el(ids.teaser).locator('.board-card__empty')).toHaveText(
      'Ancora nessuna inquadratura.',
    );
    await expect(el(ids.old).locator('.card__board')).toContainText('Appunti');
    await expect(el(ids.old).locator('.board-card')).toHaveCount(0);

    const capture = async (name: string) => {
      if (!shots) return;
      mkdirSync(shots, { recursive: true });
      await page.mouse.move(1, 1);
      await page.screenshot({ path: join(shots, `${name}-${theme}.png`) });
    };
    await capture('desktop-canvas');

    // The tabs look at another view without opening the board.
    await story.getByRole('tab', { name: 'Revisione' }).click();
    await expect(story.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    await expect(story.locator('.board-card__changes')).toHaveText('1 da cambiare');
    await story.getByRole('tab', { name: 'Shot list' }).click();
    await expect(story.locator('.board-card__table tbody tr')).toHaveCount(5);
    await expect(page).toHaveURL(new RegExp(`/p/${project.id}`));
    await capture('desktop-tabs');

    // The chosen tab stays on this device, and opening the card opens that view.
    await page.reload();
    await expect(story.getByRole('tab', { name: 'Shot list' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await story.locator('.board-card__body').dblclick();
    await expect(page).toHaveURL(new RegExp(`/b/${film}\\?view=shotlist`));

    if (!shots) return;
    // The loading state, held by a preview that never answers.
    await page.route('**/api/v1/boards/*/preview', () => {});
    await page.goto(`/p/${project.id}?view=canvas`);
    await expect(el(ids.notes).locator('.board-card__note')).toHaveText(
      'Caricamento anteprima…',
    );
    await capture('desktop-loading');
    await page.unroute('**/api/v1/boards/*/preview');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${project.id}?view=canvas`);
    await expect(story.locator('.board-card__table tbody tr')).toHaveCount(5);
    await capture('phone-canvas');
  });
}
