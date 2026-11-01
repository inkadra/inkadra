// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const out = fileURLToPath(new URL('../../docs/screenshots/ui-controls-2/', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

async function open(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Ultimo Treno', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string; rootBoardId: string }>;
}

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`choice controls and tooltips ${device} ${theme}`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height });
      const project = await open(page, baseURL!, theme);

      // Settings that apply at once are switches; short exclusive choices are segments.
      await page.goto('/settings?section=preferences');
      const themes = page.getByRole('group', { name: 'Tema' });
      await expect(
        themes.getByRole('radio', { name: theme === 'dark' ? 'Scuro' : 'Chiaro' }),
      ).toBeChecked();
      await page.screenshot({ path: `${out}/${device}-${theme}-segmented.png` });
      await page.goto('/settings?section=backups');
      const nightly = page.getByRole('switch', { name: 'Backup notturno' });
      await expect(nightly).toBeVisible();
      await page.screenshot({ path: `${out}/${device}-${theme}-switch.png` });

      // Forms keep checkboxes: the export dialog, with its segments and options.
      await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
      await expect(page.locator('.canvas')).toBeVisible();
      const menu = page.getByRole('button', { name: 'Menu della board' });
      if (device === 'desktop' || (await menu.isVisible())) {
        await menu.click();
        await page.getByRole('menuitem', { name: 'Esporta…' }).click();
        const dialog = page.getByRole('dialog', { name: 'Esporta' });
        await dialog.getByRole('button', { name: /Personalizza/ }).click();
        await dialog.getByRole('radio', { name: 'Il team' }).click();
        const cover = dialog.getByRole('checkbox', { name: /Copertina/ });
        await expect(cover).toBeVisible();
        await page.screenshot({ path: `${out}/${device}-${theme}-export.png` });
        const before = await cover.isChecked();
        await cover.click();
        await expect(cover).toBeChecked({ checked: !before });
        // The options were changed by hand: Escape asks before dropping them.
        await page.keyboard.press('Escape');
        await expect(
          dialog.getByRole('alertdialog', { name: 'Scartare le modifiche?' }),
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Continua a modificare' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Scarta' }).click();
        await expect(dialog).toBeHidden();
      }

      if (device === 'desktop') {
        // Hover waits before the chip; it replaces the native title, which is gone.
        const zoomOut = page
          .getByRole('group', { name: 'Zoom' })
          .getByRole('button', { name: 'Riduci' });
        await expect(zoomOut).not.toHaveAttribute('title');
        await zoomOut.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toHaveText('Riduci');
        await page.screenshot({ path: `${out}/${device}-${theme}-tooltip.png` });
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
      }

      // New project: type pills and template cards are radios without a visible circle.
      await page.goto('/');
      if (device === 'desktop') {
        await page.getByRole('button', { name: 'Nuovo progetto' }).first().click();
      } else {
        const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
        await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Crea', exact: true })
          .getByRole('button', { name: 'Nuovo progetto', exact: true })
          .click();
      }
      const setup = page.getByRole('dialog', { name: 'Nuovo progetto' });
      await setup.getByRole('button', { name: /^Dettagli/ }).click();
      const types = setup.getByRole('group', { name: 'Tipo di progetto' });
      await types.getByRole('radio').first().focus();
      await page.keyboard.press('ArrowRight');
      await expect(types.getByRole('radio').nth(1)).toBeChecked();
      await expect(setup.locator('.ink-choice__box')).toHaveCount(0);
      await expect(setup.getByRole('combobox', { name: 'Ruolo' })).toBeVisible();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${out}/${device}-${theme}-new-project.png`, fullPage: true });
      await page.keyboard.press('Escape');

      await page.request.delete(`/api/v1/projects/${project.id}`, {
        headers: { origin: baseURL! },
      });
    });
  }
}
