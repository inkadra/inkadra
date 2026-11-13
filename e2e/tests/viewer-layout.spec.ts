// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

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
import '/src/pwa/pwa.css';
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
const element = sc === 'yt' ? yt : sc === 'portrait' ? img('i2', 'port') : sc === 'video' ? { ...img('v1', 'vid'), type: 'video' } : img('i1', 'land');
const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), type: 'image', assetId: 'land', filename: 'Reference ' + (i + 1) }));
if (sc === 'appearance') {
  nav.remove();
  const { default: i18n, i18nReady } = await import('/src/i18n/index.ts');
  await i18nReady;
  await i18n.changeLanguage('en');
  const { ProjectAppearanceDialog } = await import('/src/routes/ProjectAppearance.tsx');
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ProjectAppearanceDialog, { project: { id: 'p', name: 'Last Train', myRole: 'owner', icon: { shape: 'circle', color: 'blue', emoji: null } }, onClose: () => {} }));
} else if (sc === 'shell') {
  nav.remove();
  // Inline HTML bypasses Vite's import rewriting: reuse the app's exact optimized URL.
  const source = await (await fetch('/src/routes/AppLayout.tsx')).text();
  const routerUrl = source.match(/from "([^"]*react-router[^"]*)"/)[1];
  const { MemoryRouter, Routes, Route } = await import(routerUrl);
  const { AppLayout } = await import('/src/routes/AppLayout.tsx');
  const { Canvas } = await import('/src/board/Canvas.tsx');
  const { BoardStore } = await import('/src/board/store.ts');
  const { createBoardDoc } = await import('/@fs/${root}/packages/doc-schema/src/index.ts');
  const { createElement } = await import('/@fs/${root}/packages/canvas-core/src/index.ts');
  const doc = createBoardDoc('b');
  createElement(doc, 'color', { x: 100, y: 100 }, { hex: '#808080' }, { userId: 'u' });
  const conn = { store: new BoardStore(doc), provider: null, status: 'synced', readOnly: false };
  const canvas = React.createElement(Canvas, { conn, breadcrumb: [], projectId: 'p', boardId: 'b', userId: 'u', boards: [], canEdit: true, peers: [], onOpenBoard: () => {} });
  const { SessionProvider, useSession } = await import('/src/lib/session.tsx');
  function Loaded() { const { loading } = useSession(); return loading ? null : React.createElement(Routes, null, React.createElement(Route, { element: React.createElement(AppLayout) }, React.createElement(Route, { path: '*', element: React.createElement('div', { style: { display: 'contents' } }, canvas) }))); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, { initialEntries: ['/p/p/b/b'] }, React.createElement(SessionProvider, null, React.createElement(Loaded))));
} else if (sc === 'settings') {
  nav.remove();
  const source = await (await fetch('/src/routes/AppLayout.tsx')).text();
  const routerUrl = source.match(/from "([^"]*react-router[^"]*)"/)[1];
  const { MemoryRouter } = await import(routerUrl);
  const { SessionProvider, useSession } = await import('/src/lib/session.tsx');
  const { SettingsWindow } = await import('/src/routes/SettingsWindow.tsx');
  window.settingsClosed = 0;
  const onClose = () => { window.settingsClosed += 1; };
  function Loaded() { const { loading } = useSession(); return loading ? null : React.createElement(SettingsWindow, { setup: { checks: null, error: false }, onClose, onBack: () => {} }, React.createElement('p', null, 'Settings page')); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, { initialEntries: ['/settings?section=account'] }, React.createElement(SessionProvider, null, React.createElement(Loaded))));
} else ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MediaViewer, { store: {}, element, projectId: 'p', userId: 'u', readOnly: true, onClose: () => {}, gallery: { index: 3, total: 5, onPrevious: () => {}, onNext: () => {}, onSelect: () => {}, usedIn: [], items } }));
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
        await expect(page.locator('.viewer__thumbnails')).toBeHidden();
        await expect(page.locator('.viewer__stage-nav--next')).toBeHidden();
        // The open panel must not cover the player: the stage shrinks to the remaining width.
        const side = (await page.locator('.viewer__side').boundingBox())!;
        const player = (await page.locator('.viewer__iframe').boundingBox())!;
        console.log(JSON.stringify({ infoOpen: { side, player } }));
        expect(player.x + player.width).toBeLessThanOrEqual(side.x);
        expect(player.width).toBeGreaterThan(300);
        for (const theme of ['light', 'dark']) {
          await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
          await page.screenshot({ path: testInfo.outputPath(`info-open-${theme}.png`) });
        }
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

