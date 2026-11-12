import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';

/**
 * The Production board (decision 0123): made from the Canvas menu, one calendar for the frames of
 * two storyboards and a scene without frames, and a block whose storyboard went to the trash.
 * Uses the account created by first-run.spec.ts, with a project of its own.
 */
test('plans frames of two storyboards and a scene without frames on the Production board', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const headers = { origin };
  const created = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Production board' },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const storyboard = async (title: string) => {
    const res = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, title, kind: 'storyboard' },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const teaser = await storyboard('Teaser');
  const film = await storyboard('Film');
  // Teaser: scene 1 with frame 1A. Film: scene 1 with frame 1A, and scene 2 not drawn yet.
  await drawScenes(page, project.id, teaser, [1]);
  await drawScenes(page, project.id, film, [1, 0]);

  // Canvas → Production makes the one Production board, with its card on the root board.
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const made = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${project.id}/boards`),
  );
  await page.getByRole('menuitem', { name: 'Produzione', exact: true }).click();
  expect((await made).status()).toBe(201);
  const boards = (await (
    await page.request.get(`/api/v1/projects/${project.id}/boards`)
  ).json()) as { items: Array<{ id: string; kind: string }> };
  const production = boards.items.find((b) => b.kind === 'production');
  if (!production) throw new Error('no Production board');
  // With one, the card says so and opens it.
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Produzione · Già nel progetto', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}`));

  // It opens on Schedule, with Crew beside it.
  await expect(page.getByRole('tab', { name: 'Piano riprese', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Troupe', exact: true })).toBeVisible();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await schedule.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  await expect(schedule.locator('.schedule__day')).toHaveCount(1);
  const queue = schedule.locator('.schedule__queue');
  // The queue groups the frames by storyboard, each with its dot.
  await expect(queue.locator('.schedule__source-title')).toHaveText(['Teaser', 'Film']);
  const filter = queue.getByRole('button', { name: 'Filtra per storyboard' });
  await chooseSelect(filter, { label: 'Teaser' });
  await expect(queue.locator('.schedule__source-title')).toHaveText(['Teaser']);
  await queue.locator('.schedule__shot:not(.schedule__shot--scene)', { hasText: '1A' }).click();
  await chooseSelect(filter, { label: 'Film' });
  await queue.locator('.schedule__shot:not(.schedule__shot--scene)', { hasText: '1A' }).click();
  // A scene planned as a whole, before its frames are drawn (answer 4).
  await queue.locator('.schedule__shot--scene', { hasText: 'Ancora senza inquadrature' }).click();
  const blocks = schedule.locator('.schedule__day .schedule__block');
  await expect(blocks).toHaveCount(3);
  await expect(blocks.nth(0).locator('.schedule__dot[aria-label="Teaser"]')).toBeVisible();
  await expect(blocks.nth(1).locator('.schedule__dot[aria-label="Film"]')).toBeVisible();
  await expect(blocks.nth(2)).toContainText('Sc. 2');
  await expect(schedule.locator('.schedule__status')).toHaveText(/Salvato alle/);

  // Saved with each block's storyboard and its label as last seen (decision 0123).
  const saved = (await (
    await page.request.get(`/api/v1/boards/${production.id}/schedule`)
  ).json()) as { items: Array<{ blocks: Array<Record<string, unknown>> }> };
  expect(saved.items[0]?.blocks).toMatchObject([
    { type: 'shot', shotBoardId: teaser, shotLabel: '1A' },
    { type: 'shot', shotBoardId: film, shotLabel: '1A' },
    { type: 'scene', sceneBoardId: film, sceneLabel: '2' },
  ]);

  // A storyboard of the project lost Schedule and Crew, and leads to the Production board.
  await page.goto(`/p/${project.id}/b/${film}`);
  await expect(page.getByRole('tab', { name: 'Storyboard', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Piano riprese', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Giornate di ripresa: 1 · Apri Produzione', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/b/${production.id}`));

  // The Teaser goes to the trash: its block keeps its label, with the grey dot.
  const trashed = await page.request.delete(`/api/v1/boards/${teaser}`, { headers });
  expect(trashed.ok()).toBe(true);
  await page.reload();
  await expect(blocks).toHaveCount(3);
  await expect(blocks.nth(0)).toContainText('1A');
  await expect(
    blocks.nth(0).locator('.schedule__dot[aria-label="Storyboard non disponibile"]'),
  ).toBeVisible();
  await expect(queue.locator('.schedule__source-title')).toHaveText(['Film']);
});

/** Opens a storyboard and draws its scenes, each with this many frames. */
async function drawScenes(page: Page, projectId: string, boardId: string, frames: number[]) {
  await page.goto(`/p/${projectId}/b/${boardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  for (const [i, count] of frames.entries()) {
    await page.getByRole('button', { name: 'Nuova scena', exact: true }).last().click();
    const scene = page.getByRole('region', { name: `Scena ${i + 1}`, exact: true });
    await expect(scene).toBeVisible();
    for (let n = 0; n < count; n++) {
      await scene.getByRole('button', { name: 'Nuova inquadratura', exact: true }).last().click();
      await page.keyboard.press('Escape');
    }
    await expect(scene.locator('.story__tile')).toHaveCount(count);
  }
}
