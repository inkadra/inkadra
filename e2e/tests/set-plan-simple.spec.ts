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
import { expect, type Locator, type Page, test } from '@playwright/test';
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

async function seed(
  page: Page,
  baseURL: string,
  theme: Theme,
  width: number,
  opts: { steps?: boolean } = {},
) {
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
          // An earlier position, for the test of the plan's menu.
          ...(opts.steps ? { steps: [{ x: gx(120), y: gy(400) }] } : {}),
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
  test(`set plan v2: desktop (${theme})`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const { planId, saved } = await seed(page, baseURL!, theme, 1280);
    const shot = async (name: string) => {
      await settle(page, editor);
      await page.screenshot({ path: join(out, `1280-${theme}-${name}.png`) });
    };
    await page.locator(`[data-el="${planId}"]`).dblclick();
    const editor = page.getByRole('dialog', { name: /Pianta del set/ });
    const stage = editor.locator('.plan-editor__stage');
    const library = editor.getByRole('complementary', { name: 'Icone da set' });
    const rail = library.getByRole('navigation', { name: 'Categorie di icone' });
    const props = editor.getByRole('tabpanel', { name: 'Proprietà' });
    const point = (at: readonly [number, number]) => pointOf(stage, at[0], at[1]);
    const clickAt = async (at: readonly [number, number], button: 'left' | 'right' = 'left') => {
      const p = await point(at);
      await page.mouse.click(p.x, p.y, { button });
    };
    const icons = async (kind: PlanIcon['kind']) =>
      (await saved()).icons?.filter((i) => i.kind === kind) ?? [];
    await expect(props).toContainText('Seleziona qualcosa sulla pianta');
    await shot('open');

    // Place from the library by click: the tile arms, a click on the plan places. The library
    // opens on the category last looked at, kept in the account (decision 0119).
    await rail.getByRole('button', { name: 'Luci', exact: true }).click();
    await library.getByRole('button', { name: 'LED COB', exact: true }).click();
    await expect(editor.locator('.plan-canvas__toast')).toContainText('LED COB');
    await clickAt([820, 520]);
    await expect.poll(async () => (await icons('cob')).length).toBe(1);
    const key = async () => (await icons('cob'))[0];

    // A light's properties, as on the mockup.
    await props.getByRole('textbox', { name: 'Nome', exact: true }).fill('Key');
    await props
      .getByRole('group', { name: 'Ruolo' })
      .getByRole('button', { name: 'Chiave' })
      .click();
    const power = props.getByRole('textbox', { name: 'Potenza' });
    await power.fill('300');
    await power.press('Enter');
    await props.getByRole('textbox', { name: 'Marca e modello, facoltativo' }).fill('Aputure 300d');
    await props
      .getByRole('group', { name: 'Temperature predefinite' })
      .getByRole('button', { name: '3200' })
      .click();
    const intensity = props.getByRole('textbox', { name: 'Intensità: valore' });
    await intensity.fill('60');
    await intensity.press('Enter');
    await expect
      .poll(async () => {
        const k = await key();
        return [k?.label, k?.role, k?.watts, k?.make, k?.kelvin, k?.intensity];
      })
      .toEqual(['Key', 'key', 300, 'Aputure 300d', 3200, 0.6]);
    await expect(props.getByRole('slider', { name: 'Temperatura colore' })).toHaveValue('3200');

    // A modifier attached from the light: it sits on its front and is listed on it.
    await props.getByRole('button', { name: 'Modificatore' }).click();
    await page.getByRole('menuitem', { name: 'Softbox' }).click();
    await expect.poll(async () => (await icons('softbox'))[0]?.on).toBe((await key())?.id);
    await expect(props.getByRole('button', { name: 'Togli Softbox' })).toBeVisible();
    await shot('light');

    // Place by drag: a chair from Set and props lands where it is let go.
    await rail.getByRole('button', { name: 'Set e oggetti', exact: true }).click();
    const chairTile = library.getByRole('button', { name: 'Sedia', exact: true });
    const t = (await chairTile.boundingBox())!;
    const drop = await point([100, 560]);
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await icons('chair')).length).toBe(1);
    expect((await icons('chair'))[0]?.x).toBeLessThan(STROKE_GRID / 5);

    // Search by another name; Enter places the first result in the middle.
    const search = library.getByRole('searchbox', { name: 'Cerca nella libreria' });
    await search.fill('octa');
    await expect(library.locator('.plan-lib__item').first()).toContainText('Octabox');
    await shot('search');
    await search.press('Enter');
    await expect.poll(async () => (await icons('octa')).length).toBe(1);
    await search.fill('');

    // A camera: lens presets and the view length typed in squares (no scale yet).
    await clickAt(POINTS.camera);
    await props.getByRole('group', { name: 'Ottica' }).getByRole('button', { name: '50' }).click();
    const length = props.getByRole('textbox', { name: 'Lunghezza della vista: valore' });
    await length.fill('8');
    await length.press('Enter');
    await expect
      .poll(async () => {
        const c = (await icons('camera'))[0];
        return [c?.lens, c?.reach];
      })
      .toEqual([50, 200]);
    await shot('camera');

    // An actor: pose and facing.
    await clickAt(POINTS.marta);
    await props
      .getByRole('group', { name: 'Posa' })
      .getByRole('button', { name: 'Seduto' })
      .click();
    await expect.poll(async () => (await icons('actor'))[0]?.pose).toBe('seated');
    await shot('actor');

    // Several items: a box over the two lamps, drawn with Shift (a plain drag on empty space
    // pans, decision 0118); align them; the mix is named.
    const a = await point([170, 110]);
    const b = await point([730, 190]);
    await page.keyboard.press('Escape');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(props).toContainText('2 elementi selezionati');
    await props.getByRole('button', { name: 'Allinea in alto' }).click();
    await shot('multi');
    await page.keyboard.press('Escape');

    // The selection's menu: Bring forward raises the table's tier.
    await clickAt(POINTS.table, 'right');
    await page.getByRole('menuitem', { name: 'Porta avanti' }).click();
    await expect.poll(async () => (await icons('table'))[0]?.tier).toBe(2);
    await page.keyboard.press('Escape');

    // Elements: by layer, filtered by layer and by tag colour.
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    const elements = editor.getByRole('tabpanel', { name: 'Elementi' });
    await expect(elements.getByRole('button', { name: /^Key/ })).toBeVisible();
    await elements
      .getByRole('group', { name: 'Filtra per livello' })
      .getByRole('button', { name: 'Camera' })
      .click();
    await expect(elements.getByRole('button', { name: /^Key/ })).toHaveCount(0);
    await expect(elements.getByRole('button', { name: /^A cam/ })).toBeVisible();
    await elements
      .getByRole('group', { name: 'Filtra per livello' })
      .getByRole('button', { name: 'Tutti' })
      .click();
    await elements.getByRole('button', { name: 'Giallo' }).click();
    await expect(elements.getByRole('button', { name: /^A cam/ })).toHaveCount(0);
    await shot('elements');
    await elements.getByRole('button', { name: 'Giallo' }).click();

    // Kit and power: a circuit, the light on it, a small breaker turns it red.
    await editor.getByRole('tab', { name: 'Materiale' }).click();
    const kit = editor.getByRole('tabpanel', { name: 'Materiale' });
    await expect(kit).toContainText('LED COB 300 W');
    await expect(kit).toContainText('300 W · 1,3 A');
    await kit.getByRole('button', { name: 'Aggiungi un circuito' }).click();
    await expect.poll(async () => (await saved()).circuits?.[0]?.name).toBe('Circuito A');
    await clickAt([820, 520]);
    await props.getByRole('combobox', { name: 'Circuito' }).click();
    await page.getByRole('option', { name: 'Circuito A · 16 A' }).click();
    await expect.poll(async () => (await key())?.circuit).toBe((await saved()).circuits?.[0]?.id);
    await editor.getByRole('tab', { name: 'Materiale' }).click();
    // A circuit reads as the mockup's card; its pencil opens the fields.
    await expect(kit).toContainText('Circuito A · 16 A');
    await kit.getByRole('button', { name: 'Modifica Circuito A' }).click();
    const breaker = kit.getByRole('textbox', { name: 'Interruttore' });
    await breaker.fill('1');
    await breaker.press('Enter');
    await expect(kit.locator('.plan-kit__circuit.is-over')).toHaveCount(1);
    await kit.getByRole('radio', { name: '120 V' }).check();
    await expect.poll(async () => (await saved()).voltage).toBe(120);
    await expect(kit.getByRole('radio', { name: '120 V' })).toBeChecked();
    await shot('kit');

    // Zoom in and back to fit: the plan opens fitted to what is drawn (decision 0118).
    const percent = editor.locator('.plan-canvas__percent');
    await editor.getByRole('button', { name: 'Adatta la pianta' }).click();
    // The percent follows the view on the next frame.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const fitted = await percent.innerText();
    await editor.getByRole('button', { name: 'Ingrandisci' }).click();
    await expect(percent).not.toHaveText(fitted);
    await editor.getByRole('button', { name: 'Adatta la pianta' }).click();
    await expect(percent).toHaveText(fitted);

    // A setup from the current one: tabs, and the note of what changed from the base.
    await editor.getByRole('button', { name: 'Aggiungi un setup' }).click();
    const setup = page.getByRole('dialog', { name: /Variante 2/ });
    await expect(
      setup.getByRole('tablist', { name: 'Setup' }).getByRole('tab', { name: '2 · Variante 2' }),
    ).toHaveAttribute('aria-selected', 'true');
    const note = setup.getByRole('region', { name: 'Cambiato da 1 · Base' });
    await expect(note).toContainText('Per ora uguale alla base.');
    const setupStage = setup.locator('.plan-editor__stage');
    const from = await pointOf(setupStage, POINTS.camera[0], POINTS.camera[1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y - 40, { steps: 5 });
    await page.mouse.up();
    await expect(note).toContainText('A cam spostato');
    await note.getByRole('button', { name: 'Mostra Base in trasparenza' }).click();
    await expect(setup.locator('.plan-canvas__ghost')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await settle(page, setup);
    await page.screenshot({ path: join(out, `1280-${theme}-setup.png`) });
    await setup.locator('.plan-top').getByRole('button', { name: 'Fatto' }).click();
    await expect(setup).toHaveCount(0);
  });

  test(`set plan v2: phone and guest (${theme})`, async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const { cookie, project, planId, saved } = await seed(page, baseURL!, theme, 390);
    const state = await page.context().storageState();
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: 'it-IT',
      colorScheme: theme,
      reducedMotion: 'reduce',
      storageState: state,
    });
    try {
      const m = await phone.newPage();
      await m.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
      await m.getByRole('button', { name: 'Adatta alla vista' }).click();
      await m.locator(`[data-el="${planId}"]`).dblclick();
      const full = m.getByRole('dialog', { name: /Pianta del set/ });
      const shot = async (name: string) => {
        await settle(m, full);
        await m.screenshot({ path: join(out, `390-${theme}-${name}.png`) });
      };
      const tools = full.getByRole('navigation', { name: 'Strumenti della pianta' });
      await expect(tools.getByRole('button', { name: 'Seleziona', exact: true })).toBeVisible();
      await shot('open');

      // The library as a sheet with the categories as chips; a tap places in the middle.
      await tools.getByRole('button', { name: 'Icone da set', exact: true }).tap();
      const sheet = full.getByRole('region', { name: 'Icone da set' });
      await sheet.getByRole('button', { name: 'Luci', exact: true }).tap();
      await shot('library');
      await sheet.getByRole('button', { name: 'LED COB', exact: true }).tap();
      await expect(sheet).toHaveCount(0);
      await expect
        .poll(async () => (await saved()).icons?.filter((i) => i.kind === 'cob').length)
        .toBe(1);

      // The selection in a sheet under the plan: its main controls, then all of them.
      const selection = full.getByRole('region', { name: 'Elemento selezionato' });
      await expect(selection.getByRole('slider', { name: 'Temperatura colore' })).toBeVisible();
      await shot('light');
      await selection.getByRole('button', { name: 'Tutte le proprietà' }).tap();
      await expect(selection.getByRole('textbox', { name: 'Nome', exact: true })).toBeVisible();
      await shot('light-full');

      // Elements and Kit as full sheets.
      await full.locator('.plan-top').getByRole('button', { name: 'Elementi' }).tap();
      const elements = full.getByRole('region', { name: 'Elementi' });
      await expect(elements.getByRole('button', { name: /^A cam/ })).toBeVisible();
      await shot('elements');
      await elements.getByRole('button', { name: 'Torna alla pianta' }).tap();
      await full.getByRole('button', { name: /^Materiale: / }).tap();
      const kit = full.getByRole('region', { name: /^Materiale · / });
      await expect(
        kit.getByRole('button', { name: 'Aggiungi all’ordine del giorno' }),
      ).toBeVisible();
      await shot('kit');
      await kit.getByRole('button', { name: 'Torna alla pianta' }).tap();

      // The setups from the header.
      await full.getByRole('button', { name: /^1 · Base/ }).tap();
      await expect(m.getByRole('menuitem', { name: 'Aggiungi un setup' })).toBeVisible();
      await m.keyboard.press('Escape');
      await full.locator('.plan-top').getByRole('button', { name: 'Fatto' }).tap();
      await expect(full).toHaveCount(0);
    } finally {
      await phone.close();
    }
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
      // Opened fitted to what is drawn (decision 0118); the button zooms in.
      const zoom = viewer.getByRole('button', { name: /^\d+% · Adatta la pianta$/ });
      const percent = async () => Number((await zoom.innerText()).replace('%', ''));
      const opened = await percent();
      await viewer.getByRole('button', { name: 'Ingrandisci' }).click();
      await expect.poll(percent).toBeGreaterThan(opened);
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

