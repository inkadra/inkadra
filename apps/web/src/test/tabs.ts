import { act } from 'react';
import { expect } from 'vitest';

/**
 * Walks a tablist by keyboard and checks the tabs pattern: one tab stop on the chosen tab, its
 * panel labelled by it, the arrows wrapping, Home and End at the ends, and nothing chosen on the
 * way. The list must be in the document.
 */
export async function walkTabs(list: Element | null | undefined) {
  if (!list) throw new Error('Tablist missing');
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const chosen = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
  if (!chosen || tabs.length < 2) throw new Error('A chosen tab and another are needed');
  expect(list.getAttribute('aria-label')).toBeTruthy();
  expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([chosen]);
  const panel = document.getElementById(chosen.getAttribute('aria-controls') ?? '');
  expect(panel?.getAttribute('role')).toBe('tabpanel');
  expect(panel?.getAttribute('aria-labelledby')).toBe(chosen.id);
  const press = (key: string) =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    });
  chosen.focus();
  await press('End');
  expect(document.activeElement).toBe(tabs.at(-1));
  await press('ArrowRight');
  expect(document.activeElement).toBe(tabs[0]);
  await press('ArrowLeft');
  expect(document.activeElement).toBe(tabs.at(-1));
  await press('Home');
  expect(document.activeElement).toBe(tabs[0]);
  await press('ArrowRight');
  expect(document.activeElement).toBe(tabs[1]);
  expect(chosen.getAttribute('aria-selected')).toBe('true');
}
