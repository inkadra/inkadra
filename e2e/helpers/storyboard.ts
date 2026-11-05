import { expect, type Page } from '@playwright/test';

/** Explicit scene fixture, independent of project and board creation. */
export async function addSceneWithFrames(page: Page) {
  await page.getByRole('button', { name: 'Nuova scena', exact: true }).first().click();
  const scene = page.getByRole('region', { name: 'Scena 1', exact: true });
  for (let i = 0; i < 3; i++) {
    await scene.getByRole('button', { name: 'Nuova inquadratura', exact: true }).last().click();
    await page.keyboard.press('Escape');
  }
  await expect(scene.locator('.story__tile')).toHaveCount(3);
}
