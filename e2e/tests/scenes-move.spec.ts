// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';
import { buildScriptPdf } from '../../apps/web/src/board/film/screenplay/fixtures/script-pdf.ts';

/**
 * Decision 0140: scenes live in storyboards. Scenes left on an ordinary board (here from a
 * screenplay import with Storyboard off) are offered once to move; they move with their frames
 * in one step that Undo takes back; with several storyboards the dialog asks, the one opened
 * last chosen; the canvas menu makes new scenes in a storyboard.
 */
// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
// A folder for light and dark screenshots at 1280 and 390 px (review only, never committed).
const shots = process.env.SCENES_MOVE_SHOTS;

async function signedIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

async function preferences(page: Page, data: object) {
  const response = await page.request.patch('/api/v1/me/preferences', {
    headers: { origin: new URL(page.url()).origin },
    data,
  });
  expect(response.ok()).toBe(true);
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      localStorage.setItem('inkadra.theme', value);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/${name}-${phone ? '390' : '1280'}-${theme}.png` });
  }
}

async function newProject(page: Page, name: string) {
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin },
    data: { name },
  });
  expect(created.ok()).toBe(true);
  return (await created.json()) as { id: string; rootBoardId: string };
}

async function newStoryboard(
  page: Page,
  project: { id: string; rootBoardId: string },
  title: string,
) {
  const made = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin: new URL(page.url()).origin },
    data: { parentBoardId: project.rootBoardId, kind: 'storyboard', title },
  });
  expect(made.ok()).toBe(true);
  return ((await made.json()) as { id: string }).id;
}

/** A screenplay dropped on the board with Storyboard off: its scenes arrive as cards. */
async function importScenes(page: Page, phone: boolean) {
  const bytes = [...(await buildScriptPdf())];
  const dt = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(data)], 'ultimo-treno.pdf', { type: 'application/pdf' }),
    );
    return transfer;
  }, bytes);
  await page
    .locator('.canvas')
    .dispatchEvent('drop', { dataTransfer: dt, clientX: phone ? 75 : 400, clientY: 260 });
  const hint = page.locator('.screenplay-hint');
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await hint.getByRole('button', { name: 'Importa le scene…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
  await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

const scenes = (page: Page) => page.locator('[data-type="scene"]');

for (const width of [1280, 390]) {
  const phone = width < 768;
  test(`loose scenes move to a storyboard, and back (${width} px)`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: phone ? 844 : 800 });
    await signedIn(page);
    await preferences(page, { modulesOff: ['storyboard'], moduleNotices: [] });
    const project = await newProject(page, `Scene ${width}`);
    try {
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
      await importScenes(page, phone);
      // Storyboard off: the one notice says what Storyboard would do, with Turn on.
      const imported = page.locator('.ink-toast', {
        hasText: 'Accendi Storyboard e vanno in uno storyboard tutto loro.',
      });
      await expect(imported).toBeVisible();
      await expect(imported.getByRole('button', { name: 'Accendi', exact: true })).toBeVisible();
      await shoot(page, 'import-notice');
      await expect(scenes(page).first()).toBeVisible();
      // No notice of loose scenes while the module is off.
      await expect(page.locator('.loose-scenes')).toHaveCount(0);

      // Turned on later: the board offers once to move them.
      await preferences(page, { modulesOff: [] });
      await newStoryboard(page, project, 'Ultimo treno');
      await page.reload();
      const notice = page.locator('.loose-scenes');
      await expect(notice).toContainText(
        /Su questa board ci sono \d+ scene fuori da uno storyboard\./,
      );
      // The canvas draws only the cards on screen: the notice, like the ⋯ menu, counts them all.
      const count = Number((await notice.textContent())?.match(/ci sono (\d+) scene/)?.[1]);
      expect(count).toBeGreaterThan(1);
      await shoot(page, 'notice');

      // One storyboard: no question. The scenes go, its card takes their place.
      await notice.getByRole('button', { name: 'Sposta in uno storyboard' }).click();
      const moved = page.locator('.ink-toast', { hasText: '«Ultimo treno»' });
      await expect(moved).toBeVisible({ timeout: 20_000 });
      await expect(scenes(page)).toHaveCount(0);
      await expect(page.locator('[data-type="board"]')).toHaveCount(1);
      await expect(notice).toHaveCount(0);
      await shoot(page, 'moved');

      // Undo takes everything back: the scenes return, the card goes.
      await moved.getByRole('button', { name: 'Annulla' }).click();
      await expect(scenes(page).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-type="board"]')).toHaveCount(0);
      // Answered once: the notice does not come back, the ⋯ menu keeps the action.
      await page.reload();
      await expect(scenes(page).first()).toBeVisible();
      await expect(notice).toHaveCount(0);

      if (!phone) {
        // The canvas menu makes scenes in the storyboard; a frame stays a reference card.
        await page.locator('.canvas').click({ button: 'right', position: { x: 900, y: 600 } });
        const menu = page.getByRole('menu', { name: 'Azioni della board' });
        await expect(
          menu.getByRole('menuitem', { name: /Nuova scena nello storyboard…/ }),
        ).toContainText('Ultimo treno');
        await expect(menu.getByRole('menuitem', { name: /Aggiungi: Inquadratura/ })).toContainText(
          'Una card singola, come riferimento',
        );
        await shoot(page, 'canvas-menu');
        await page.keyboard.press('Escape');
      }

      // Two storyboards: the dialog asks, with the one opened last chosen.
      const teaser = await newStoryboard(page, project, 'Teaser');
      await page.goto(`/p/${project.id}/b/${teaser}`);
      await expect(page.getByRole('button', { name: 'Menu della board' })).toBeVisible();
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
      await expect(scenes(page).first()).toBeVisible();
      await page.getByRole('button', { name: 'Menu della board' }).click();
      await page
        .getByRole('menuitem', { name: `Sposta le scene in uno storyboard (${count})` })
        .click();
      const dialog = page.getByRole('dialog', { name: `Sposta ${count} scene in uno storyboard` });
      await expect(dialog.getByRole('radio', { name: /Teaser/ })).toBeChecked();
      await expect(dialog.getByRole('radio', { name: /Ultimo treno/ })).not.toBeChecked();
      await expect(dialog.getByRole('radio', { name: /Nuovo storyboard/ })).toBeVisible();
      await shoot(page, 'dialog');
      await dialog.getByRole('button', { name: 'Sposta', exact: true }).click();
      await expect(page.locator('.ink-toast', { hasText: '«Teaser»' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(scenes(page)).toHaveCount(0);

      // In the storyboard they are scenes of its own, after its last one.
      await page.goto(`/p/${project.id}/b/${teaser}`);
      await expect(page.locator('[data-story-scene]')).toHaveCount(count);
    } finally {
      await preferences(page, { modulesOff: [], moduleNotices: [] });
    }
  });
}
