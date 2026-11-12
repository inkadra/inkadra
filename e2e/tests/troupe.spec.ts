import { expect, test } from '@playwright/test';
import { addStoryboard } from '../helpers/views.ts';

test('crew add, autosave and sheet paste persist across reload', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: new URL(page.url()).origin },
    data: { name: 'Troupe test' },
  });
  const project = await response.json();
  const board = await addStoryboard(page.request, new URL(page.url()).origin, project, ['troupe']);
  await page.goto(`/p/${project.id}/b/${board.id}?view=troupe`);
  await expect(page.getByText('Nessuno in troupe.')).toBeVisible();
  await page.getByRole('button', { name: 'Aggiungi persona', exact: true }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Nome', { exact: true }).fill('Anna Rossi');
  await add.getByRole('button', { name: 'Aggiungi persona', exact: true }).click();
  const panel = page.locator('.troupe__panel');
  await panel.getByLabel('Ruolo', { exact: true }).fill('1° AC');
  await panel.getByLabel('Ruolo', { exact: true }).press('Tab');
  await expect(panel.getByRole('status')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Incolla da foglio', exact: true }).click();
  const paste = page.getByRole('dialog');
  await paste
    .getByLabel('Testo incollato')
    .fill('CAMERA\nAnna Rossi\t1° AC\t+39 3401234567\nLuca Verdi\tDIT\t+39 3407654321');
  await expect(paste.getByText('Già in troupe', { exact: true })).toBeVisible();
  await paste.getByRole('button', { name: 'Aggiungi 1 persona', exact: true }).click();
  await expect(page.locator('.troupe__row')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.troupe__row')).toHaveCount(2);
  await page.locator('.troupe__row').filter({ hasText: 'Anna Rossi' }).click();
  await expect(panel.getByLabel('Ruolo', { exact: true })).toHaveValue('1° AC');
  // On a phone the row's ⋯ button (44px) fits its column: opening its menu shifts no row.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // A person's row is a finger-sized target, as tall as its ⋯ button.
  for (const person of await page.locator('.troupe__person').all())
    expect((await person.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const more = page.getByRole('button', { name: 'Azioni per Luca Verdi', exact: true });
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  const fit = await more.evaluate((button) => {
    const rows = button.closest('.troupe__rows') as HTMLElement;
    return {
      scrolled: rows.scrollLeft,
      inside: button.getBoundingClientRect().right <= rows.getBoundingClientRect().right,
    };
  });
  expect(fit).toEqual({ scrolled: 0, inside: true });
  // Closing a person's sheet leaves the list usable: the next person opens with a real tap.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await page.locator('.troupe__row').filter({ hasText: 'Anna Rossi' }).click();
  const sheet = page.getByRole('dialog', { name: 'Anna Rossi' });
  await expect(sheet).toBeVisible();
  await sheet.locator('.ink-dialog__actions').getByRole('button', { name: 'Chiudi' }).click();
  await expect(sheet).toBeHidden();
  await page.locator('.troupe__row').filter({ hasText: 'Luca Verdi' }).click();
  await expect(page.getByRole('dialog', { name: 'Luca Verdi' })).toBeVisible();
});
