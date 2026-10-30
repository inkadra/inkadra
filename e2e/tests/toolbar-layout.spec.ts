// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

/**
 * The canvas toolbar on tablets and narrow windows: one row at every width, and the Canvas
 * button as wide as its content (an iPad mini wrapped it in two rows, label outside the fill).
 * On phones the tools scroll and the Canvas button stays pinned in view (it was scrolled off).
 */
const vite = process.env.E2E_VITE_URL ?? 'http://127.0.0.1:5179';
const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
const fixture = (
  viewportTag: boolean,
) => `<html><head>${viewportTag ? '<meta name="viewport" content="width=device-width,initial-scale=1">' : ''}</head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
import React from '/@id/react';
import ReactDOM from '/@id/react-dom/client';
import '/src/i18n/index.ts';
import '/@fs/${root}/packages/ui/src/styles.css';
import '/src/board/board.css';
import '/src/board/film/film.css';
import '/src/routes/mobile-shell.css';
import '/src/pwa/pwa.css';
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
  const conn = { store: new BoardStore(doc), provider: null, status: 'synced', readOnly: false, accessChangedAt: null };
  const canvas = React.createElement(Canvas, { conn, breadcrumb: [], projectId: 'p', boardId: 'b', userId: 'u', boards: [], canEdit: true, peers: [], onOpenBoard: () => {} });
  const { SessionProvider, useSession } = await import('/src/lib/session.tsx');
  function Loaded() { const { loading } = useSession(); return loading ? null : React.createElement(Routes, null, React.createElement(Route, { element: React.createElement(AppLayout) }, React.createElement(Route, { path: '*', element: React.createElement('div', { style: { display: 'contents' } }, canvas) }))); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, { initialEntries: ['/p/p/b/b'] }, React.createElement(SessionProvider, null, React.createElement(Loaded))));
</script></body></html>`;

async function openCanvas(page: Page, width: number, height: number, viewportTag: boolean) {
  await page.setViewportSize({ width, height });
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
    route.fulfill({ body: fixture(viewportTag), contentType: 'text/html' }),
  );
  await page.goto(`${vite}/__shot`);
  const toolbar = page.locator('.canvas .toolbar');
  await expect(toolbar).toBeVisible();
  return toolbar;
}

/** Every button on one row, the label (when shown) inside the blue fill, the bar on screen. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.canvas .toolbar')!;
    const buttons = Array.from(bar.querySelectorAll<HTMLElement>('button')).map((b) =>
      b.getBoundingClientRect(),
    );
    const canvas = bar.querySelector<HTMLElement>('.toolbar__btn--canvas')!;
    const label = canvas.querySelector<HTMLElement>('.toolbar__label')!;
    const parts = Array.from(canvas.children)
      .filter((c) => c.getAttribute('role') !== 'tooltip' && getComputedStyle(c).display !== 'none')
      .map((c) => c.getBoundingClientRect());
    const box = canvas.getBoundingClientRect();
    // The scrolling part of the bar: its tools, or the whole bar before they were split.
    const tools = bar.querySelector<HTMLElement>('.toolbar__tools') ?? bar;
    return {
      tops: [...new Set(buttons.map((b) => Math.round(b.top)))],
      button: { left: box.left, right: box.right, width: box.width, height: box.height },
      partsInside: parts.every((p) => p.left >= box.left - 0.5 && p.right <= box.right + 0.5),
      labelShown: getComputedStyle(label).display !== 'none',
      bar: bar.getBoundingClientRect().toJSON(),
      scroll: Math.max(bar.scrollWidth - bar.clientWidth, tools.scrollWidth - tools.clientWidth),
      barScroll: bar.scrollWidth - bar.clientWidth,
      viewport: document.documentElement.clientWidth,
    };
  });
}

for (const [width, height, touch, viewportTag] of [
  // Phones, where the tools scroll.
  [360, 800, true, true],
  [390, 844, true, true],
  [430, 932, true, true],
  // iPad mini portrait, as a tablet and as Safari's default desktop site (no viewport tag).
  [744, 1133, true, true],
  [744, 1133, true, false],
  // iPad landscape and the widths between a phone and a laptop, touch and mouse.
  [1024, 768, true, true],
  [480, 900, true, true],
  [560, 900, true, true],
  [640, 900, true, true],
  [700, 900, false, true],
  [768, 1024, true, true],
  [820, 1180, true, true],
  [900, 700, false, true],
  [1024, 768, false, true],
] as const) {
  const name = `${width}x${height}${touch ? ' touch' : ''}${viewportTag ? '' : ' desktop site'}`;
  test.describe(`canvas toolbar ${name}`, () => {
    test.use({ isMobile: touch, hasTouch: touch });
    test('stays on one row with the Canvas label inside its button', async ({ page }, info) => {
      await openCanvas(page, width, height, viewportTag);
      const m = await measure(page);
      console.log(JSON.stringify({ scenario: 'toolbar', name, ...m }));
      expect(m.tops, 'one row of tools').toHaveLength(1);
      expect(m.partsInside, 'plus, label and caret inside the blue fill').toBe(true);
      expect(m.button.width).toBeGreaterThanOrEqual(m.button.height);
      if (m.labelShown) expect(m.button.width).toBeGreaterThan(m.button.height + 30);
      // Touch targets keep 44 px.
      if (touch) expect(m.button.height).toBeGreaterThanOrEqual(44);
      expect(m.bar.left).toBeGreaterThanOrEqual(0);
      expect(m.bar.right).toBeLessThanOrEqual(m.viewport);
      // The label shows whenever the whole bar fits with it; otherwise the bar may scroll.
      if (m.labelShown) expect(m.scroll).toBeLessThanOrEqual(1);
      // Only the tools scroll: the Canvas button is always on screen, at the end of the bar.
      expect(m.barScroll, 'the bar itself does not scroll').toBeLessThanOrEqual(1);
      expect(m.button.left).toBeGreaterThanOrEqual(m.bar.left);
      expect(m.button.right).toBeLessThanOrEqual(m.bar.right);
      expect(m.bar.right - m.button.right, 'pinned at the right end').toBeLessThanOrEqual(8);
      await page.locator('.canvas .toolbar').screenshot({ path: info.outputPath('toolbar.png') });
    });
  });
}

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
  [560, 900],
] as const) {
  test.describe(`canvas toolbar ${width}x${height} phone`, () => {
    test.use({ isMobile: true, hasTouch: true });
    test('scrolls the tools under a pinned Canvas button whose menu opens above it', async ({
      page,
    }) => {
      const toolbar = await openCanvas(page, width, height, true);
      const canvasButton = toolbar.locator('.toolbar__btn--canvas');
      const before = await canvasButton.boundingBox();
      await toolbar.evaluate((bar) => {
        const tools = bar.querySelector('.toolbar__tools') ?? bar;
        tools.scrollLeft = tools.scrollWidth;
      });
      const after = await canvasButton.boundingBox();
      expect(after).toEqual(before);
      if (!after) throw new Error('no Canvas button');
      expect(after.x + after.width).toBeLessThanOrEqual(width);
      await expect(canvasButton).toBeInViewport({ ratio: 1 });
      await canvasButton.tap();
      const menu = page.locator('.menu--canvas');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      if (!box) throw new Error('no Canvas menu');
      expect(box.y + box.height).toBeLessThanOrEqual(after.y);
      expect(Math.abs(box.x + box.width - (after.x + after.width))).toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(0);
    });
  });
}
