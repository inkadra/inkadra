// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';
import { buildScriptPdf } from '../../apps/web/src/board/film/screenplay/fixtures/script-pdf.ts';

/**
 * Decision 0121, step 2: Settings → Modules, the shorter toolbar with More, the Canvas menu of
 * boards to create, and what a module that is off leaves: a dimmed kind with Turn on, the one
 * notice after a screenplay import, and the line on a board of that module.
 */
// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
// A folder for light and dark screenshots at 1280 and 390 px (review only).
const shots = process.env.MODULES_SHOTS;

async function signedIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

/** The account's modules, More and notices, as a new person has them. */
async function resetPreferences(page: Page) {
  const response = await page.request.patch('/api/v1/me/preferences', {
    headers: { origin: new URL(page.url()).origin },
    data: { modulesOff: [], moduleNotices: [], toolbar: null },
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
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const storyboard = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin },
    data: { parentBoardId: project.rootBoardId, kind: 'storyboard', title: 'Ultimo treno' },
  });
  expect(storyboard.ok()).toBe(true);
  return { ...project, storyboardId: ((await storyboard.json()) as { id: string }).id };
}

const modulesSwitch = (page: Page, name: string) => page.getByRole('switch', { name, exact: true });

for (const width of [1280, 390]) {
  const phone = width < 768;
  test(`modules off hide the ways to create, never the data (${width} px)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: phone ? 844 : 800 });
    await signedIn(page);
    await resetPreferences(page);
    const project = await newProject(page, `Modules ${width}`);
    try {
      // Settings → Modules: Board always on, five switches all on.
      await page.goto('/settings?section=modules');
      await expect(page.getByRole('heading', { name: 'Moduli', exact: true })).toBeVisible();
      await expect(page.getByText('Sempre acceso')).toBeVisible();
      await expect(page.getByRole('switch')).toHaveCount(5);
      for (const name of ['Storyboard', 'Produzione', 'Moodboard', 'Revisione clienti'])
        await expect(modulesSwitch(page, name)).toBeChecked();
      // Storyboard and Set plan off, for this person only.
      await modulesSwitch(page, 'Storyboard').click();
      await modulesSwitch(page, 'Pianta del set').click();
      await expect(modulesSwitch(page, 'Storyboard')).not.toBeChecked();
      await expect(
        page.getByText('Spento · Le inquadrature che esistono restano dove sono.'),
      ).toBeVisible();
      await shoot(page, 'modules-page');

      await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
      const toolbar = page.locator('.canvas .toolbar');
      await expect(toolbar).toBeVisible();
      if (!phone) {
        // Always there: Select, Hand, Arrow, Note, Image, Link, To-do; then Column and Section
        // title, More and Canvas.
        for (const name of ['Seleziona', 'Mano', 'Freccia', 'Nota', 'Immagine', 'Link', 'To-do'])
          await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
        await expect(toolbar.getByRole('button', { name: 'Colonna', exact: true })).toBeVisible();
        await expect(toolbar.getByRole('button', { name: 'Tabella', exact: true })).toHaveCount(0);
        await shoot(page, 'toolbar');
        // More lists the other tools, without those of the modules that are off.
        await toolbar.getByRole('button', { name: 'Altri strumenti', exact: true }).click();
        const more = page.locator('.more-tools');
        await expect(more.getByRole('button', { name: 'Tabella', exact: true })).toBeVisible();
        await expect(more.getByRole('button', { name: 'Inquadratura', exact: true })).toHaveCount(
          0,
        );
        await expect(more.getByRole('button', { name: 'Pianta del set', exact: true })).toHaveCount(
          0,
        );
        await more.getByRole('button', { name: 'Metti Tabella nella barra' }).click();
        await expect(
          more.getByRole('button', { name: 'Metti Tabella nella barra' }),
        ).toHaveAttribute('aria-pressed', 'true');
        await shoot(page, 'more');
        await toolbar.getByRole('button', { name: 'Altri strumenti', exact: true }).click();
        await expect(more).toHaveCount(0);
        await expect(toolbar.getByRole('button', { name: 'Tabella', exact: true })).toBeVisible();
      }

      // The Canvas menu: the boards to create; Storyboard stays, dimmed, with Turn on.
      await page.locator('.toolbar__btn--canvas').click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Moodboard', exact: true })).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Storyboard: modulo spento, accendi' }),
      ).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Importa un copione…: modulo spento, accendi' }),
      ).toBeVisible();
      if (phone) await expect(menu.getByRole('menuitem', { name: 'Inquadratura' })).toHaveCount(0);
      await shoot(page, 'canvas-menu');
      await page.locator('.toolbar__btn--canvas').click();
      await expect(menu).toHaveCount(0);

      // A screenplay dropped on the board: its scenes arrive as cards, and once one line says
      // what Storyboard would do.
      const drop = async () => {
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
        await expect(dialog.getByText('Inquadrature per scena')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      };
      await drop();
      const notice = page.locator('.toast', { hasText: 'Con Storyboard diventano inquadrature.' });
      await expect(notice).toBeVisible();
      await expect(page.locator('[data-type="scene"]').first()).toBeVisible();
      await shoot(page, 'notice');
      // It leaves by itself, like the undo notices, and has a close button.
      if (!phone) await expect(notice.getByRole('button', { name: 'Chiudi l’avviso' })).toHaveCount(1);
      await expect(notice).toHaveCount(0, { timeout: 15_000 });

      // A board of a module that is off opens, with one line under its title.
      await page.goto(`/p/${project.id}/b/${project.storyboardId}`);
      const line = page.locator('.board-module-off');
      await expect(line).toContainText('Modulo Storyboard spento: puoi leggere questa board.');
      await shoot(page, 'off-line');
      await line.getByRole('button', { name: 'Accendi', exact: true }).click();
      await expect(line).toHaveCount(0);
    } finally {
      await resetPreferences(page);
    }
  });
}