for (const [width, height] of [
  [1280, 800],
  [412, 915],
] as const) {
  test.describe(`image zoom ${width}x${height}`, () => {
    test.use({ hasTouch: width < 1000, isMobile: width < 1000 });
    test('the viewer starts fitted and zooms the image locally', async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/__shot', (route) =>
        route.fulfill({ body: fixture('image'), contentType: 'text/html' }),
      );
      await page.route('**/img/*.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="gray"/></svg>',
        }),
      );
      await page.goto('http://127.0.0.1:5179/__shot');
      const media = page.locator('.viewer__media');
      await expect(media).toHaveCount(1);
      await expect
        .poll(() => media.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBe(1600);
      const viewer = page.locator('.viewer');
      await expect(viewer.getByRole('button', { name: /confronta|compare/i })).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: 'Ingrandisci', exact: true })).toBeVisible();
      await expect(viewer.locator('[aria-keyshortcuts="Space"]')).toHaveCount(0);
      await expect(viewer.locator('.viewer__hints')).not.toContainText(/zoom/i);
      const fitted = async () => {
        const stage = (await page.locator('.viewer__stage').boundingBox())!;
        const box = (await media.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(stage.x);
        expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);
        expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height);
      };
      await fitted();
      await viewer.focus();
      await page.keyboard.press('Space');
      await media.click();
      await expect(media).toBeVisible();
      await fitted();
      await viewer.getByRole('button', { name: 'Ingrandisci', exact: true }).click();
      await expect(viewer.locator('.viewer__image-plane')).toHaveCSS(
        'transform',
        'matrix(1.5, 0, 0, 1.5, 0, 0)',
      );
      await viewer.getByRole('button', { name: '150%', exact: true }).click();
      await fitted();
      await expect(viewer.locator('.viewer__image-view')).toHaveCSS('touch-action', 'none');
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).touchAction),
      ).toBe('auto');
      await page.screenshot({ path: testInfo.outputPath(`fit-${width}x${height}.png`) });
    });
  });
}

async function openShell(page: Page) {
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
  const inbox = page.locator('.ink-sidebar').getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toBeVisible();
  return inbox;
}

