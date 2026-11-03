// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`map dialog active credit ${width} ${theme}`, async ({ page }, testInfo) => {
      page.on('pageerror', (error) => {
        throw error;
      });
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/api/v1/map-tiles/**', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#808880"/></svg>',
        }),
      );
      await page.route('**/__map-dialog', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
import React from '/@id/react';
import ReactDOM from '/@id/react-dom/client';
import '/src/i18n/index.ts';
import '/@fs/${root}/packages/ui/src/styles.css';
import '/src/board/board.css';
const { BoardContext } = await import('/src/board/context.ts');
const { MapDialog } = await import('/src/board/MapExplore.tsx');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BoardContext.Provider, { value: { mapTiles: '/api/v1/map-tiles/{z}/{x}/{y}', mapAttribution: 'Standard map credit', mapSatelliteAttribution: 'Satellite map credit' } }, React.createElement(MapDialog, { id: 'map', name: 'Milano', place: { lat: 45.46, lon: 9.19, zoom: 16 }, onClose: () => {} })));
</script></body></html>`,
        }),
      );
      await page.goto('http://127.0.0.1:5179/__map-dialog');
      const dialog = page.getByRole('dialog', { name: 'Milano' });
      const standard = dialog.locator('.mcard__credit:not(.mcard__satellite-credit)');
      await expect(standard).toBeVisible();
      await expect(dialog.locator('.leaflet-tile-loaded').first()).toBeVisible();
      const layer = dialog.locator('.mcard__layer');
      await layer.click();
      await expect(layer).toHaveAttribute('aria-pressed', 'true');
      await expect(standard).toBeHidden();
      await expect(dialog.locator('.mcard__satellite-credit')).toBeVisible();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath('satellite.png') });
      await layer.click();
      await expect(layer).toHaveAttribute('aria-pressed', 'false');
      await expect(standard).toBeVisible();
      await expect(dialog.locator('.mcard__satellite-credit')).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath('standard.png') });
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  }
}
