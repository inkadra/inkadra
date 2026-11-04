// SPDX-License-Identifier: AGPL-3.0-only
// The simpler set plan (decision 0071): one bar of tools, one bar on the item, nothing open until
// asked. Each state of the approved mockup is checked and photographed, light and dark, at 1280
// and 390 px. Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import {
  createBoardDoc,
  type Element,
  type PlanIcon,
  readElement,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out = process.env.SET_PLAN_SHOTS ?? join(tmpdir(), 'inkadra-set-plan');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
type Plan = Extract<Element, { type: 'plan' }>;
type Theme = 'dark' | 'light';

// The plan of the mockup, on a 1000 × 666.7 sheet.
const gx = (x: number) => Math.round((x / 1000) * STROKE_GRID);
const gy = (y: number) => Math.round((y / (1000 / 1.5)) * STROKE_GRID);
const INK = '#1C1C1E';
const wall = (n: number, x0: number, y0: number, x1: number, y1: number) => ({
  id: `wall${n}`.padEnd(13, 'A'),
  kind: 'line' as const,
  color: INK,
  width: 6,
  x0: gx(x0),
  y0: gy(y0),
  x1: gx(x1),
  y1: gy(y1),
});
const icon = (id: string, kind: PlanIcon['kind'], color: string, x: number, y: number) => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color,
  x: gx(x),
  y: gy(y),
});
const POINTS = {
  camera: [250, 400],
  marta: [660, 225],
  lampLeft: [220, 150],
  lampRight: [680, 150],
  table: [465, 285],
  finestra: [900, 110],
  empty: [960, 620],
} as const;

async function seed(page: Page, baseURL: string, theme: Theme, width: number) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => ({
      name: pair.slice(0, pair.indexOf('=')),
      value: pair.slice(pair.indexOf('=') + 1),
      url: baseURL,
    })),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: `Pianta semplice ${theme} ${width}` },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const plan = createElement(
    doc,
    'plan',
    { x: 200, y: 80 },
    {
      w: 480,
      title: 'Cucina, giorno 2',
      // No scale: a measure written here offers to become the scale.
      shapes: [
        wall(0, 140, 90, 760, 90),
        wall(1, 760, 90, 760, 500),
        wall(2, 760, 500, 140, 500),
        wall(3, 140, 500, 140, 90),
        {
          id: 'textFinestraA',
          kind: 'text',
          color: '#F79B54',
          width: 18,
          x0: gx(POINTS.finestra[0] - 30),
          y0: gy(POINTS.finestra[1] + 6),
          x1: gx(POINTS.finestra[0] - 30),
          y1: gy(POINTS.finestra[1] + 6),
          text: 'Finestra',
        },
      ],
      icons: [
        { ...icon('Table', 'table', INK, POINTS.table[0], POINTS.table[1]), w: 170, h: 90 },
        // Icons as older plans have them: S, M and L stay as they are until they are resized.
        {
          ...icon('Lamp1', 'practical', '#EDD963', POINTS.lampLeft[0], POINTS.lampLeft[1]),
          size: 'L' as const,
        },
        icon('Lamp2', 'practical', '#EDD963', POINTS.lampRight[0], POINTS.lampRight[1]),
        { ...icon('Marta', 'actor', '#B897F0', POINTS.marta[0], POINTS.marta[1]), label: 'Marta' },
        {
          ...icon('Cam', 'camera', '#9DB8F2', POINTS.camera[0], POINTS.camera[1]),
          label: 'A cam',
          showLens: true,
        },
      ],
    },
    { userId: null },
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  await page.goto(`/p/${project.id}?view=canvas`);
  const saved = async () => {
    const stored = await readBoard(baseURL, cookie, root);
    return [...roots(stored).elements.values()]
      .map((m) => readElement(m))
      .find((e): e is Plan => e?.id === plan.id) as Plan;
  };
  return { cookie, project, planId: plan.id, saved };
}

/** Client position of a point of the sheet. */
const pointOf = async (stage: Locator, x: number, y: number) => {
  const box = (await stage.boundingBox())!;
  return { x: box.x + (x / 1000) * box.width, y: box.y + (y / (1000 / 1.5)) * box.height };
};
/** No leftover hover, nor the opening animation. */
async function settle(page: Page, editor: Locator) {
  await page.mouse.move(2, 2);
  await editor.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
}

