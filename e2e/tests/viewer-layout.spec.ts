// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
const fixture = (
  scenario: string,
) => `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
import React from '/@id/react';
import ReactDOM from '/@id/react-dom/client';
import '/src/i18n/index.ts';
import '/@fs/${root}/packages/ui/src/styles.css';
import '/src/board/board.css';
import '/src/board/film/film.css';
import '/src/routes/mobile-shell.css';
const nav = document.createElement('nav'); nav.className = 'mobile-bottom-nav'; nav.textContent = 'Home Projects New Inbox Profile'; document.body.append(nav);
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
if (sc === 'shell') {
  nav.remove();
  // Inline HTML bypasses Vite's import rewriting: reuse the app's exact optimized URL.
  const source = await (await fetch('/src/routes/AppLayout.tsx')).text();
  const routerUrl = source.match(/from "([^"]*react-router[^"]*)"/)[1];
  const { MemoryRouter, Routes, Route } = await import(routerUrl);
  const { AppLayout } = await import('/src/routes/AppLayout.tsx');
  const { SessionProvider, useSession } = await import('/src/lib/session.tsx');
  function Loaded() { const { loading } = useSession(); return loading ? null : React.createElement(Routes, null, React.createElement(Route, { element: React.createElement(AppLayout) }, React.createElement(Route, { path: '*', element: React.createElement('div', { className: 'canvas' }, React.createElement('div', { className: 'canvas__corner' }, 'Minimap'), React.createElement('div', { className: 'toolbar' }, 'Toolbar')) }))); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, { initialEntries: ['/p/p/b/b'] }, React.createElement(SessionProvider, null, React.createElement(Loaded))));
} else ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MediaViewer, { store: {}, element, projectId: 'p', userId: 'u', readOnly: true, onClose: () => {}, gallery: { index: 3, total: 5, onPrevious: () => {}, onNext: () => {}, onSelect: () => {}, onCompare: () => {}, comparison, usedIn: [], items } }));
</script></body></html>`;

for (const [width, height] of [
  [1280, 800],
  [1280, 720],
  [1920, 1080],
  [412, 915],
  [768, 1024],
  [915, 412],
] as const) {
  test.describe(`viewport ${width}x${height}`, () => {
    test.use({ hasTouch: width < 1000, isMobile: width < 1000 });
    test(`viewer layout ${width}x${height}`, async ({ page }, testInfo) => {
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
          path: testInfo.outputPath(`after-${width}x${height}-${theme}.png`),
        });
      }
      console.log(JSON.stringify({ width, height, iframe, thumbs }));
      if (width === 412) await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
      expect(iframe!.width).toBeGreaterThanOrEqual(300);
      if (width === 915) {
        await expect(page.locator('.viewer__side')).toBeHidden();
        expect(iframe!.width).toBeGreaterThan(430);
        await page.locator('.viewer__info-toggle').click();
        await expect(page.locator('.viewer__side')).toBeVisible();
      }
      if (width < 1000) {
        for (const button of await page.locator('.viewer__stage-header button:visible').all()) {
          const box = await button.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        for (const hint of await page.locator('.viewer__kbd, .viewer__hints').all()) {
          await expect(hint).toBeHidden();
        }
      }
      expect(
        await page
          .locator('.viewer__stage-counter')
          .evaluate(
            (el) =>
              el.scrollHeight === el.clientHeight && getComputedStyle(el).whiteSpace === 'nowrap',
          ),
      ).toBe(true);
    });
  });
}

test('compare keeps both images inside the stage (#223)', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/__shot', (route) =>
    route.fulfill({ body: fixture('image-compare'), contentType: 'text/html' }),
  );
  await page.route('**/img/*.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="gray"/></svg>',
    }),
  );
  await page.goto('http://127.0.0.1:5179/__shot');
  await expect(page.locator('.viewer__media')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.viewer__media')
        .first()
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(1600);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await page.screenshot({ path: testInfo.outputPath(`compare-${theme}.png`) });
  }
  const stage = (await page.locator('.viewer__stage').boundingBox())!;
  for (const image of await page.locator('.viewer__media').all()) {
    const box = (await image.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(stage.x);
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);
  }
});

test('Inbox restores canvas geometry, opener focus and total shot count', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const project = {
      id: 'p',
      name: 'Last Train',
      rootBoardId: 'b',
      myRole: 'owner',
      type: 'short_film',
      icon: { shape: 'circle', color: 'blue', emoji: null },
    };
    const board = {
      id: 'b',
      projectId: 'p',
      title: 'Storyboard',
      kind: 'storyboard',
      parentId: null,
      order: 'a0',
    };
    const json = path.endsWith('/instance')
      ? { name: 'Inkadra', setupComplete: true }
      : path.endsWith('/me')
        ? { id: 'u', name: 'Test', role: 'member', locale: 'en' }
        : path.endsWith('/board-counts')
          ? { items: [{ boardId: 'b', frameCount: 7, framesToShoot: 6, elementCount: 7 }] }
          : path.endsWith('/boards') && path.includes('/projects/')
            ? { items: [board] }
            : path.endsWith('/projects')
              ? { items: [project], nextCursor: null }
              : { items: [], nextCursor: null, count: 0 };
    return route.fulfill({ json });
  });
  await page.route('**/__shot', (route) =>
    route.fulfill({ body: fixture('shell'), contentType: 'text/html' }),
  );
  await page.goto('http://127.0.0.1:5179/__shot');
  const inbox = page.locator('.ink-sidebar .ink-nav').filter({ hasText: 'Inbox' });
  await expect(inbox).toBeVisible();
  const corner = page.locator('.canvas__corner');
  const toolbar = page.locator('.toolbar');
  const before = await corner.boundingBox();
  const barBefore = await toolbar.boundingBox();
  await inbox.click();
  await page.keyboard.press('Escape');
  await expect.soft(inbox).toBeFocused();
  await expect.poll(async () => (await corner.boundingBox())?.x, { soft: true }).toBe(before!.x);
  expect.soft((await toolbar.boundingBox())!.x).toBe(barBefore!.x);
  const shots = page.locator('.ink-sidebar .ink-nav').filter({ hasText: 'Shot list' });
  await expect.soft(shots).toContainText('7');
  await page.locator('.project-navigation__options').first().click();
  await page.getByRole('menuitem', { name: 'Project appearance' }).click();
  const dialog = page.locator('.project-appearance .ink-dialog');
  const symbolHeight = (await dialog.boundingBox())!.height;
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  expect((await dialog.boundingBox())!.height).toBe(symbolHeight);
});