/** Opens the plan of `seed` in its editor on a desktop page. */
async function openEditor(page: Page, planId: string) {
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  await expect(stage).toBeVisible();
  return { editor, stage };
}

test('every library name fits its tile, in all six languages, at 1280 and 390 px', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(300_000);
  const { project, planId } = await seed(page, baseURL!, 'dark', 1280);
  const state = await page.context().storageState();
  const cut: string[] = [];
  /** Every category of the open library: names that overflow, or words broken without a hyphen. */
  const check = async (library: Locator, categories: Locator, label: string) => {
    const count = await categories.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i++) {
      await categories.nth(i).click();
      if (i === 1)
        await library.screenshot({ path: join(out, `library-${label.replace(' ', '-')}.png`) });
      // A name is cut when a word of it is wider than the room the name has (a word is never
      // broken, decision 0117), or when it needs more than the two lines the tile shows.
      const bad = await library.locator('.plan-lib__tile').evaluateAll((tiles) =>
        tiles.flatMap((tile) => {
          // The name, after the glyph.
          const span = tile.lastElementChild as HTMLElement;
          const value = span.textContent ?? '';
          // A div: the tile's rule for its name's span must not size the probe.
          const probe = document.createElement('div');
          probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
          tile.append(probe);
          const room = span.clientWidth;
          const wide = value.split(/[\s-]/).filter((piece) => {
            probe.textContent = piece;
            return probe.getBoundingClientRect().width > room + 0.5;
          });
          probe.remove();
          const s = span.getBoundingClientRect();
          const t = tile.getBoundingClientRect();
          const over = span.scrollHeight > span.clientHeight + 1 || s.bottom > t.bottom + 1;
          const why = [...wide.map((w) => `"${w}" too wide`), over ? 'overflows' : ''];
          const said = why.filter(Boolean).join(', ');
          return said ? [`${value} (${said})`] : [];
        }),
      );
      cut.push(...bad.map((name) => `${label}: ${name}`));
    }
  };
  // The account's language wins over the browser's: set it, and give it back at the end.
  const speak = async (locale: string) => {
    const r = await page.request.patch('/api/v1/me', {
      headers: { origin: baseURL! },
      data: { locale },
    });
    expect(r.ok()).toBe(true);
  };
  try {
    // The editor follows the width: each language at 1280 px, then the same page at 390 px.
    for (const locale of ['en', 'it', 'es', 'de', 'fr', 'pt']) {
      await speak(locale);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale,
        reducedMotion: 'reduce',
        storageState: state,
      });
      try {
        const m = await context.newPage();
        await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
        await m.locator(`[data-el="${planId}"]`).dblclick();
        const editor = m.locator('.plan-editor--v2');
        const dock = editor.locator('.plan-lib--dock');
        await expect(dock).toBeVisible();
        await check(dock, dock.locator('.plan-lib__cat'), `${locale} 1280`);
        await m.setViewportSize({ width: 390, height: 844 });
        // Library is the last of the phone's tools (Walls came before Draw with decision 0110).
        await editor.locator('.plan-canvas__phone-tools button').last().click();
        const sheet = editor.locator('.plan-lib--sheet');
        await expect(sheet).toBeVisible();
        await check(sheet, sheet.locator('.plan-lib__chips button'), `${locale} 390`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await speak('it');
  }
  expect(cut).toEqual([]);
});

