import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
// DROP_SCREENSHOTS=<folder> saves the marker while dragging and the result there.
const shots = process.env.DROP_SCREENSHOTS;

test('3 images dropped between 1A and 1B become 3 frames with pictures, in order', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const headers = { origin: new URL(page.url()).origin };
  const projectResponse = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Storyboard drop' },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const boardResponse = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers,
    data: { parentBoardId: project.rootBoardId, title: 'Drop storyboard', kind: 'storyboard' },
  });
  expect(boardResponse.status()).toBe(201);
  const board = await boardResponse.json();
  await page.goto(`/p/${project.id}/b/${board.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
  await page.getByRole('button', { name: 'Nuova scena' }).first().click();
  const scene = page.getByRole('region', { name: 'Scena 1' });
  const add = scene.getByRole('button', { name: 'Nuova inquadratura' }).last();
  await add.click();
  await add.click();
  const tiles = scene.locator('.story__tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.locator('.story__tile-label')).toHaveText(['1A', '1B']);
  await page.getByRole('button', { name: 'Chiudi i dettagli' }).click();

  // Three pictures of different widths, so their order can be read back from the tiles.
  const files = await page.evaluateHandle(async () => {
    const data = new DataTransfer();
    for (const [i, width] of [320, 640, 960].entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = (width * 9) / 16;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = ['#20394a', '#d6af6a', '#6a8fd6'][i] as string;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#101b25';
      ctx.font = `${canvas.height / 2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), canvas.width / 2, canvas.height * 0.7);
      const blob = await new Promise<Blob>((done) =>
        canvas.toBlob((b) => done(b as Blob), 'image/png'),
      );
      data.items.add(new File([blob], `drop-${i + 1}.png`, { type: 'image/png' }));
    }
    return data;
  });

  // The gap between 1A and 1B.
  const a = await tiles.nth(0).boundingBox();
  const b = await tiles.nth(1).boundingBox();
  if (!a || !b) throw new Error('no tiles');
  const at = { clientX: (a.x + a.width + b.x) / 2, clientY: a.y + a.height / 2 };
  const grid = scene.locator('.story__grid');
  await grid.dispatchEvent('dragover', { dataTransfer: files, ...at });
  // The insertion marker of the reorder stands before 1B.
  await expect(tiles.nth(1)).toHaveClass(/is-drop/);
  await expect(tiles.nth(0)).not.toHaveClass(/is-drop/);
  if (shots) await page.screenshot({ path: join(shots, 'drop-marker.png') });

  await grid.dispatchEvent('drop', { dataTransfer: files, ...at });
  await expect(tiles).toHaveCount(5);
  await expect(tiles.locator('.story__tile-label')).toHaveText(['1A', '1B', '1C', '1D', '1E']);
  await expect(scene.locator('.is-drop')).toHaveCount(0);
  // One picture per new frame, in the order of the files; the old frames have none.
  const widths = () =>
    tiles.evaluateAll((all) =>
      all.map((tile) => tile.querySelector<HTMLImageElement>('.frame-pic img')?.naturalWidth ?? 0),
    );
  await expect.poll(widths).toEqual([0, 320, 640, 960, 0]);
  if (shots) await page.screenshot({ path: join(shots, 'drop-result.png') });
  await settle(page);

  // They were uploaded: the pictures are still there after a reload.
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const reloaded = page.getByRole('region', { name: 'Scena 1' }).locator('.story__tile');
  await expect(reloaded.locator('.story__tile-label')).toHaveText(['1A', '1B', '1C', '1D', '1E']);
  await expect(reloaded.locator('.frame-pic img')).toHaveCount(3, { timeout: 30_000 });
  await expect(reloaded.nth(0).locator('.frame-pic img')).toHaveCount(0);
  await expect(reloaded.nth(4).locator('.frame-pic img')).toHaveCount(0);
});

/** The Upload panel empties itself a few seconds after the last upload is done. */
async function settle(page: Page) {
  await expect(page.getByRole('region', { name: 'Caricamenti' })).toHaveCount(0, {
    timeout: 30_000,
  });
}
