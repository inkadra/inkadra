// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The date field alone, in a dialog and a form, from the Vite server of this run
// (playwright.config.ts starts it; date-field.config.ts runs it in Firefox and WebKit too).
const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
const vite = `http://127.0.0.1:${process.env.E2E_VITE_PORT ?? '5179'}`;
const fixture = `<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
import React from '/@id/react';
import ReactDOM from '/@id/react-dom/client';
import '/@fs/${root}/packages/ui/src/styles.css';
const { DateField } = await import('/@fs/${root}/packages/ui/src/date-field.tsx');
function Fixture() {
  const [value, setValue] = React.useState(new URLSearchParams(location.search).get('value') ?? '2026-11-20');
  return React.createElement('dialog', { open: true, onKeyDown: (e) => { if (e.key === 'Escape') e.currentTarget.close(); }, style: { top: '35%', width: '280px' } },
    React.createElement('form', { onSubmit: (e) => { e.preventDefault(); window.submitted = true; } },
      React.createElement(DateField, { label: 'Due', name: 'due', value, onChange: setValue, required: true, min: '2026-11-16', max: '2027-12-31' }),
      React.createElement('button', { type: 'submit' }, 'Submit')));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
</script></body></html>`;
const open = (page: import('@playwright/test').Page, value?: string) =>
  page.goto(`${vite}/__date-field${value === undefined ? '' : `?value=${value}`}`);

test.beforeEach(async ({ page }) => {
  await page.route(`${vite}/__date-field*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
});

test('chooses another month entirely with the keyboard', async ({ page }) => {
  await open(page);
  await page.locator('.ink-date__input').press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.ink-date__heading')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('.ink-date__body .ink-date__month[tabindex="0"]')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await expect(page.locator('.ink-date__body .ink-date__month[tabindex="0"]')).toHaveText('Sep');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  // September is outside min: the focused date cannot be selected.
  await expect(page.locator('.ink-date__panel')).toBeVisible();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ink-date__input')).toHaveValue('2026-12-20');
});

test('touch forms still check required and the bounds', async ({ page }, info) => {
  test.skip(
    info.project.name === 'webkit' && process.platform === 'win32',
    'Windows WebKit does not implement native date validity',
  );
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === '(pointer: coarse)' ? { ...original(query), matches: true } : original(query);
  });
  for (const [value, valid] of [
    ['', false],
    ['2026-11-15', false],
    ['2028-01-01', false],
    ['2026-11-20', true],
  ] as const) {
    await open(page, value);
    await expect(page.locator('.ink-date__input')).toHaveAttribute('inputmode', 'none');
    expect(
      await page.locator('form').evaluate((form: HTMLFormElement) => form.checkValidity()),
    ).toBe(valid);
    await page.getByRole('button', { name: 'Submit' }).click();
    expect(
      await page.evaluate(() => Boolean((window as Window & { submitted?: boolean }).submitted)),
    ).toBe(valid);
  }
});

test('Escape from the input closes only the calendar inside a dialog', async ({ page }) => {
  await open(page);
  const input = page.locator('.ink-date__input');
  await input.press('Enter');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ink-date__panel')).toHaveCount(0);
  await expect(page.locator('dialog')).toBeVisible();
});

test('a pointer-focused disabled day never activates the previous cursor', async ({ page }) => {
  await open(page);
  await page.locator('.ink-date__input').click();
  const day = page.locator('.ink-date__body [data-day="2026-11-15"]');
  // Playwright correctly treats aria-disabled as disabled; dispatch the real pointer sequence.
  const box = await day.boundingBox();
  if (!box) throw new Error('Missing day');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(day).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ink-date__panel')).toBeVisible();
  await expect(page.locator('.ink-date__input')).toHaveValue('2026-11-20');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ink-date__body [data-day="2026-11-16"]')).toBeFocused();
});

for (const touch of [true, false]) {
  test.describe(touch ? 'landscape touch' : '200% zoom equivalent', () => {
    test.use({
      viewport: touch ? { width: 844, height: 390 } : { width: 640, height: 360 },
      hasTouch: touch,
    });
    test('keeps the panel inside the viewport and scrolls to its footer', async ({
      page,
    }, info) => {
      await open(page);
      const field = page.locator('.ink-date__input');
      // A tap leaves no hover on the day that opens under the finger.
      await (touch ? field.tap() : field.click());
      const panel = page.locator('.ink-date__panel');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      expect(await panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
      await panel.getByRole('button', { name: 'Today', exact: true }).scrollIntoViewIfNeeded();
      await expect(panel.getByRole('button', { name: 'Today', exact: true })).toBeInViewport();
      if (process.env.DATE_FIELD_SCREENSHOTS) {
        mkdirSync(process.env.DATE_FIELD_SCREENSHOTS, { recursive: true });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
          await panel.evaluate((el) => (el.scrollTop = 0));
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: `${process.env.DATE_FIELD_SCREENSHOTS}/${info.project.name}-${touch ? 'landscape' : 'zoom'}-${theme}.png`,
          });
        }
      }
    });
  });
}