test('Inbox restores canvas geometry, opener focus and total shot count', async ({ page }) => {
  const inbox = await openShell(page);
  const corner = page.locator('.canvas__corner');
  const toolbar = page.locator('.toolbar');
  const sidebar = (await page.locator('.ink-sidebar').boundingBox())!;
  const before = await corner.boundingBox();
  expect(before!.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  const barBefore = await toolbar.boundingBox();
  await inbox.click();
  // Keep the real Canvas laid out so ResizeObserver sees sidebar changes while covered.
  await expect
    .poll(() => page.getByTestId('canvas').evaluate((el) => el.clientWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await corner.boundingBox())?.x).toBe(before!.x);
  expect((await toolbar.boundingBox())!.x).toBe(barBefore!.x);
  expect((await page.locator('.minimap').boundingBox())!.x).toBeGreaterThanOrEqual(
    sidebar.x + sidebar.width,
  );
  expect(
    (await page.getByRole('button', { name: 'Zoom out' }).boundingBox())!.x,
  ).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  await expect(inbox).toBeFocused();
  console.log(
    JSON.stringify({
      scenario: 'real Canvas after Inbox',
      sidebar,
      minimap: await page.locator('.minimap').boundingBox(),
      zoom: await page.getByRole('button', { name: 'Zoom out' }).boundingBox(),
      toolbar: await toolbar.boundingBox(),
      barBefore,
    }),
  );
  const shots = page.locator('.ink-sidebar .ink-nav').filter({ hasText: 'Shot list' });
  await expect(shots.locator('.ink-nav__count')).toHaveText('7');
});

for (const width of [390, 1280]) {
  test(`appearance tabs fit their content and keep validation outside the panel at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/__shot', (route) =>
      route.fulfill({ body: fixture('appearance'), contentType: 'text/html' }),
    );
    await page.goto('http://127.0.0.1:5179/__shot');
    const dialog = page.locator('.project-appearance .ink-dialog');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const symbolHeight = (await dialog.boundingBox())!.height;
    const swatches = (await dialog.locator('.project-appearance__swatches').boundingBox())!;
    const actions = (await dialog.locator('.ink-dialog__actions').boundingBox())!;
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      for (const tab of ['Symbol', 'Emoji']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.mouse.move(0, 0);
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.screenshot({
          path: testInfo.outputPath(`appearance-${width}-${tab}-${theme}.png`),
        });
        expect((await dialog.boundingBox())!.height).toBe(symbolHeight);
      }
    }
    const gap = actions.y - (swatches.y + swatches.height);
    const emojis = page.locator('#appearance-panel-emoji').getByRole('radiogroup');
    if (width < 768) {
      // Phones reserve only validation and footer spacing below the swatches.
      expect(gap).toBeLessThanOrEqual(64);
    } else {
      // Measured 67px: desktop reserves four emoji rows, the field and validation.
      expect(gap).toBeLessThanOrEqual(80);
      await expect(emojis.getByRole('radio')).toHaveCount(32);
      expect(await emojis.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
      for (const emoji of await emojis.getByRole('radio').all()) {
        await expect(emoji).toBeInViewport({ ratio: 1 });
      }
    }
    const panel = page.locator('#appearance-panel-emoji');
    expect(await panel.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await emojis.getByRole('radio').first().focus();
    await page.keyboard.press('End');
    const lastEmoji = emojis.getByRole('radio').last();
    await expect(lastEmoji).toBeFocused();
    await expect(lastEmoji).toBeInViewport({ ratio: 1 });
    if (width < 768) {
      await page.screenshot({
        path: testInfo.outputPath(`appearance-${width}-Emoji-focus-edge.png`),
      });
      const clearance = await lastEmoji.evaluate((el) => {
        const tile = el.getBoundingClientRect();
        const grid = el.parentElement!.getBoundingClientRect();
        return { right: grid.right - tile.right, bottom: grid.bottom - tile.bottom };
      });
      expect(clearance.right).toBeGreaterThanOrEqual(4);
      expect(clearance.bottom).toBeGreaterThanOrEqual(4);
    }
    const field = page.getByLabel('Paste or type an emoji');
    await field.fill('x');
    const alert = dialog.getByRole('alert');
    await expect(alert).toBeVisible();
    expect(await alert.evaluate((el) => !el.closest('[role="tabpanel"]'))).toBe(true);
    const inputBox = (await field.boundingBox())!;
    expect((await alert.boundingBox())!.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
    expect((await dialog.boundingBox())!.height).toBe(symbolHeight);
    await field.fill('🌸');
    await expect(alert).toHaveCount(0);
    await page.getByRole('tab', { name: 'Symbol', exact: true }).click();
    expect((await dialog.boundingBox())!.height).toBe(symbolHeight);
  });
}

for (const [width, height] of [
  [1280, 800],
  [915, 412],
] as const) {
  test(`focus and Space stay in the viewer ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/__shot', (route) =>
      route.fulfill({ body: fixture('image'), contentType: 'text/html' }),
    );
    await page.goto('http://127.0.0.1:5179/__shot');
    const inside = () =>
      page.locator('.viewer').evaluate((el) => el.contains(document.activeElement));
    await expect.poll(inside).toBe(true);
    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement).checkVisibility()),
    ).toBe(true);
    await page.keyboard.press('Space');
    expect(await inside()).toBe(true);
    for (const key of ['Shift+Tab', ...Array(30).fill('Tab'), ...Array(30).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      expect(await inside()).toBe(true);
    }
  });
}

test('PWA update notification remains above the viewer', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/__shot', (route) =>
    route.fulfill({ body: fixture('image'), contentType: 'text/html' }),
  );
  await page.goto('http://127.0.0.1:5179/__shot');
  await expect(page.locator('.viewer')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const toast = document.createElement('div');
      toast.className = 'pwa-update';
      toast.textContent = 'Update available';
      document.body.append(toast);
      const box = toast.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === toast;
    }),
  ).toBe(true);
});

