import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';
import { addSceneWithFrames } from '../helpers/storyboard.ts';
import { turnOn } from '../helpers/views.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator and the project exist.
test.describe.configure({ mode: 'serial' });

const admin = { email: 'giulia@example.com', password: 'correct-horse-battery' };

async function openProject(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Ultima corsa', exact: true }).first().click();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
}

test('a storyboard holds scenes and frames, the shot list shows the same frames', async ({
  page,
}) => {
  await openProject(page);
  await page.keyboard.press('s');
  const card = page.locator('[data-type="board"]', { hasText: 'Storyboard' });
  await expect(card).toHaveCount(1);
  await page.keyboard.type('Binario 21');
  await page.keyboard.press('Escape');
  await expect(card).toContainText('Binario 21');
  await card.dblclick();
  await expect(page.getByRole('tab', { name: 'Storyboard' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await addSceneWithFrames(page);
  const scene = page.getByRole('region', { name: 'Scena 1' });
  await expect(scene.locator('.story__tile')).toHaveCount(3);
  await scene.getByLabel('Luogo', { exact: true }).fill('Stazione');
  await scene.getByLabel('Luogo', { exact: true }).press('Enter');
  await chooseSelect(scene.getByLabel('Interno o esterno'), 'ext');
  await chooseSelect(scene.getByLabel('Momento', { exact: true }), 'night');
  if (process.env.SELECT_SCREENSHOTS) {
    await page.screenshot({ path: '../docs/screenshots/ui-select/storyboard-scene-header.png' });
    const trigger = scene.getByLabel('Interno o esterno');
    await trigger.click();
    await page.screenshot({ path: '../docs/screenshots/ui-select/quiet-open-desktop-dark.png' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await trigger.click();
    await page.screenshot({ path: '../docs/screenshots/ui-select/quiet-open-desktop-light.png' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
  }

  await scene.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  const panel = page.getByRole('complementary', { name: 'Dettagli' });
  await expect(panel.getByText('1D')).toBeVisible();
  await panel
    .getByLabel('Azione', { exact: true })
    .fill('Il treno entra, il neon le taglia il viso');
  await chooseSelect(panel.getByLabel('Campo', { exact: true }), 'cu');
  await expect(page.getByText('4 inquadrature').first()).toBeVisible();

  // The pen: one line is one stroke in the frame.
  await panel.getByRole('button', { name: 'Disegna' }).click();
  const pen = page.getByRole('dialog', { name: /Disegno · 1D/ });
  const area = pen.locator('.pen__area');
  const box = await area.boundingBox();
  if (!box) throw new Error('no drawing area');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * 0.5);
  }
  await page.mouse.up();
  await expect(area.locator('.frame-pic__ink path')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(area.locator('.frame-pic__ink path')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(area.locator('.frame-pic__ink path')).toHaveCount(1);
  await pen.getByRole('button', { name: 'Fatto' }).click();
  await expect(page.locator('.story__tile .frame-pic__ink path')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Shot list' }).click();
  await expect(page).toHaveURL(/view=shotlist/);
  const row = page.getByRole('row', { name: /1D/ });
  if (process.env.SELECT_SCREENSHOTS)
    await page.screenshot({ path: '../docs/screenshots/ui-select/shot-list-cell.png' });

  await expect(row.getByLabel('Azione', { exact: true })).toHaveValue(/Il treno entra/);
  await expect(row.getByLabel('Campo', { exact: true })).toHaveAttribute('data-value', 'cu');
  await expect(page.locator('.shots__scene')).toContainText('EST. STAZIONE – NOTTE');

  // A storyboard is not a board to draw on: no canvas, and nothing outside it (decision 0121).
  await expect(page.getByRole('tab', { name: 'Lavagna' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu della board' }).click();
  await expect(page.getByRole('menuitem', { name: /^Card fuori dallo storyboard/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('search finds the frame and opens it where it is', async ({ page }) => {
  await openProject(page);
  // The index is written when the collaboration server stores the board, a few seconds later.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Cerca' });
    await dialog.getByRole('combobox').fill('neon');
    await expect(dialog.getByRole('option', { name: /1D/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('option', { name: /1D/ }).click();
  // The frame opens in the Storyboard view, selected with its panel open.
  await expect(page.getByRole('complementary', { name: 'Dettagli' }).getByText('1D')).toBeVisible();
  await expect(page).not.toHaveURL(/view=|el=/);
});

test('the board menu presents from another view and renames in place', async ({ page }) => {
  await openProject(page);
  await page.locator('[data-type="board"]', { hasText: 'Binario 21' }).dblclick();
  await page.getByRole('tab', { name: 'Shot list' }).click();
  const menu = page.getByRole('button', { name: 'Menu della board' });

  await menu.click();
  await page.getByRole('menuitem', { name: 'Rinomina' }).click();
  const title = page.getByRole('textbox', { name: 'Titolo della board' });
  await expect(title).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(title).toHaveCount(0);

  await menu.click();
  await page.getByRole('menuitem', { name: 'Presenta' }).click();
  const exit = page.getByRole('button', { name: 'Esci Esc' });
  await expect(exit).toBeVisible();
  await expect(page).not.toHaveURL(/present=/);
  await expect(page).not.toHaveURL(/view=shotlist/);
  await exit.click();
  await expect(exit).toHaveCount(0);
});

test('arrows join two cards and keep a label', async ({ page }) => {
  await openProject(page);
  const canvas = page.getByTestId('canvas');
  const notes = page.locator('[data-type="note"]');
  const first = notes.filter({ hasText: 'Sopralluogo al porto' });
  const second = notes.filter({ hasText: 'Casting comparse' });
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (!a || !b) throw new Error('notes missing');
  await page.keyboard.press('a');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  const arrow = canvas.locator('g[data-type="arrow"]');
  await expect(arrow).toHaveCount(1);
  await arrow.locator('.arrows__hit').dblclick({ force: true });
  await page.getByLabel('Etichetta della freccia').fill('poi');
  await page.keyboard.press('Enter');
  await expect(canvas.locator('.arrows__label')).toHaveText('poi');
  await page.reload();
  await expect(page.locator('.arrows__label')).toHaveText('poi');
});

test('the command palette offers no templates', async ({ page }) => {
  await openProject(page);
  await page.keyboard.press('/');
  const palette = page.getByRole('dialog', { name: 'Comandi' });
  await palette.getByRole('combobox').fill('modello');
  await expect(palette.getByRole('option')).toHaveCount(0);
});

test('opening a note edits its real document and preserves the canvas editor', async ({ page }) => {
  await openProject(page);
  const note = page.locator('[data-type="note"]').filter({ hasText: 'Sopralluogo al porto' });
  await note.dblclick();
  const editor = note.locator('[contenteditable=true]');
  await expect(editor).toContainText('Sopralluogo al porto');
  await expect(editor).not.toContainText('Antonio guida');
  await editor.fill('Sopralluogo al porto — aggiornato');
  await page.getByRole('button', { name: 'Fatto', exact: true }).click();
  await expect(note).toContainText('aggiornato');
  const other = page.locator('[data-type="note"]').filter({ hasText: 'Casting comparse' });
  await other.dblclick();
  await expect(other.locator('[contenteditable=true]')).toContainText('Casting comparse');
  await expect(page.locator('[contenteditable=true]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
  await note.dblclick();
  await expect(editor).toContainText('Sopralluogo al porto — aggiornato');
  await page.keyboard.press('Escape');
  await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
});

test('shell views use real shots and the call sheet traps and restores focus', async ({ page }) => {
  await openProject(page);
  await page.locator('[data-type="board"]', { hasText: 'Binario 21' }).dblclick();
  await turnOn(page, 'Piano riprese');
  await turnOn(page, 'Revisione');
  await page.getByRole('tab', { name: 'Piano riprese' }).click();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await expect(schedule).toContainText('Il treno entra');
  // The call sheet is generated from the saved shooting days.
  await schedule.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  await expect(schedule.locator('.schedule__day').first()).toBeVisible();
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  const inspector = schedule.getByRole('complementary', { name: 'Dettagli del giorno di riprese' });
  await expect(inspector.getByLabel('Data', { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  const openSheet = schedule.getByRole('button', { name: 'Foglio di lavorazione' });
  await openSheet.click();
  const dialog = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
  const close = dialog.getByRole('button', { name: 'Chiudi', exact: true });
  const daySelect = dialog.getByRole('combobox', { name: 'Data', exact: true });
  const print = dialog.getByRole('button', { name: 'Stampa / esporta' });
  await expect(dialog).toBeVisible();
  await expect(daySelect).toBeEnabled();
  await daySelect.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(print).toBeEnabled();
  await expect(
    dialog.getByRole('article', { name: 'Anteprima foglio di lavorazione' }),
  ).toContainText('Revisione 1');
  await expect(dialog).not.toContainText('Demo · non salvato');
  // Focus lands inside the dialog, on its first control, never on the page behind it.
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  // Native dialogs allow the browser chrome in the Tab cycle, but never the page behind.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 3; step++) {
      await page.keyboard.press(key);
      expect(
        await dialog.evaluate(
          (element) =>
            document.activeElement === document.body || element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
  }
  await close.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(openSheet).toBeFocused();
  await page.getByRole('tab', { name: 'Revisione', exact: true }).click();
  const review = page.getByRole('region', { name: 'Revisione', exact: true });
  // Review rounds do not exist yet, so the view shows no submit action for them.
  await expect(review.getByRole('button', { name: 'Invia revisione' })).toHaveCount(0);
  // The view reads the saved decisions: frames, progress and filters are real.
  await expect(review.getByRole('button', { name: /1A/ })).toBeVisible();
  await expect(review.getByRole('progressbar')).toBeVisible();
  const all = review.getByRole('radio', { name: 'Tutte le inquadrature', exact: true });
  await expect(all).toBeEnabled();
  await expect(all).toBeChecked();
});
