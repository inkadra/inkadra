import type { Page } from '@playwright/test';

/**
 * An action of a card's menu: a menu item, or on a phone (#110) a button of the card's sheet.
 */
export function cardAction(page: Page, name: string | RegExp, exact = typeof name === 'string') {
  return page
    .getByRole('menuitem', { name, exact })
    .or(page.locator('.card-sheet').getByRole('button', { name, exact }));
}

/** Adds a card from the bar, or from its "More" menu on a phone, where most tools wait (#110). */
export async function addFromBar(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await page.getByRole('button', { name, exact: true }).click();
    return;
  }
  const toolbar = page.locator('.canvas .toolbar');
  await toolbar.getByRole('button', { name: 'Altro', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}