async function openSettings(
  page: Page,
  width: number,
  height: number,
  desktopSite = false,
  locale = 'en',
) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/instance')
      ? { name: 'Inkadra', version: '0.4.2', setupComplete: true }
      : path.endsWith('/me')
        ? { id: 'u', name: 'Test', email: 't@example.com', role: 'member', locale }
        : { items: [], nextCursor: null, count: 0 };
    return route.fulfill({ json });
  });
  // A phone's "desktop site" ignores the viewport tag and lays the page out 980 px wide.
  const body = fixture('settings').replace(desktopSite ? /<meta name="viewport"[^>]*>/ : '', '');
  await page.route('**/__shot', (route) => route.fulfill({ body, contentType: 'text/html' }));
  await page.goto('http://127.0.0.1:5179/__shot');
  const dialog = page.locator('dialog.settings-window');
  await expect(dialog.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  return dialog;
}

test('settings search finds settings by their English names with the interface in Italian', async ({
  page,
}) => {
  const dialog = await openSettings(page, 1280, 800, false, 'it');
  const search = dialog.getByRole('combobox', { name: 'Cerca nelle impostazioni' });
  // Each setting is a result of its own, named in the interface language, over its page.
  for (const [word, setting, title] of [
    ['theme', 'Tema', 'Aspetto e lingua'],
    ['date format', 'Formato data', 'Aspetto e lingua'],
    ['password', 'Email e password', 'Account'],
  ] as const) {
    await search.fill(word);
    const option = dialog.getByRole('option').first();
    await expect(option).toContainText(setting);
    await expect(option).toContainText(title);
  }
  await search.fill('theme');
  await search.press('Enter');
  await expect(
    dialog.getByRole('heading', { name: 'Aspetto e lingua', exact: true }),
  ).toBeVisible();
});

test('Escape clears the settings search, then closes the window', async ({ page }) => {
  const dialog = await openSettings(page, 1280, 800);
  const closed = () =>
    page.evaluate(() => (window as unknown as { settingsClosed: number }).settingsClosed);
  const search = dialog.getByRole('combobox', { name: 'Search settings' });
  await search.fill('password');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await page.waitForTimeout(200);
  expect(await closed()).toBe(0);
  await page.keyboard.press('Escape');
  await expect.poll(closed).toBe(1);
  await page.waitForTimeout(200);
  expect(await closed()).toBe(1);
});

test('the settings heading focused on open shows no focus ring after a key press', async ({
  page,
}) => {
  const dialog = await openSettings(page, 1280, 800);
  // A key press first, as with a hardware keyboard: programmatic focus then matches
  // :focus-visible, which is where the global ring (a box-shadow) applies.
  await page.keyboard.press('Tab');
  const ring = await dialog.locator('.settings-window__head h2').evaluate((h2) => {
    h2.focus({ preventScroll: true });
    const style = getComputedStyle(h2);
    return {
      visible: h2.matches(':focus-visible'),
      boxShadow: style.boxShadow,
      outline: style.outlineStyle,
    };
  });
  expect(ring).toEqual({ visible: true, boxShadow: 'none', outline: 'none' });
});

for (const [width, height, mobile] of [
  [1280, 800, false],
  [1440, 900, false],
  [900, 2000, false],
  [1024, 1366, false],
  [412, 915, true],
] as const) {
  test.describe(`settings window ${width}x${height}${mobile ? ' desktop site' : ''}`, () => {
    test.use({ isMobile: mobile, hasTouch: mobile });
    test('is centred in the visible viewport', async ({ page }) => {
      const dialog = await openSettings(page, width, height, mobile);
      await page.waitForTimeout(300);
      const box = (await dialog.boundingBox())!;
      const view = await page.evaluate(() => {
        const v = window.visualViewport!;
        return { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height };
      });
      console.log(JSON.stringify({ scenario: 'settings centre', width, height, box, view }));
      if (mobile) expect(view.height).toBeGreaterThan(1300);
      expect(Math.abs(box.y - view.y - (view.height - box.height) / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x - view.x - (view.width - box.width) / 2)).toBeLessThanOrEqual(1);
    });
  });
}