test('earlier positions show by default and can be hidden from the plan menu', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId } = await seed(page, baseURL!, 'dark', 1280, { steps: true });
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const faded = editor.locator('.plan-editor__stage [style*="opacity: 0.4"]');
  // As the mockup draws them (audit M5): the earlier position veiled.
  await expect(faded).toHaveCount(1);
  // Nothing selected: the plan's menu (by the scale) has the switch, as before decision 0104.
  await editor.locator('.plan-top__end .plan-top__btn[aria-haspopup="menu"]').click();
  await page.getByRole('menuitemradio', { name: 'Mostra posizioni precedenti' }).click();
  await expect(faded).toHaveCount(0);
});

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
        .getByRole('tabpanel', { name: 'Proprietà' })
        .getByRole('button', { name: /^Colore:/ })
        .click();
      await them.getByRole('menuitemradio', { name: 'Rosso' }).click();
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
  const props = editor.getByRole('tabpanel', { name: 'Proprietà' });

  // By keyboard alone: the field next to the slider, a number, Enter.
  const reach = props.getByRole('textbox', { name: 'Lunghezza della vista: valore' });
  await reach.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  // Ten squares of 25 view units.
  await expect.poll(async () => (await camera())?.reach).toBe(250);

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
  await expect(reach).toHaveValue('2,5');
  await reach.fill('3,25');
  await reach.press('Enter');
  await expect.poll(async () => (await camera())?.reach).toBe(325);
  await expect(reach).toHaveValue('3,25');
  // Arrows on the field change it by a tenth of a metre.
  await reach.press('ArrowUp');
  await expect(reach).toHaveValue('3,35');
  await expect.poll(async () => (await camera())?.reach).toBe(335);
  await reach.press('ArrowDown');
  await expect.poll(async () => (await camera())?.reach).toBe(325);
  // The point on the cone takes the focus and answers to the same arrows, and the camera stays.
  const grip = editor.getByRole('slider', { name: 'Lunghezza cono' });
  await grip.focus();
  await expect(grip).toBeFocused();
  const before = await camera();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await camera())?.reach).toBe(335);
  expect((await camera())?.x).toBe(before?.x);
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

    // A long press and a drag pick the two lamps. The press starts clear of the kit pill at the
    // top left (the mockup's place): a touch near a button is taken by the button.
    const a = await pointOf(stage, 170, 130);
    const b = await pointOf(stage, 730, 190);
    await touch('touchStart', a);
    await expect(full.locator('.plan-canvas__toast')).toContainText('Tieni premuto', {
      timeout: 2000,
    });
    await dragTo(a, b);
    const bar = full.getByRole('region', { name: 'Elemento selezionato' });
    await expect(bar).toContainText('2 elementi selezionati');

    // A finger on one of them drags both, and they stay selected.
    const lamps = async () =>
      (await saved()).icons?.filter((i) => i.kind === 'practical').map((i) => i.y) ?? [];
    const start = await lamps();
    const lamp = await pointOf(stage, POINTS.lampRight[0], POINTS.lampRight[1]);
    await touch('touchStart', lamp);
    await dragTo(lamp, { x: lamp.x, y: lamp.y + 30 });
    await expect.poll(async () => (await lamps())[0]).toBeGreaterThan(start[0] as number);
    expect((await lamps())[1]).toBeGreaterThan(start[1] as number);
    await expect(bar).toContainText('2 elementi selezionati');

    // A tap on one, without moving, takes it out.
    const moved = await pointOf(stage, POINTS.lampRight[0], POINTS.lampRight[1] + 80);
    await m.touchscreen.tap(moved.x, moved.y);
    await expect(bar).toHaveCount(1);
    await expect(bar).not.toContainText('2 elementi selezionati');
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
