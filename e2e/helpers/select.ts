import type { Locator } from '@playwright/test';
/** Exercise the same listbox interaction as a pointer user, waiting for React to render it. */
export async function chooseSelect(trigger: Locator, choice: string | { label: string }) {
  await trigger.click();
  const list = trigger.page().getByRole('listbox');
  if (typeof choice === 'string') {
    await list.locator(`[role="option"][data-value=${JSON.stringify(choice)}]`).click();
  } else {
    await list.getByRole('option', { name: choice.label, exact: true }).click();
  }
}
