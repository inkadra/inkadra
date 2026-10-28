// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
const fixture = (
  scenario: string,
) => `<html><head></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/i18n/index.ts';
import '/@fs/${root}/packages/ui/src/styles.css';
import '/src/board/board.css';
import '/src/board/film/film.css';
const { setAssetLoader } = await import('/src/board/assets.ts');
const { MediaViewer } = await import('/src/board/viewer.tsx');
const mk = (id, kind, w, h, url) => ({ id, projectId: 'p', kind, mime: kind === 'video' ? 'video/mp4' : 'image/svg+xml', filename: id + '.file', size: 1, sha256: null, width: w, height: h, durationMs: null, status: 'ready', url, variants: [], exif: null, palette: null, animated: false, sourceUrl: null, createdAt: '2026-01-01T00:00:00.000Z' });
const assets = {
  land: mk('land', 'image', 1600, 900, '/img/land.svg'),
  port: mk('port', 'image', 900, 1600, '/img/port.svg'),
  vid: mk('vid', 'video', 1920, 1080, '/img/broken.mp4'),
};
setAssetLoader(async (id) => assets[id] ?? null);
const base = { x: 0, y: 0, w: 320, h: 200, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
const yt = { ...base, id: 'yt', type: 'link', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A cinematic reference with a long title', tags: ['reference'] };
const img = (id, assetId) => ({ ...base, id, type: 'image', assetId, caption: 'Image ' + id, tags: ['reference'] });
const sc = ${JSON.stringify(scenario)};
const element = sc === 'yt' || sc === 'yt-compare' ? yt : sc === 'portrait' ? img('i2', 'port') : sc === 'video' ? { ...img('v1', 'vid'), type: 'video' } : img('i1', 'land');
const comparison = sc.endsWith('compare') ? img('c1', 'land') : undefined;
const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), type: 'image', assetId: 'land', filename: 'Reference ' + (i + 1) }));
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MediaViewer, { store: {}, element, projectId: 'p', userId: 'u', readOnly: true, onClose: () => {}, gallery: { index: 3, total: 5, onPrevious: () => {}, onNext: () => {}, onSelect: () => {}, onCompare: () => {}, comparison, usedIn: [], items } }));
</script></body></html>`;

for (const [width, height] of [
  [1280, 800],
  [412, 915],
  [768, 1024],
  [915, 412],
]) {
  test(`viewer layout ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/embed/**', (route) =>
      route.fulfill({ body: '<body></body>', contentType: 'text/html' }),
    );
    await page.route('**/__shot', (route) =>
      route.fulfill({ body: fixture('yt'), contentType: 'text/html' }),
    );
    await page.goto('http://127.0.0.1:5179/__shot');
    const iframe = await page.locator('.viewer__iframe').boundingBox();
    const thumbs = await page.locator('.viewer__thumbnails').boundingBox();
    const title = await page.locator('.viewer__stage-title').boundingBox();
    const close = await page.locator('.viewer__stage-header button').last().boundingBox();
    expect(title?.width).toBeGreaterThan(0);
    expect(close!.x + close!.width).toBeLessThanOrEqual(width);
    expect(iframe!.y + iframe!.height).toBeLessThanOrEqual(thumbs!.y);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await page.screenshot({
        path: `${root}/docs/screenshots/viewer-fixes/after-${width === 1280 ? 'desktop' : width === 412 ? 'phone' : width}-${theme}.png`,
      });
    }
    if (width === 1280) expect(iframe!.width).toBeGreaterThanOrEqual(900);
    expect(
      await page
        .locator('.viewer__stage-counter')
        .evaluate(
          (el) =>
            el.scrollHeight === el.clientHeight && getComputedStyle(el).whiteSpace === 'nowrap',
        ),
    ).toBe(true);
  });
}
