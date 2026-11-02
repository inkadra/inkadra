// SPDX-License-Identifier: AGPL-3.0-only
// Generated visual fixtures isolate viewer layout from Linux-only document conversion.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const root = process
  .cwd()
  .replaceAll('\\', '/')
  .replace(/\/e2e$/, '');
const port = process.env.E2E_VITE_PORT ?? '5179';
function fixture(scenario: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
import React from '/@id/react'; import ReactDOM from '/@id/react-dom/client';
import '/src/i18n/index.ts'; import '/@fs/${root}/packages/ui/src/styles.css'; import '/src/board/board.css';
const { setAssetLoader } = await import('/src/board/assets.ts');
const { MediaViewer } = await import('/src/board/viewer.tsx');
const { BoardStore } = await import('/src/board/store.ts');
const { createBoardDoc } = await import('/@fs/${root}/packages/doc-schema/src/index.ts');
const { createElement } = await import('/@fs/${root}/packages/canvas-core/src/index.ts');
const { BoardContext } = await import('/src/board/context.ts');
const { SessionProvider } = await import('/src/lib/session.tsx');
const { FileCard } = await import('/src/board/FileCard.tsx');
const scenario = ${JSON.stringify(scenario)};
const doc = createBoardDoc('visual'); const store = new BoardStore(doc);
const unavailable = scenario.startsWith('unavailable');
const extensions = scenario === 'cards' ? ['docx','xlsx','pptx','odt','ods','odp','csv'] : [unavailable ? 'pptx' : scenario.startsWith('xlsx') ? 'xlsx' : scenario];
const assets = {};
const elements = extensions.map((ext, i) => {
const id = 'visual-'+ext;
assets[id] = { id, projectId:'p', kind:'file', mime:'application/octet-stream', filename: ext === 'docx' ? 'trattamento-v3.docx' : ext === 'xlsx' ? 'budget-riprese.xlsx' : 'piano-luci.'+ext, size:220000, sha256:null, width:794, height:1123, durationMs:null, status:'ready', url:'/original/'+id, pageCount: unavailable ? null : 6, variants: unavailable || ext === 'csv' ? [] : [{size:'2048',width:794,height:1123,url:'/generated-page.svg'}], exif: ext === 'xlsx' ? {OfficeSheetCount:3} : ext === 'csv' ? {OfficeSheetCount:1} : null, palette:null, animated:false, sourceUrl:null, createdAt:'2026-11-01T00:00:00Z' };
return createElement(doc,'file',{x:20+i*260,y:20},{assetId:id,w:240},{userId:'u'});
});
setAssetLoader(async id => assets[id] ?? null);
const ctx = { store, readOnly:true, projectId:'p', boardId:'visual', userId:'u', boards:[], scale:1, largeBoard:false, editing:null, setEditing:()=>{}, openBoard:()=>{}, setNoteEditor:()=>{}, frameLabels:new Map() };
const view = React.createElement(SessionProvider, null, scenario === 'cards' ? React.createElement(BoardContext.Provider,{value:ctx}, React.createElement('div',{style:{display:'flex',flexWrap:'wrap',gap:20,padding:20,background:'var(--ink-bg-canvas)',minHeight:'100vh'}},...elements.map(el=>React.createElement('div',{key:el.id,style:{width:240}},React.createElement(FileCard,{element:el,width:240}))))) : React.createElement(MediaViewer,{store,element:elements[0],projectId:'p',userId:'u',readOnly:false,onClose:()=>{},onOfficeTable:()=>{}}));
ReactDOM.createRoot(document.getElementById('root')).render(view);
</script></body></html>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="white"/><text x="90" y="140" font-family="serif" font-size="32" fill="#222">2. Il tono</text>${Array.from({ length: 12 }, (_, i) => `<rect x="90" y="${190 + i * 26}" width="${i % 3 === 0 ? 470 : 610}" height="7" fill="#b8b8b8"/>`).join('')}<rect x="90" y="550" width="610" height="210" fill="#7a876a"/>${Array.from({ length: 7 }, (_, i) => `<rect x="90" y="${800 + i * 26}" width="${i % 2 ? 470 : 610}" height="7" fill="#b8b8b8"/>`).join('')}</svg>`;
for (const scenario of [
  'docx',
  'xlsx',
  'xlsx-truncated',
  'unavailable',
  'unavailable-admin',
  'cards',
]) {
  test(`Office layout ${scenario}`, async ({ page }) => {
    const unavailable = scenario.startsWith('unavailable');
    await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/v1/instance', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        json: { id: 'u', role: scenario === 'unavailable-admin' ? 'admin' : 'member' },
      }),
    );
    await page.route('**/office/manifest.json', (route) =>
      route.fulfill({
        json: {
          uploadedBy: 'Giulia R.',
          uploadedAt: '2026-11-03T12:00:00Z',
          pageCount: scenario === 'docx' ? 6 : 0,
          sheets: scenario.startsWith('xlsx')
            ? ['Budget', 'Troupe', 'Noleggi'].map((name, i) => ({
                name,
                ...(scenario === 'xlsx-truncated' && i === 0 ? { truncated: true } : {}),
                rows: [
                  ['Voce', 'Reparto', 'Giorni', 'Costo/g', 'Totale'],
                  ['Camera e ottiche', 'Fotografia', '6', '420', '2.520'],
                  ['Kit luci LED', 'Elettricisti', '6', '180', '1.080'],
                  ['Furgone', 'Produzione', '7', '95', '665'],
                  ['Rifugio, affitto', 'Location', '2', '300', '600'],
                ],
              }))
            : [],
        },
      }),
    );
    await page.route('**/office/page-*.webp', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: svg }),
    );
    await page.route('**/generated-page.svg', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: svg }),
    );
    await page.route('**/__office', (route) =>
      route.fulfill({ contentType: 'text/html', body: fixture(scenario) }),
    );
    await page.goto(`http://127.0.0.1:${port}/__office`);
    await page.addStyleTag({
      content: '* { transition: none !important; animation: none !important; }',
    });
    if (scenario === 'docx') {
      await expect(page.getByRole('button', { name: 'Pagina successiva' })).toBeEnabled();
      await page.getByRole('button', { name: 'Pagina successiva' }).click();
      await expect(page.getByRole('img', { name: 'Pagina 2 di 6' })).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('img', { name: 'Pagina 3 di 6' })).toBeVisible();
      await page.keyboard.press('ArrowLeft');
    }
    if (scenario === 'xlsx-truncated') {
      await expect(page.locator('.office-sheet__more')).toHaveText('…');
      await expect(page.locator('.office-sheet__note')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Trasforma in tabella' }).first(),
      ).toBeDisabled();
    }
    if (scenario === 'xlsx') {
      // The header counts the sheets, the numbers sit on the right, the tabs are below the sheet.
      await expect(page.getByText('Foglio 1 di 3', { exact: true })).toBeVisible();
      await expect(page.locator('td.n').first()).toHaveCSS('text-align', 'right');
      // The sheet is paper in both themes: dark text on light cells.
      await expect(page.locator('.office-sheet td').first()).toHaveCSS('color', 'rgb(22, 22, 22)');
      const sheet = await page.locator('.office-sheet__scroll').boundingBox();
      const tabs = await page.locator('.office-sheet__tabs').boundingBox();
      expect(tabs!.y).toBeGreaterThanOrEqual(sheet!.y + sheet!.height);
      await page.getByRole('tab', { name: 'Troupe' }).click();
      await expect(page.getByText('Foglio 2 di 3', { exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Troupe' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Troupe' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Noleggi' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Budget' }).click();
    }
    if (unavailable) {
      await expect(page.getByText('Anteprima non disponibile', { exact: true })).toBeVisible();
      await expect(page.getByText('Gli admin la attivano da Istanza.')).toHaveCount(
        scenario === 'unavailable-admin' ? 1 : 0,
      );
    }
    if (scenario === 'cards') await expect(page.locator('.fcard')).toHaveCount(7);
    if (!process.env.OFFICE_SHOTS) return;
    mkdirSync(process.env.OFFICE_SHOTS, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({
        width,
        height: scenario === 'cards' && width === 390 ? 2200 : 820,
      });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        await page.mouse.move(0, 0);
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        if (scenario === 'docx') {
          const bar = await page.locator('.office-pages__bar').boundingBox();
          expect(bar!.y).toBeGreaterThan(52);
          expect(bar!.y + bar!.height).toBeLessThanOrEqual(820);
          const header = await page.locator('.viewer__stage-header').boundingBox();
          expect(header!.y).toBe(0);
        }
        await page.screenshot({
          path: join(process.env.OFFICE_SHOTS, `${scenario}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  });
}
