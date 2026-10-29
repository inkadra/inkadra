import { expect, type Page, test } from '@playwright/test';

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
  // S inserts the Storyboard of the Canvas menu: the template's scene and three frames.
  const scene = page.getByRole('region', { name: 'Scena 1' });
  await expect(scene.locator('.story__tile')).toHaveCount(3);
  await scene.getByLabel('Luogo', { exact: true }).fill('Stazione');
  await scene.getByLabel('Luogo', { exact: true }).press('Enter');
  await scene.getByLabel('Interno o esterno').selectOption('ext');
  await scene.getByLabel('Momento', { exact: true }).selectOption('night');

  await scene.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
  const panel = page.getByRole('complementary', { name: 'Dettagli' });
  await expect(panel.getByText('1D')).toBeVisible();
  await panel
    .getByLabel('Azione', { exact: true })
    .fill('Il treno entra, il neon le taglia il viso');
  await panel.getByLabel('Campo', { exact: true }).selectOption('cu');
  await panel.getByLabel('Durata (s)').fill('4,5');
  await panel.getByLabel('Durata (s)').press('Enter');
  await expect(page.getByText('4 inquadrature · 0:08').first()).toBeVisible();

  // The pen: one line is one stroke in the frame.
  await panel.getByRole('button', { name: 'Disegna' }).click();
  const pen = page.getByRole('dialog', { name: /Disegno dell’inquadratura 1D/ });
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
  await expect(row.getByLabel('Azione', { exact: true })).toHaveValue(/Il treno entra/);
  await expect(row.getByLabel('Campo', { exact: true })).toHaveValue('cu');
  await expect(page.locator('.shots__scene')).toContainText('EST. STAZIONE – NOTTE');

  // The same frame is a card on the canvas view of the board.
  await page.getByRole('tab', { name: 'Lavagna' }).click();
  await expect(page.locator('[data-type="scene"]')).toContainText('EST. STAZIONE');
  await expect(page.locator('[data-type="frame"]').filter({ hasText: '1D' })).toHaveCount(1);
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
  await expect(page).toHaveURL(/view=canvas/);
  await expect(page.locator('[data-type="frame"].is-selected')).toBeVisible();
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

test('the empty-board Storyboard template opens a real storyboard with a shot list', async ({
  page,
}) => {
  await openProject(page);
  await page.keyboard.press('b');
  await page.getByLabel('Titolo della board').fill('Modelli');
  await page.getByLabel('Titolo della board').press('Enter');
  await page.locator('[data-type="board"]', { hasText: 'Modelli' }).dblclick();
  await expect(page.getByText('Board vuota')).toBeVisible();
  await page.getByRole('button', { name: /^Storyboard Una board Storyboard/ }).click();
  await expect(page.getByRole('tab', { name: 'Storyboard', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .getByRole('region', { name: 'Scena 1' })
      .getByRole('textbox', { name: 'Titolo', exact: true }),
  ).toHaveValue('Apertura');
  await page.getByRole('tab', { name: 'Shot list' }).click();
  await expect(
    page.locator('.shots__table tbody tr:not(.shots__scene):not(.shots__add-row)'),
  ).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('row', { name: /\b1A\b/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /1C/ })).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Modelli' }).click();
  await expect(page.locator('[data-type="board"]', { hasText: 'Storyboard' })).toHaveCount(1);
});

test('the palette inserts templates on a non-empty board and opens storyboard templates', async ({
  page,
}) => {
  await openProject(page);
  await page.locator('[data-type="board"]', { hasText: 'Modelli' }).dblclick();
  const canvas = page.getByTestId('canvas');
  const existing = page.locator('[data-type="board"]', { hasText: 'Storyboard' });
  await expect(existing).toHaveCount(1);
  await expect(page.locator('.canvas__templates')).toHaveCount(0);

  await page.keyboard.press('/');
  const palette = page.getByRole('dialog', { name: 'Comandi' });
  await palette.getByRole('combobox').fill('modello');
  await expect(palette.getByRole('option')).toHaveCount(3);
  await palette.getByRole('option', { name: 'Inserisci modello: Produzione' }).click();
  await expect(canvas.locator('[data-type="column"]')).toHaveCount(3);
  await expect(canvas.locator('[data-type="column"]', { hasText: 'Da fare' })).toBeVisible();
  const occupied = await existing.boundingBox();
  const columns = await canvas.locator('[data-type="column"]').all();
  if (!occupied) throw new Error('storyboard card missing');
  for (const column of columns) {
    const rect = await column.boundingBox();
    if (!rect) throw new Error('template column missing');
    expect(
      rect.x >= occupied.x + occupied.width ||
        rect.x + rect.width <= occupied.x ||
        rect.y >= occupied.y + occupied.height ||
        rect.y + rect.height <= occupied.y,
    ).toBe(true);
  }
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-type="column"]')).toHaveCount(0);
  await expect(existing).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(canvas.locator('[data-type="column"]')).toHaveCount(3);

  await page.keyboard.press('/');
  await palette.getByRole('combobox').fill('modello: Storyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Shot list' })).toBeVisible();
  await page.getByRole('tab', { name: 'Shot list' }).click();
  await expect(page.getByRole('row', { name: /1B/ })).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Modelli' }).click();
  await expect(canvas.locator('[data-type="column"]')).toHaveCount(3);
  await expect(page.locator('[data-type="board"]', { hasText: 'Storyboard' })).toHaveCount(2);
});

test('opening a note edits its real document and preserves the canvas editor', async ({ page }) => {
  await openProject(page);
  const note = page.locator('[data-type="note"]').filter({ hasText: 'Sopralluogo al porto' });
  await note.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Testo della nota', exact: true });
  const editor = dialog.locator('[contenteditable="true"]');
  await expect(editor).toContainText('Sopralluogo al porto');
  await expect(dialog).not.toContainText('Antonio guida');
  await editor.fill('Sopralluogo al porto — aggiornato');
  await dialog.getByRole('button', { name: 'Modifica sulla board' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(note.locator('[contenteditable="true"]')).toContainText('aggiornato');
  // Opening a sheet ends inline editing: never two editors on the canvas at once.
  await page.locator('[data-type="note"]').filter({ hasText: 'Casting comparse' }).dblclick();
  await expect(editor).toContainText('Casting comparse');
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await note.dblclick();
  await expect(editor).toContainText('Sopralluogo al porto — aggiornato');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('shell views use real shots and the call sheet traps and restores focus', async ({ page }) => {
  await openProject(page);
  await page.locator('[data-type="board"]', { hasText: 'Binario 21' }).dblclick();
  await page.getByRole('tab', { name: 'Piano riprese' }).click();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await expect(schedule).toContainText('Il treno entra');
  // The call sheet is generated from the saved shooting days.
  await schedule.getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true }).click();
  await expect(schedule.locator('.schedule__day').first()).toBeVisible();
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
  await expect(daySelect.locator('option')).toHaveCount(1);
  await expect(print).toBeEnabled();
  await expect(
    dialog.getByRole('article', { name: 'Anteprima foglio di lavorazione' }),
  ).toContainText('Revisione piano');
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
  const all = review.getByRole('button', { name: 'Tutte le inquadrature', exact: true });
  await expect(all).toBeEnabled();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
});
