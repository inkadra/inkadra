import type { Locator } from '@playwright/test';
/** Exercise the same listbox interaction as a pointer user. */
export async function chooseSelect(trigger: Locator, choice: string | { label: string }) {
  await trigger.click();
  const list = trigger.page().getByRole('listbox');
  if (typeof choice === 'string') {
    const options = list.getByRole('option');
    for (let i = 0; i < (await options.count()); i++) {
      if ((await options.nth(i).getAttribute('data-value')) === choice) {
        await options.nth(i).click();
        return;
      }
    }
    throw new Error(`Missing Select option: ${choice}`);
  } else await list.getByRole('option', { name: choice.label, exact: true }).click();
}
