// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

// Screenshots for the review stay outside the repository (AGENTS.md).
const shots = process.env.SCENE_TO_BRING_SHOTS;
const out = shots ?? join(tmpdir(), 'inkadra-scene-to-bring');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, theme);
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  // No leftover hover in the pictures.
  await page.mouse.move(1, 1);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    // The theme fades its colours: let it finish before the picture.
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
  }
}

/** A project with a Storyboard board of its own, as a project with a Production board has. */
async function storyboard(page: Page, baseURL: string) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.goto('/');
  const headers = { origin: baseURL };
  const project = (await (
    await page.request.post('/api/v1/projects', {
      headers,
      data: { name: 'Salt Line', type: 'short_film' },
    })
  ).json()) as { id: string; rootBoardId: string };
  const board = (await (
    await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, title: 'Storyboard', kind: 'storyboard' },
    })
  ).json()) as { id: string };
  return { url: `/p/${project.id}/b/${board.id}`, headers };
}

test("a scene's To bring makes, ticks and deletes typed lists on the storyboard", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  const { url, headers } = await storyboard(page, baseURL!);
  await page.goto(url);
  await page.getByRole('button', { name: 'Nuova scena', exact: true }).first().click();
  const scene = page.getByRole('region', { name: 'Scena 1', exact: true });
  await scene.getByLabel('Luogo', { exact: true }).fill('Pontile');
  await scene.getByLabel('Luogo', { exact: true }).press('Enter');

  const button = scene.getByRole('button', { name: /^Da portare per la scena 1/ });
  await expect(button).toHaveAccessibleName('Da portare per la scena 1, ancora nessuna lista');
  await button.click();
  const popup = page.getByRole('dialog', { name: 'Da portare per la scena 1' });
  await expect(popup.getByText('Ancora nessuna lista per la scena 1')).toBeVisible();
  await shoot(page, 'empty');

  // A list: the type first, then its name, then its items.
  const addList = async (type: string, name: string, items: string[]) => {
    await popup.getByRole('button', { name: 'Aggiungi lista' }).click();
    await page.getByRole('menuitem', { name: type }).click();
    await expect(popup.getByRole('textbox', { name: 'Nome della lista' })).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    for (const item of items) {
      await expect(popup.getByRole('textbox', { name: 'Elemento' })).toBeFocused();
      await page.keyboard.type(item);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('Escape');
  };
  await addList('Costumi', 'Nora', ['Cappotto di lana grigio', 'Scarponi, taglia 39']);
  await addList('Attrezzeria', 'Pontile', [
    'Corda, 6 m più una di scorta',
    'Biglietto del traghetto',
  ]);
  await expect(popup.getByRole('checkbox')).toHaveCount(4);

  await popup.getByRole('checkbox', { name: 'Cappotto di lana grigio' }).check();
  await popup.getByRole('checkbox', { name: 'Biglietto del traghetto' }).check();
  await expect(button).toHaveAccessibleName('Da portare per la scena 1, 2 di 4 pronti');
  await shoot(page, 'popup');

  await popup.getByRole('button', { name: 'Elimina Scarponi, taglia 39' }).click();
  await expect(popup.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByText('Elemento eliminato')).toBeVisible();

  // The lists live in the storyboard's document: they come back after a reload.
  await page.reload();
  await expect(button).toHaveAccessibleName('Da portare per la scena 1, 2 di 3 pronti');
  await button.click();
  await popup.getByRole('button', { name: 'Opzioni della lista, Pontile' }).click();
  await shoot(page, 'list-menu');
  await page.getByRole('menuitem', { name: 'Elimina lista…' }).click();
  const ask = page.getByRole('dialog', { name: 'Eliminare la lista “Pontile”?' });
  await expect(ask).toBeVisible();
  await shoot(page, 'delete');
  await ask.getByRole('button', { name: 'Elimina lista' }).click();
  await expect(popup.getByRole('checkbox')).toHaveCount(1);
  await expect(button).toHaveAccessibleName('Da portare per la scena 1, 1 di 1 pronti');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();

  // Production off: a scene with lists keeps To bring to read and tick; nothing new.
  await page.request.patch('/api/v1/me/preferences', {
    headers,
    data: { modulesOff: ['production'] },
  });
  try {
    await page.getByRole('button', { name: 'Nuova scena', exact: true }).first().click();
    await page.reload();
    await expect(button).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Scena 2', exact: true }).getByRole('button', {
        name: /^Da portare/,
      }),
    ).toHaveCount(0);
    await button.click();
    await expect(popup.getByRole('button', { name: 'Aggiungi lista' })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Aggiungi un elemento' })).toHaveCount(0);
    await popup.getByRole('checkbox', { name: 'Cappotto di lana grigio' }).uncheck();
    await expect(button).toHaveAccessibleName('Da portare per la scena 1, 0 di 1 pronti');
    await shoot(page, 'production-off');
    if (shots) {
      await page.keyboard.press('Escape');
      await page.request.patch('/api/v1/me/preferences', { headers, data: { modulesOff: [] } });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await button.click();
      await expect(popup).toBeVisible();
      await shoot(page, 'phone');
    }
  } finally {
    await page.request.patch('/api/v1/me/preferences', { headers, data: { modulesOff: [] } });
  }
});