for (const theme of ['dark', 'light'] as const) {
  test(`simple plan: desktop (${theme})`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const { project, planId, saved } = await seed(page, baseURL!, theme, 1280);
    const shot = async (name: string, dragging = false) => {
      if (!dragging) await settle(page, editor);
      await page.screenshot({ path: join(out, `1280-${theme}-${name}.png`) });
    };
    const card = page.locator(`[data-el="${planId}"]`);
    await card.dblclick();
    const editor = page.getByRole('dialog', { name: /Pianta del set/ });
    const stage = editor.locator('.plan-editor__stage');
    const tools = editor.getByRole('toolbar', { name: 'Strumenti della pianta' });
    const point = (at: readonly [number, number]) => pointOf(stage, at[0], at[1]);
    const clickAt = async (at: readonly [number, number]) => {
      const p = await point(at);
      await page.mouse.click(p.x, p.y);
    };
    const drag = async (from: readonly [number, number], to: readonly [number, number]) => {
      const a = await point(from);
      const b = await point(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 5 });
      return page.mouse;
    };

    // Two bars: no column, no panel with tabs, nothing open until asked.
    await expect(editor.getByRole('tablist')).toHaveCount(0);
    await expect(editor.locator('.plan-lib')).toHaveCount(0);
    for (const name of [
      'Seleziona (V)',
      'Matita (P)',
      'Linea (L)',
      'Freccia (A)',
      'Rettangolo o ellisse (Q)',
      'Testo (T)',
      'Misura (U)',
    ])
      await expect(tools.getByRole('button', { name })).toBeVisible();
    await expect(tools.getByRole('button', { name: 'Ripeti' })).toBeDisabled();
    // Existing plans open unchanged: nothing written by opening it, S, M and L read as percent.
    const before = await saved();
    expect(before.icons?.find((i) => i.kind === 'practical')?.size).toBe('L');
    await shot('open');

    // The camera on its bar: any size, in proportion, from a corner or written.
    await clickAt(POINTS.camera);
    const camBar = editor.getByRole('toolbar', { name: 'Camera selezionata' });
    const dim = camBar.getByLabel('Dimensione');
    await expect(dim).toHaveValue('100');
    await expect(camBar.getByRole('button', { name: 'Percorso' })).toBeVisible();
    await expect(editor.locator('[data-handle]')).toHaveCount(4);
    // The bar stays clear of the floating bars and of the window.
    const placed = (await camBar.boundingBox())!;
    const edges = (await editor.boundingBox())!;
    expect(placed.x).toBeGreaterThanOrEqual(edges.x);
    expect(placed.x + placed.width).toBeLessThanOrEqual(edges.x + edges.width);
    const camera = async () => (await saved()).icons?.find((i) => i.label === 'A cam');
    const corner = editor.locator('[data-handle="se"]');
    const c = (await corner.boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + 24, c.y + 24, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await camera())?.percent ?? 0).toBeGreaterThan(110);
    await dim.fill('120');
    await dim.press('Enter');
    await expect.poll(async () => (await camera())?.percent).toBe(120);
    await expect.poll(async () => (await camera())?.size).toBeUndefined();
    // The blue point at the end of the cone: only its length changes.
    const reach = editor.locator('[data-reach]');
    const r = (await reach.boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + 40, r.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await camera())?.reach ?? 0).toBeGreaterThan(312);
    await clickAt(POINTS.empty);
    await clickAt(POINTS.camera);
    await shot('camera');
    await camBar.getByRole('button', { name: 'Ottica' }).click();
    await expect(editor.getByRole('combobox', { name: 'Sensore' })).toBeVisible();
    await expect(editor.getByText(/Angolo di campo: \d+° orizz\./)).toBeVisible();
    await shot('lens');
    await page.keyboard.press('Escape');
    await camBar.getByRole('button', { name: 'Altre azioni' }).click();
    await expect(page.getByRole('menuitem', { name: /Ruota di 45°/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Sposta nel livello/ })).toContainText(
      'Camera',
    );
    await shot('camera-more');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /Ruota di 45°/ })).toHaveCount(0);

    // Clicking the empty plan deselects; dragging on it picks, with the count on the way.
    await clickAt(POINTS.empty);
    await expect(camBar).toHaveCount(0);
    const mouse = await drag([180, 110], [730, 320]);
    const label = editor.locator('.plan-editor__tool-label');
    await expect(label).toHaveText(/^Trascina per selezionare · \d+ elementi$/);
    await shot('marquee', true);
    const counted = Number((await label.textContent())?.match(/\d+/)?.[0]);
    await mouse.up();
    const manyBar = editor.getByRole('toolbar', { name: 'Elemento selezionato' });
    await expect(manyBar).toContainText(`${counted} elementi`);
    await expect(editor.locator('.plan-editor__marquee')).toHaveCount(0);
    await shot('many');
    // The colour of the bar paints all of them.
    await manyBar.getByRole('button', { name: /^Colore:/ }).click();
    const palette = editor.getByRole('dialog', { name: 'Colore' });
    await expect(palette.getByRole('button')).toHaveCount(9);
    await shot('palette');
    await palette.getByRole('button', { name: 'Rosa' }).click();
    await expect
      .poll(async () => (await saved()).icons?.find((i) => i.label === 'Marta')?.color)
      .toBe('#FF91CC');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape');

    // The colour of the bottom bar with nothing selected: the next strokes take it.
    await tools.getByRole('button', { name: /^Colore:/ }).click();
    await palette.getByRole('button', { name: 'Rosso' }).click();
    await tools.getByRole('button', { name: 'Linea (L)' }).click();
    (await drag([200, 560], [420, 560])).up();
    await expect
      .poll(async () => (await saved()).shapes?.filter((s) => s.color === '#F68186').length)
      .toBe(1);
    await tools.getByRole('button', { name: 'Seleziona (V)' }).click();
    await page.keyboard.press('Control+z');
    await tools.getByRole('button', { name: /^Colore:/ }).click();
    await palette.getByRole('button', { name: 'Inchiostro' }).click();

    // Rectangle or ellipse is one button: pressed again it turns into the other.
    const shapeTool = tools.getByRole('button', { name: 'Rettangolo o ellisse (Q)' });
    await shapeTool.click();
    await expect(stage).toHaveClass(/--rect/);
    await shapeTool.click();
    await expect(stage).toHaveClass(/--ellipse/);
    await tools.getByRole('button', { name: 'Seleziona (V)' }).click();

    // Icons open when asked: a tile arms, the way out is in sight, Esc too.
    await tools.getByRole('button', { name: 'Icone', exact: true }).click();
    const library = editor.getByRole('region', { name: 'Icone da set' });
    await library.getByRole('button', { name: 'Fresnel', exact: true }).click();
    const toast = editor.locator('.plan-editor__toast');
    await expect(toast).toContainText('Clicca sulla pianta per posare');
    await shot('icons');
    await toast.getByRole('button', { name: 'Fine' }).click();
    await expect(toast).toHaveCount(0);
    await expect(stage).toHaveClass(/--select/);
    await library.getByRole('button', { name: 'Fresnel', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(toast).toHaveCount(0);
    // One placed: back to Select with it picked, and dragging the empty plan selects at once.
    await library.getByRole('button', { name: 'Fresnel', exact: true }).click();
    await clickAt([400, 560]);
    await expect(stage).toHaveClass(/--select/);
    await expect(toast).toHaveCount(0);
    await expect
      .poll(async () => (await saved()).icons?.filter((i) => i.kind === 'fresnel').length)
      .toBe(1);
    await expect(editor.locator('[data-handle]')).toHaveCount(4);
    await page.keyboard.press('Delete');
    (await drag([700, 540], [760, 600])).up();
    await expect(editor.locator('.plan-editor__marquee')).toHaveCount(0);
    await library.getByRole('button', { name: 'Chiudi le icone' }).click();
    await expect(library).toHaveCount(0);

    // Marta's route: from her bar, numbered points, no veiled copies; the old look is in "…".
    await clickAt(POINTS.marta);
    await editor
      .getByRole('toolbar', { name: 'Elemento selezionato' })
      .getByRole('button', { name: 'Percorso' })
      .click();
    const routeBar = editor.getByRole('toolbar', { name: 'Percorso' });
    await expect(routeBar).toContainText('Percorso di Marta');
    await clickAt([560, 180]);
    await clickAt([440, 200]);
    await expect(toast).toHaveText('Clicca la posizione 4 · Fatto per chiudere');
    await expect(editor.locator('.plan__step')).toHaveCount(2);
    await expect(editor.locator('[data-blocking] [data-icon]')).toHaveCount(0);
    await expect
      .poll(async () => (await saved()).icons?.find((i) => i.label === 'Marta')?.steps?.length)
      .toBe(2);
    await shot('route');
    await routeBar.getByRole('button', { name: 'Tratteggio' }).click();
    await expect
      .poll(async () => (await saved()).icons?.find((i) => i.label === 'Marta')?.dashed)
      .toBe(true);
    await routeBar.getByRole('button', { name: 'Continua' }).click();
    await routeBar.getByRole('button', { name: 'Fatto' }).click();
    await expect(routeBar).toHaveCount(0);
    await expect(stage).toHaveClass(/--select/);
    await editor.getByRole('button', { name: 'Altre azioni della pianta' }).click();
    await page.getByRole('menuitemradio', { name: 'Mostra posizioni precedenti' }).click();
    await expect(editor.locator('[data-blocking] [data-icon]')).toHaveCount(2);
    await editor.getByRole('button', { name: 'Altre azioni della pianta' }).click();
    await shot('plan-more');
    await page.getByRole('menuitemradio', { name: 'Mostra posizioni precedenti' }).click();
    await page.keyboard.press('Escape');

    // Text: a click selects, a double click writes in the bar, with its sizes.
    const finestra = await point([POINTS.finestra[0] - 10, POINTS.finestra[1]]);
    await page.mouse.click(finestra.x, finestra.y);
    await expect(editor.getByLabel('Testo sul disegno')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(finestra.x, finestra.y);
    const field = editor.getByLabel('Testo sul disegno');
    await expect(field).toBeFocused();
    await field.fill('Finestra nord');
    const textBar = editor.getByRole('toolbar', { name: 'Elemento selezionato' });
    await textBar.getByRole('button', { name: 'Più grande' }).click();
    await shot('text');
    await textBar.getByRole('button', { name: 'Fatto' }).click();
    await expect(field).toHaveCount(0);
    await expect
      .poll(async () => (await saved()).shapes?.find((s) => s.text === 'Finestra nord')?.width)
      .toBe(26);

    // The measure: written at once. No scale yet: wrong number, then the offer.
    await page.keyboard.press('Escape');
    await tools.getByRole('button', { name: 'Misura (U)' }).click();
    (await drag([140, 560], [760, 560])).up();
    const measure = editor.getByRole('dialog', { name: 'Misura' });
    const metres = measure.getByLabel('Misura in metri');
    await expect(metres).toBeFocused();
    await metres.fill('0');
    await measure.getByRole('button', { name: 'Fatto' }).click();
    await expect(measure.getByRole('alert')).toHaveText('Scrivi un numero maggiore di 0.');
    await shot('measure-error');
    await metres.fill('6,20');
    await shot('measure');
    await measure.getByRole('button', { name: 'Fatto' }).click();
    await expect(measure).toContainText('La pianta non ha ancora una scala');
    await expect(measure).toContainText('6,20 m su questa linea');
    await shot('measure-scale');
    await measure.getByRole('button', { name: 'Solo questa misura' }).click();
    await expect
      .poll(async () => (await saved()).shapes?.find((s) => s.kind === 'measure')?.text)
      .toBe('6.2');
    await expect(editor.locator('.plan__chip text')).toHaveText('6,20 m');
    expect((await saved()).scale).toBeUndefined();
    // A second one: this time as the scale of the plan, 100 view units for a metre.
    (await drag([140, 610], [640, 610])).up();
    await metres.fill('5');
    await measure.getByRole('button', { name: 'Fatto' }).click();
    await measure.getByRole('button', { name: 'Usa come scala' }).click();
    await expect.poll(async () => Math.round((await saved()).scale ?? 0)).toBe(100);
    await expect(editor.locator('.plan__chip text').nth(1)).toHaveText('5,00 m');
    await expect(editor.getByRole('button', { name: /^Scala: 0,5 m per quadretto/ })).toBeVisible();
    // With a scale, the number written is only a label: the scale stays.
    (await drag([200, 640], [400, 640])).up();
    await expect(metres).toHaveValue('2,00');
    await metres.fill('3');
    await metres.press('Enter');
    await expect
      .poll(async () => (await saved()).shapes?.filter((s) => s.kind === 'measure').at(-1)?.text)
      .toBe('3');
    await expect.poll(async () => Math.round((await saved()).scale ?? 0)).toBe(100);
    await tools.getByRole('button', { name: 'Seleziona (V)' }).click();

    // Layers, in a menu; an item of a locked layer says so, with its actions off.
    await editor.getByRole('button', { name: 'Livelli', exact: true }).click();
    await editor.getByRole('button', { name: 'Blocca Set' }).click();
    await shot('layers');
    await page.keyboard.press('Escape');
    await clickAt(POINTS.table);
    const lockedBar = editor.getByRole('toolbar', { name: 'Elemento selezionato' });
    await expect(lockedBar).toContainText('Set bloccato');
    await expect(lockedBar.getByRole('button', { name: 'Elimina' })).toBeDisabled();
    await shot('locked');
    await editor.getByRole('button', { name: 'Livelli', exact: true }).click();
    await editor.getByRole('button', { name: 'Sblocca Set' }).click();
    await page.keyboard.press('Escape');
    await clickAt(POINTS.empty);

    // The buttons Matteo has not named yet: unchanged, one photo each, for him to point at.
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await editor.getByRole('button', { name: 'Altre azioni della pianta' }).click();
    await settle(page, editor);
    await page
      .getByRole('menuitemradio', { name: 'Aggancia alla griglia' })
      .screenshot({ path: join(out, `to-name-${theme}-snap.png`) });
    await page.keyboard.press('Escape');
    await settle(page, editor);
    await tools
      .getByRole('button', { name: 'Icone', exact: true })
      .screenshot({ path: join(out, `to-name-${theme}-icons.png`) });

    // The card on the board draws the new size, and a reload keeps it all.
    await editor.getByRole('button', { name: 'Fatto' }).last().click();
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(project.id));
    expect((await camera())?.percent).toBe(120);
    expect((await saved()).icons?.find((i) => i.kind === 'practical')?.size).toBe('L');
  });

  test(`simple plan: phone and guest (${theme})`, async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const { cookie, project, planId, saved } = await seed(page, baseURL!, theme, 390);
    const state = await page.context().storageState();
    await phoneChecks(browser, baseURL!, theme, project.id, planId, state, saved);
    await page.close();

    // A guest looks: no tools, no selection, the zoom and Chiudi.
    const link = await fetch(`${baseURL}/api/v1/boards/${project.rootBoardId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseURL!, cookie },
      body: JSON.stringify({ role: 'guest_approve', label: 'Regia' }),
    });
    expect(link.ok).toBe(true);
    const { url } = (await link.json()) as { url: string };
    const guest = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'it-IT',
    });
    try {
      const view = await guest.newPage();
      await view.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await view.goto(url);
      await view.locator(`[data-el="${planId}"]`).dblclick();
      const viewer = view.getByRole('dialog', { name: /Pianta del set/ });
      await expect(viewer.locator('.plan__svg')).toBeVisible();
      await expect(viewer.getByRole('toolbar', { name: 'Strumenti della pianta' })).toHaveCount(0);
      await expect(viewer.locator('.plan-editor__stage')).toHaveCount(0);
      await viewer.getByRole('button', { name: 'Ingrandisci' }).click();
      await expect(viewer.getByRole('button', { name: '150%' })).toBeVisible();
      await viewer.getByRole('button', { name: 'Riduci' }).click();
      await settle(view, viewer);
      await view.screenshot({ path: join(out, `1280-${theme}-guest.png`) });
      await viewer.getByRole('button', { name: 'Chiudi' }).click();
      await expect(viewer).toHaveCount(0);
    } finally {
      await guest.close();
    }
  });
}

async function phoneChecks(
  browser: Browser,
  baseURL: string,
  theme: Theme,
  projectId: string,
  planId: string,
  storageState: Awaited<ReturnType<ReturnType<Page['context']>['storageState']>>,
  saved: () => Promise<Plan>,
) {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'it-IT',
    colorScheme: theme,
    reducedMotion: 'reduce',
    storageState,
  });
  try {
    const page = await phone.newPage();
    await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
    await page.goto(`${baseURL}/p/${projectId}?view=canvas`);
    await page.getByRole('button', { name: 'Adatta alla vista' }).click();
    const card = page.locator(`[data-el="${planId}"]`);
    await expect(card).toBeInViewport({ ratio: 0.95 });
    await card.dblclick();
    const full = page.getByRole('dialog', { name: /Pianta del set/ });
    const shot = async (name: string) => {
      await settle(page, full);
      await page.screenshot({ path: join(out, `390-${theme}-${name}.png`) });
    };
    const tools = full.getByRole('toolbar', { name: 'Strumenti della pianta' });
    // The eight buttons of the mockup, nothing covering another, all inside the screen.
    for (const name of [
      'Seleziona',
      'Matita',
      'Forme e linee',
      'Testo',
      'Misura',
      'Icone',
      'Annulla',
    ])
      await expect(tools.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(tools.getByRole('button', { name: /^Colore:/ })).toBeInViewport({ ratio: 1 });
    await shot('open');
    const stage = full.locator('.plan-editor__stage');
    const tap = async (at: readonly [number, number]) => {
      const p = await pointOf(stage, at[0], at[1]);
      await page.touchscreen.tap(p.x, p.y);
    };

    // The camera: the bar under the plan, not over it.
    await tap(POINTS.camera);
    const bar = full.getByRole('toolbar', { name: 'Camera selezionata' });
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    const stageBox = (await stage.boundingBox())!;
    expect(barBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
    for (const name of ['Etichetta', 'Ottica', 'Percorso', 'Altre azioni'])
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    const dim = bar.getByLabel('Dimensione');
    await dim.fill('150');
    await dim.press('Enter');
    await expect
      .poll(async () => (await saved()).icons?.find((i) => i.label === 'A cam')?.percent)
      .toBe(150);
    await shot('camera');
    await bar.getByRole('button', { name: 'Ottica', exact: true }).tap();
    await shot('lens');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // A finger held on the empty plan starts the box, and says so.
    const a = await pointOf(stage, 180, 110);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: a.x, y: a.y }],
    });
    const toast = full.locator('.plan-editor__toast');
    await expect(toast).toContainText('Tieni premuto e trascina');
    const b = await pointOf(stage, 730, 320);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: b.x, y: b.y }],
    });
    await expect(toast).toHaveText(/Tieni premuto e trascina · [1-9]\d* element/);
    await page.screenshot({ path: join(out, `390-${theme}-marquee.png`) });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(toast).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Lines and shapes share a button.
    await tools.getByRole('button', { name: 'Forme e linee' }).tap();
    await expect(page.getByRole('menuitemradio', { name: 'Ellisse' })).toBeVisible();
    await shot('shapes');
    await page.keyboard.press('Escape');

    // The icons as a sheet; a tap arms, a tap on the plan places and goes back to Select.
    await tools.getByRole('button', { name: 'Icone', exact: true }).tap();
    const sheet = full.getByRole('region', { name: 'Icone da set' });
    await expect(sheet.getByRole('button', { name: 'Fresnel', exact: true })).toBeVisible();
    await shot('icons');
    await sheet.getByRole('button', { name: 'Fresnel', exact: true }).tap();
    await expect(toast).toContainText('Tocca la pianta per posare');
    await tap([400, 560]);
    await expect(sheet).toHaveCount(0);
    await expect(stage).toHaveClass(/--select/);
    await expect
      .poll(async () => (await saved()).icons?.filter((i) => i.kind === 'fresnel').length)
      .toBe(1);
    await page.keyboard.press('Escape');

    // A route.
    await tap(POINTS.marta);
    await full.getByRole('button', { name: 'Percorso', exact: true }).tap();
    await tap([560, 180]);
    await expect(toast).toContainText('Tocca la posizione 3');
    await shot('route');
    await full
      .getByRole('toolbar', { name: 'Percorso' })
      .getByRole('button', { name: 'Fatto' })
      .tap();

    // A measure.
    await page.keyboard.press('Escape');
    await tools.getByRole('button', { name: 'Misura', exact: true }).tap();
    const m = await pointOf(stage, 150, 560);
    const n = await pointOf(stage, 750, 560);
    // At a finger's pace, and held at the end: a flick would count as a fling, and Chrome drops
    // the next tap to stop it.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [m] });
    for (const k of [0.25, 0.5, 0.75, 1]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: m.x + (n.x - m.x) * k, y: m.y + (n.y - m.y) * k }],
      });
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const measure = full.getByRole('dialog', { name: 'Misura' });
    await measure.getByLabel('Misura in metri').fill('6,20');
    await shot('measure');
    await measure.getByRole('button', { name: 'Fatto' }).tap();
    await shot('measure-scale');
    await measure.getByRole('button', { name: 'Solo questa misura' }).tap();

    // Layers from the header.
    await full.getByRole('button', { name: 'Livelli' }).tap();
    await shot('layers');
    await page.keyboard.press('Escape');
    await full.locator('.plan-editor__head').getByRole('button', { name: 'Fatto' }).tap();
    await expect(full).toHaveCount(0);
  } finally {
    await phone.close();
  }
}

/** Opens the plan of `seed` in its editor on a desktop page. */
async function openEditor(page: Page, planId: string) {
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  await expect(stage).toBeVisible();
  return { editor, stage };
}

test('a drag writes only what it changed: a colour set meanwhile by someone else stays', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project, planId, saved } = await seed(page, baseURL!, 'dark', 1281);
  const { stage } = await openEditor(page, planId);
  const other = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'it-IT',
    storageState: await page.context().storageState(),
  });
  try {
    const them = await other.newPage();
    await them.goto(`${baseURL}/p/${project.id}?view=canvas`);
    const theirs = await openEditor(them, planId);
    const recolor = async (at: readonly [number, number]) => {
      const p = await pointOf(theirs.stage, at[0], at[1]);
      await them.mouse.click(p.x, p.y);
      await theirs.editor
        .getByRole('toolbar', { name: /selezionat/ })
        .getByRole('button', { name: /^Colore:/ })
        .click();
      await theirs.editor
        .getByRole('dialog', { name: 'Colore' })
        .getByRole('button', { name: 'Rosso' })
        .click();
    };
    const before = (await saved()).icons?.find((i) => i.label === 'A cam');

    // A holds the camera mid-drag.
    const from = await pointOf(stage, POINTS.camera[0], POINTS.camera[1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 4 });
    // B paints the camera, then a lamp: when the lamp turns red on A's side, A has both.
    await recolor(POINTS.camera);
    await recolor(POINTS.lampRight);
    await expect(stage.locator('[data-icon="iconLamp2AAAA"]')).toHaveAttribute('style', /tag-red/);
    await page.mouse.up();

    await expect
      .poll(async () => (await saved()).icons?.find((i) => i.label === 'A cam')?.x)
      .not.toBe(before?.x);
    const after = (await saved()).icons?.find((i) => i.label === 'A cam');
    expect(after?.color).toBe('#F68186');
  } finally {
    await other.close();
  }
});

test('the length of the cone can be typed: in metres with a scale, in squares without', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId, saved } = await seed(page, baseURL!, 'dark', 1282);
  const { editor, stage } = await openEditor(page, planId);
  const p = await pointOf(stage, POINTS.camera[0], POINTS.camera[1]);
  await page.mouse.click(p.x, p.y);
  const camera = async () => (await saved()).icons?.find((i) => i.label === 'A cam');
  const camBar = editor.getByRole('toolbar', { name: 'Camera selezionata' });

  // By keyboard alone: to the button, Enter, the field, a number, Enter.
  await camBar.getByRole('button', { name: 'Ottica' }).focus();
  await page.keyboard.press('Enter');
  const reach = editor.getByRole('textbox', { name: 'Lunghezza cono' });
  await reach.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  // Ten squares of 25 view units.
  await expect.poll(async () => (await camera())?.reach).toBe(250);
  await page.keyboard.press('Escape');

  // With a scale: 100 view units for a metre, an exact 3,25 m.
  await editor.getByRole('button', { name: 'Misura (U)' }).click();
  const a = await pointOf(stage, 140, 560);
  const b = await pointOf(stage, 640, 560);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const measure = editor.getByRole('dialog', { name: 'Misura' });
  await measure.getByLabel('Misura in metri').fill('5');
  await measure.getByRole('button', { name: 'Fatto' }).click();
  await measure.getByRole('button', { name: 'Usa come scala' }).click();
  await editor.getByRole('button', { name: 'Seleziona (V)' }).click();
  await page.mouse.click(p.x, p.y);
  await camBar.getByRole('button', { name: 'Ottica' }).click();
  await expect(reach).toHaveValue('2,5');
  await reach.fill('3,25');
  await reach.press('Enter');
  await expect.poll(async () => (await camera())?.reach).toBe(325);
  await expect(reach).toHaveValue('3,25');
});

test('on a phone a selection can be dragged, and a tap still takes an item out of it', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project, planId, saved } = await seed(page, baseURL!, 'dark', 391);
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'it-IT',
    reducedMotion: 'reduce',
    storageState: await page.context().storageState(),
  });
  try {
    const m = await phone.newPage();
    await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
    await m.getByRole('button', { name: 'Adatta alla vista' }).click();
    await m.locator(`[data-el="${planId}"]`).dblclick();
    const full = m.getByRole('dialog', { name: /Pianta del set/ });
    const stage = full.locator('.plan-editor__stage');
    const cdp = await phone.newCDPSession(m);
    const touch = (type: 'touchStart' | 'touchMove', p: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [p] });
    const end = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    /** At a finger's pace: a flick would count as a fling. */
    const dragTo = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (const k of [0.25, 0.5, 0.75, 1]) {
        await touch('touchMove', {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
        });
        await m.waitForTimeout(50);
      }
      await m.waitForTimeout(150);
      await end();
    };

    // A long press and a drag pick the two lamps.
    const a = await pointOf(stage, 170, 110);
    const b = await pointOf(stage, 730, 190);
    await touch('touchStart', a);
    await expect(full.locator('.plan-editor__toast')).toContainText('Tieni premuto', {
      timeout: 2000,
    });
    await dragTo(a, b);
    const bar = full.getByRole('toolbar', { name: 'Elemento selezionato' });
    await expect(bar).toContainText('2 elementi');

    // A finger on one of them drags both, and they stay selected.
    const lamps = async () =>
      (await saved()).icons?.filter((i) => i.kind === 'practical').map((i) => i.y) ?? [];
    const start = await lamps();
    const lamp = await pointOf(stage, POINTS.lampRight[0], POINTS.lampRight[1]);
    await touch('touchStart', lamp);
    await dragTo(lamp, { x: lamp.x, y: lamp.y + 30 });
    await expect.poll(async () => (await lamps())[0]).toBeGreaterThan(start[0] as number);
    expect((await lamps())[1]).toBeGreaterThan(start[1] as number);
    await expect(bar).toContainText('2 elementi');

    // A tap on one, without moving, takes it out.
    const moved = await pointOf(stage, POINTS.lampRight[0], POINTS.lampRight[1] + 80);
    await m.touchscreen.tap(moved.x, moved.y);
    await expect(bar).toHaveCount(1);
    await expect(bar).not.toContainText('2 elementi');
  } finally {
    await phone.close();
  }
});

test('dragging an item reads the layout once per move, not again after every render', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId } = await seed(page, baseURL!, 'dark', 1283);
  const { stage } = await openEditor(page, planId);
  const p = await pointOf(stage, POINTS.camera[0], POINTS.camera[1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 4, p.y, { steps: 2 });
  await page.evaluate(() => {
    const counts = { reads: 0, moves: 0 };
    (window as unknown as { counts: typeof counts }).counts = counts;
    const read = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains('plan-editor__stage')) counts.reads += 1;
      return read.call(this);
    };
    document.addEventListener('pointermove', () => (counts.moves += 1), true);
  });
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(p.x + 4 + i * 5, p.y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const counts = await page.evaluate(
    () => (window as unknown as { counts: { reads: number; moves: number } }).counts,
  );
  await page.mouse.up();
  expect(counts.moves).toBeGreaterThan(5);
  // One for the pointer's position in the move handler; none from the bar's placement.
  expect(counts.reads).toBeLessThanOrEqual(counts.moves);
});
