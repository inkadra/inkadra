// SPDX-License-Identifier: AGPL-3.0-only
// Set plans (#335): the card on the board, its editor on a desktop and on a phone. Runs after
// first-run.spec.ts in CI; alone, it signs up.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFrame, createElement, encodeStroke } from '@inkadra/canvas-core';
import {
  createBoardDoc,
  type Element,
  type PlanIcon,
  readElement,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { addProduction, addStoryboard } from '../helpers/views.ts';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out = process.env.SET_PLAN_SHOTS ?? join(tmpdir(), 'inkadra-set-plan');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
type Plan = Extract<Element, { type: 'plan' }>;

// The plan of the approved mockup, drawn on a 400 × 266.7 sheet.
const gx = (x: number) => Math.round((x / 400) * STROKE_GRID);
const gy = (y: number) => Math.round((y / (400 / 1.5)) * STROKE_GRID);
const INK = '#1C1C1E';
const icon = (
  id: string,
  kind: PlanIcon['kind'],
  color: string,
  x: number,
  y: number,
  rotation?: number,
  label?: string,
): PlanIcon => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color,
  x: gx(x),
  y: gy(y),
  ...(rotation ? { rotation } : {}),
  ...(label ? { label } : {}),
});
const text = (id: string, x: number, y: number, value: string, color = INK) => ({
  id: `text${id}`.padEnd(13, 'A'),
  kind: 'text' as const,
  color,
  width: 24,
  x0: gx(x),
  y0: gy(y),
  x1: gx(x),
  y1: gy(y),
  text: value,
});
// The walls of the kitchen, a gap for the door at the bottom.
const walls = [
  [190, 230, 20, 230],
  [20, 230, 20, 20],
  [20, 20, 380, 20],
  [380, 20, 380, 230],
  [380, 230, 232, 230],
] as const;
const line = (n: number, [x0, y0, x1, y1]: readonly number[]) => ({
  id: `wall${n}`.padEnd(13, 'A'),
  kind: 'line' as const,
  color: INK,
  width: 10,
  x0: gx(x0 as number),
  y0: gy(y0 as number),
  x1: gx(x1 as number),
  y1: gy(y1 as number),
});

async function seed(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: `Cortometraggio · pianta ${theme}` },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  // Scenes, frames and their plan on a storyboard; the note makes its canvas, the cards outside
  // the storyboard, reachable (decision 0121).
  const root = (await addStoryboard(page.request, baseURL, project, ['shotlist'])).id;

  const doc = createBoardDoc(root);
  const note = createElement(doc, 'note', { x: 60, y: 120 }, { w: 220 }, opts);
  const body = roots(doc).elements.get(note.id)?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('Riferimento luce: finestra a nord, molto morbida')]);
  body.insert(0, [p]);
  // Anna's way from the window to the table, drawn with the pencil.
  const path = [
    [216, 72],
    [246, 62],
    [266, 72],
    [272, 92],
  ].map(([x, y]) => ({ x: (x as number) / 400, y: (y as number) / (400 / 1.5) }));
  const scene5 = createElement(
    doc,
    'scene',
    { x: 60, y: 560 },
    { number: '5', title: '', location: 'Cucina', setting: 'int', time: 'day' },
    opts,
  );
  createElement(
    doc,
    'scene',
    { x: 360, y: 560 },
    { number: '7', title: '', location: 'Cucina', setting: 'int', time: 'dusk' },
    opts,
  );
  const plan = createElement(
    doc,
    'plan',
    { x: 320, y: 120 },
    {
      w: 480,
      title: 'Cucina, giorno 2',
      sceneIds: [scene5.id],
      strokes: [
        {
          id: 'strokeAnnaAAA',
          tool: 'pencil',
          color: '#B897F0',
          width: 4,
          points: encodeStroke(path),
        },
      ],
      shapes: [
        text('Table', 190, 126, 'tavolo'),
        text('Window', 140, 40, 'finestra'),
        text('Move', 282, 100, '1 → 2', '#B897F0'),
        {
          id: 'arrowAnnaAAAA',
          kind: 'arrow',
          color: '#B897F0',
          width: 4,
          x0: gx(272),
          y0: gy(90),
          x1: gx(272),
          y1: gy(98),
        },
        ...walls.map((w, n) => line(n, w)),
      ],
      icons: [
        { ...icon('Window', 'window', INK, 160, 20), w: 210, h: 20 },
        { ...icon('Door', 'door', INK, 210, 212), w: 95, h: 95 },
        { ...icon('Table', 'table', INK, 204, 121), w: 180, h: 105 },
        { ...icon('Track', 'track', INK, 112, 211), w: 320, h: 25 },
        icon('ACam', 'camera', '#9DB8F2', 100, 200, 310, 'A cam'),
        icon('BCam', 'camera', '#9DB8F2', 326, 70, 160, 'B cam'),
        { ...icon('Key', 'fresnel', '#EDD963', 340, 198, 225, 'Key'), power: '1,2K' },
        icon('Anna', 'actor', '#B897F0', 204, 78, 90, 'Anna'),
        icon('Marco', 'actor', '#7AD689', 214, 168, 270, 'Marco'),
        { ...icon('Sofa', 'sofa', INK, 318, 140), w: 100, h: 42 },
      ],
    },
    opts,
  );
  const shots = ['Anna entra dalla porta', 'Anna alla finestra', 'Marco si siede'].map(
    (action) => addFrame(doc, scene5.id, null, { action }, opts).id,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  // A shooting day with the three frames of scene 5, for the call sheet.
  const day = await page.request.post(`/api/v1/boards/${root}/schedule`, {
    headers: { origin: baseURL },
    data: {
      date: '2026-11-10',
      callTime: '07:00',
      wrap: null,
      location: 'Cucina',
      notes: '',
      blocks: shots.map((shotId) => ({
        id: randomUUID(),
        type: 'shot',
        title: '',
        start: null,
        duration: 45,
        shotId,
        cast: [],
        departments: [],
      })),
    },
  });
  expect(day.status()).toBe(201);
  // The day moves to the Production board, whose calendar opens the call sheet (decision 0123).
  const production = await addProduction(page.request, baseURL, project);
  return { cookie, project, planId: plan.id, storyboardId: root, productionId: production.id };
}

for (const theme of ['dark', 'light'] as const) {
  test(`set plan: card, editor and phone (${theme})`, async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const { cookie, project, planId, storyboardId, productionId } = await seed(
      page,
      baseURL!,
      theme,
    );
    const root = storyboardId;
    const saved = async () => {
      const doc = await readBoard(baseURL!, cookie, root);
      const plans = [...roots(doc).elements.values()]
        .map((m) => readElement(m))
        .filter((e): e is Plan => e?.type === 'plan');
      const notes = [...roots(doc).elements.values()].filter((m) => m.get('type') === 'note');
      return { plan: plans.find((e) => e.id === planId), count: plans.length, notes: notes.length };
    };
    await page.goto(`/p/${project.id}/b/${root}?view=canvas`);

    // On the board: the title and the drawing, without the grid.
    const card = page.locator(`[data-el="${planId}"]`);
    await expect(card).toContainText('Cucina, giorno 2');
    await expect(card.locator('.plan__svg text', { hasText: 'A cam' })).toBeVisible();
    await expect(card.locator('pattern')).toHaveCount(0);
    await page.mouse.click(1300, 820);
    await page.screenshot({ path: join(out, `desktop-${theme}-board.png`) });

    // Editing (decision 0104): the whole screen, the library docked on the left, the tools at
    // the bottom of the drawing, the right panel with Properties, Elements and Kit.
    await card.dblclick();
    const editor = page.getByRole('dialog', { name: 'Pianta del set · Cucina, giorno 2' });
    await expect(editor.getByRole('toolbar', { name: 'Strumenti della pianta' })).toBeVisible();
    // The dots of the grid cover the whole surface (decision 0118).
    await expect
      .poll(() =>
        editor
          .locator('.plan-canvas__surface')
          .evaluate((el) => (el as HTMLElement).style.backgroundSize),
      )
      .not.toBe('0px 0px');
    // The board behind never gets the editor's keys: Delete, N or Ctrl+D act on nothing there.
    await expect(editor).toBeFocused();
    for (const key of ['Delete', 'n', 'Control+d', 'ArrowLeft']) await page.keyboard.press(key);
    await expect.poll(async () => (await saved()).count).toBe(1);
    expect((await saved()).notes).toBe(1);
    // 163 icons in the 6 categories of the rail; annotations are the toolbar's.
    const library = editor.getByRole('complementary', { name: 'Icone da set' });
    const rail = library.getByRole('navigation', { name: 'Categorie di icone' });
    let tiles = 0;
    for (const name of [
      'Modificatori e grip',
      'Camera e movimento',
      'Persone',
      'Set e oggetti',
      'Audio e video',
      'Luci',
    ]) {
      await rail.getByRole('button', { name, exact: true }).click();
      tiles += await library.locator('.plan-lib__tile').count();
    }
    expect(tiles).toBe(163);
    const tile = (name: string) => library.getByRole('button', { name, exact: true }).first();
    // Nothing floats over the drawing: the tools sit inside its area.
    const area = (await editor.locator('.plan-main__canvas').boundingBox())!;
    const tools = (await editor
      .getByRole('toolbar', { name: 'Strumenti della pianta' })
      .boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(area.x);
    expect(tools.x + tools.width).toBeLessThanOrEqual(area.x + area.width);

    // Keyboard: Tab to a tile, Enter arms it.
    await tile('Tubo').focus();
    await page.keyboard.press('Enter');
    await expect(tile('Tubo')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    // Search knows synonyms: "kino" finds the tube bank and says why.
    const search = library.getByRole('searchbox', { name: 'Cerca nella libreria' });
    await search.fill('kino');
    await expect(library.locator('.plan-lib__item')).toHaveCount(1);
    await expect(library.locator('.plan-lib__item')).toContainText('Banco di tubi');
    await expect(library.locator('.plan-lib__item')).toContainText('Detto anche');
    if (theme === 'dark') await page.screenshot({ path: join(out, 'desktop-dark-search.png') });
    await search.fill('');
    // A star keeps an icon among the Favourites.
    await rail.getByRole('button', { name: 'Luci', exact: true }).click();
    // (The account is the same for both themes: the star stays from the dark run.)
    if (theme === 'dark')
      await library.getByRole('button', { name: 'Preferito: Pannello LED' }).click();
    await rail.getByRole('button', { name: 'Preferiti e recenti' }).click();
    await expect(tile('Pannello LED')).toBeVisible();

    // Selecting A cam: its properties in the right panel, the rotate handle on it.
    const stage = editor.locator('.plan-editor__stage');
    let box = (await stage.boundingBox())!;
    const at = (x: number, y: number) => ({
      x: box.x + (x / 400) * box.width,
      y: box.y + (y / (400 / 1.5)) * box.height,
    });
    const aCam = at(100, 200);
    await page.mouse.click(aCam.x, aCam.y);
    const props = editor.getByRole('tabpanel', { name: 'Proprietà' });
    const menuItem = (name: string | RegExp) => page.getByRole('menuitem', { name });
    await expect(props.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('A cam');
    await expect(props.getByRole('button', { name: 'Colore: Blu' })).toBeVisible();
    await expect(editor.locator('[data-rotate]')).toBeVisible();
    await page.screenshot({ path: join(out, `desktop-${theme}-editing.png`) });

    const camera = async () => (await saved()).plan?.icons?.find((i) => i.label === 'A cam');
    await page.keyboard.press('r');
    await expect.poll(async () => (await camera())?.rotation).toBe(355);
    await props.getByRole('button', { name: 'Azioni della selezione' }).click();
    await menuItem('Ruota di 45°').click();
    await expect.poll(async () => (await camera())?.rotation).toBe(40);
    await props.getByRole('button', { name: 'Colore: Blu' }).click();
    await page.getByRole('menuitemradio', { name: 'Giallo' }).click();
    await expect.poll(async () => (await camera())?.color).toBe('#EDD963');
    await props.getByRole('textbox', { name: 'Nome', exact: true }).fill('A cam 35mm');
    await expect
      .poll(async () => (await saved()).plan?.icons?.some((i) => i.label === 'A cam 35mm'))
      .toBe(true);

    // The lens: pills of primes; the cone narrows, the label says it.
    await props.getByRole('group', { name: 'Ottica' }).getByRole('button', { name: '85' }).click();
    await expect
      .poll(
        async () =>
          (await saved()).plan?.icons?.find((i) => i.kind === 'camera' && i.label === 'A cam 35mm')
            ?.lens,
      )
      .toBe(85);
    await props.getByLabel('Mostra l’ottica nell’etichetta').check();
    await expect(editor.locator('.plan__svg text', { hasText: '85 mm' })).toBeVisible();
    await page.screenshot({ path: join(out, `desktop-${theme}-lens.png`) });
    await page.keyboard.press('Escape');

    // The route: from the properties of Anna, through two more positions.
    const anna = at(204, 78);
    await page.mouse.click(anna.x, anna.y);
    await props.getByRole('button', { name: 'Aggiungi una posizione' }).click();
    for (const [x, y] of [
      [300, 120],
      [262, 178],
    ] as const) {
      const q = at(x, y);
      await page.mouse.click(q.x, q.y);
    }
    const annaNow = async () => (await saved()).plan?.icons?.find((i) => i.label === 'Anna');
    await expect.poll(async () => (await annaNow())?.steps?.length).toBe(2);
    // Every position numbered, the icon being the last one (audit M5).
    await expect(editor.locator('.plan__step')).toHaveCount(3);
    await page.screenshot({ path: join(out, `desktop-${theme}-blocking.png`) });
    await editor
      .getByRole('toolbar', { name: 'Percorso' })
      .getByRole('button', { name: 'Fatto' })
      .click();
    await props.getByLabel('Nota della posizione 1').fill('Porta, entra');
    await expect.poll(async () => (await annaNow())?.steps?.[0]?.note).toBe('Porta, entra');
    // The last position has a note of its own, apart from Anna's note (decision 0119).
    await props.getByLabel('Nota della posizione 3').fill('Si siede');
    await props.getByRole('textbox', { name: 'Nota', exact: true }).fill('Cappotto addosso');
    await expect
      .poll(async () => {
        const a = await annaNow();
        return [a?.stepNote, a?.note];
      })
      .toEqual(['Si siede', 'Cappotto addosso']);
    await page.keyboard.press('Escape');

    // Resize and rotate: furniture takes any size from a corner, and an angle.
    const sofaAt = at(318, 140);
    await page.mouse.click(sofaAt.x, sofaAt.y);
    const sofa = async () => (await saved()).plan?.icons?.find((i) => i.kind === 'sofa');
    const grip = editor.locator('[data-handle="se"]');
    await expect(grip).toBeVisible();
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 60, g.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await sofa())?.w ?? 0).toBeGreaterThan(130);
    const angle = props.getByLabel('Angolo', { exact: true });
    await angle.fill('-20');
    await angle.press('Enter');
    await expect.poll(async () => (await sofa())?.rotation).toBe(340);
    await page.screenshot({ path: join(out, `desktop-${theme}-resize.png`) });

    // Several items: a box dragged over the table and Marco picks both; Group keeps them
    // together.
    // A plain drag on empty space pans (decision 0118): Shift draws the box.
    const from2 = at(160, 95);
    const to2 = at(250, 185);
    await page.keyboard.down('Shift');
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(to2.x, to2.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(props).toContainText(/\d+ elementi selezionati/);
    await props.getByRole('button', { name: 'Raggruppa', exact: true }).click();
    await expect
      .poll(async () => {
        const icons = (await saved()).plan?.icons ?? [];
        const table = icons.find((i) => i.kind === 'table');
        const marco = icons.find((i) => i.label === 'Marco');
        return !!table?.group && table.group === marco?.group;
      })
      .toBe(true);
    await page.screenshot({ path: join(out, `desktop-${theme}-multi.png`) });
    await page.keyboard.press('Escape');

    // Scale and measures: a line along the top wall is 5,20 m; the grid turns to metres,
    // rulers show; a measure from A cam to Anna stays on both.
    const empty = at(390, 255);
    await page.mouse.click(empty.x, empty.y);
    await expect(props).toContainText('Seleziona qualcosa sulla pianta');
    await editor.getByRole('button', { name: 'Scala', exact: true }).click();
    // No scale yet: the menu says so with its label, not a translation key (QA 2026-11-02).
    await expect(page.getByText('Nessuna, senza metri')).toBeVisible();
    await expect(editor).not.toContainText(/\bboard\.[a-z]+\.[a-zA-Z]+/);
    await page.screenshot({ path: join(out, `desktop-${theme}-properties.png`) });
    await menuItem('Imposta la scala').click();
    const wallA = at(20, 20);
    const wallB = at(380, 20);
    await page.mouse.move(wallA.x, wallA.y);
    await page.mouse.down();
    await page.mouse.move(wallB.x, wallB.y, { steps: 6 });
    await page.mouse.up();
    const scaleDialog = editor.getByRole('dialog', { name: 'Imposta la scala' });
    await scaleDialog.getByLabel('La linea che hai tracciato è lunga').fill('5,20');
    await scaleDialog.getByRole('button', { name: 'Imposta', exact: true }).click();
    await expect.poll(async () => Math.round((await saved()).plan?.scale ?? 0)).toBe(173);
    await expect(editor.locator('.plan-ruler--top')).toContainText('1 m');
    await expect(editor.locator('.plan-canvas__scalebar')).toContainText('1 m');
    await editor.getByRole('button', { name: 'Misura (U)' }).click();
    const camAt = at(100, 200);
    const annaEnd = at(262, 178);
    await page.mouse.move(camAt.x, camAt.y);
    await page.mouse.down();
    await page.mouse.move(annaEnd.x, annaEnd.y, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const m = (await saved()).plan?.shapes?.find((x) => x.kind === 'measure');
        return !!m?.from && !!m?.to;
      })
      .toBe(true);
    await expect(editor.locator('.plan__chip text')).toContainText(' m');
    await editor.getByLabel('Misura in metri').press('Escape');
    await page.screenshot({ path: join(out, `desktop-${theme}-scale.png`) });
    await editor.getByRole('button', { name: 'Seleziona (V)' }).click();

    // Layers, in Elements: Set locked for everyone, Camera hidden just here.
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    const elements = editor.getByRole('tabpanel', { name: 'Elementi' });
    await elements.getByRole('button', { name: 'Blocca Set' }).click();
    await expect.poll(async () => (await saved()).plan?.lockedLayers).toEqual(['set']);
    await elements.getByRole('button', { name: 'Nascondi Camera' }).click();
    await expect(editor.locator('.plan-canvas__status')).toHaveText(
      'Camera nascosta · Set bloccato',
    );
    // Hidden here, it is not drawn either: no camera on the plan.
    await expect(editor.locator('[data-icon]').filter({ hasText: 'B cam' })).toHaveCount(0);
    await page.screenshot({ path: join(out, `desktop-${theme}-layers.png`) });
    await elements.getByRole('button', { name: 'Mostra Camera' }).click();
    await elements.getByRole('button', { name: 'Sblocca Set' }).click();
    await expect.poll(async () => (await saved()).plan?.lockedLayers).toBeUndefined();
    // A click in the list selects, and the properties follow.
    await elements.getByRole('button', { name: /^A cam 35mm/ }).click();
    await editor.getByRole('tab', { name: 'Proprietà' }).click();
    await expect(props.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue(
      'A cam 35mm',
    );

    // Duplicate, then delete the copy; the plan keeps the ten icons it had.
    await props.getByRole('button', { name: 'Duplica', exact: true }).click();
    await expect.poll(async () => (await saved()).plan?.icons?.length).toBe(11);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await saved()).plan?.icons?.length).toBe(10);

    // Tap Fresnel, then the plan with Shift twice: it keeps placing; without, the first click
    // places it and goes back to Select. Recent shows it.
    await rail.getByRole('button', { name: 'Luci', exact: true }).click();
    box = (await stage.boundingBox())!;
    await tile('Fresnel').click();
    const spot = at(60, 60);
    await page.keyboard.down('Shift');
    await page.mouse.click(spot.x, spot.y);
    const spot2 = at(60, 120);
    await page.mouse.click(spot2.x, spot2.y);
    await page.keyboard.up('Shift');
    await expect(editor.locator('.plan-canvas__surface')).toHaveClass(/--icons/);
    const spot3 = at(60, 170);
    await page.mouse.click(spot3.x, spot3.y);
    await expect(editor.locator('.plan-canvas__surface')).toHaveClass(/--select/);
    await expect
      .poll(async () => (await saved()).plan?.icons?.filter((i) => i.kind === 'fresnel').length)
      .toBe(4);
    await rail.getByRole('button', { name: 'Preferiti e recenti' }).click();
    await expect(
      library
        .locator('.plan-lib__grid')
        .nth(1)
        .getByRole('button', { name: 'Fresnel', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(out, `desktop-${theme}-library.png`) });

    // A line with the Line tool, next to the walls.
    await editor.getByRole('button', { name: 'Linea o freccia (L / A)' }).click();
    const from = at(40, 240);
    const to = at(150, 240);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await saved()).plan?.shapes?.filter((s) => s.kind === 'line').length)
      .toBe(walls.length + 1);

    // Escape steps back: tool, then the editor. The card duplicates like any other.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await card.click({ position: { x: 60, y: 10 } });
    await page.keyboard.press('Control+d');
    await expect.poll(async () => (await saved()).count).toBe(2);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await saved()).count).toBe(1);
    // Setups: a second card sharing the Set layer, shown as tabs in the editor, with the note
    // of what changed from the base.
    await card.click({ button: 'right', position: { x: 60, y: 10 } });
    await page.getByRole('menuitem', { name: 'Duplica come variante' }).click();
    await expect.poll(async () => (await saved()).count).toBe(2);
    const variantCard = page.locator('[data-type="plan"]').nth(1);
    await expect(variantCard).toContainText('Variante 2');
    await page.mouse.click(1300, 860);
    await page.screenshot({ path: join(out, `desktop-${theme}-variants.png`) });
    await variantCard.dblclick();
    const variantEditor = page.getByRole('dialog', { name: /Variante 2/ });
    const tabs = variantEditor.getByRole('tablist', { name: 'Setup' });
    await expect(tabs.getByRole('tab', { name: '1 · Base' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: '2 · Variante 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const note = variantEditor.getByRole('region', { name: 'Cambiato da 1 · Base' });
    await expect(note).toContainText('Per ora uguale alla base.');
    // The walls and the sofa of the base are drawn in the variant too.
    await expect(variantEditor.locator('[data-icon]')).not.toHaveCount(0);
    await note.getByRole('button', { name: 'Mostra Base in trasparenza' }).click();
    await expect(variantEditor.locator('.plan-canvas__ghost')).toHaveCount(1);
    await variantEditor.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    await page.screenshot({ path: join(out, `desktop-${theme}-variant-editor.png`) });
    await page.keyboard.press('Escape');

    {
      // Scenes (round 6, b): the badge on the card links to the scene in the storyboard, the
      // scene opens its plan, and the editor links the plan to more scenes.
      await expect(card.getByRole('button', { name: 'Scena 5' })).toBeVisible();
      await card.dblclick();
      await editor.getByRole('button', { name: 'Collega a una scena' }).click();
      const picker = page.getByRole('dialog', { name: 'Collega a una scena' });
      await picker.getByText(/^Sc\. 7/).click();
      await expect.poll(async () => (await saved()).plan?.sceneIds?.length).toBe(2);
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
      await expect(editor.getByRole('button', { name: 'Scena 7 · INT · Tramonto' })).toBeVisible();
      await page.screenshot({ path: join(out, `desktop-${theme}-scenes.png`) });
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      await card.getByRole('button', { name: 'Scena 5' }).click();
      // The scene opens in the Storyboard view, the storyboard's first.
      await expect(page).not.toHaveURL(/view=/);
      const sceneHead = page.locator('[data-story-scene]').first();
      await sceneHead.getByRole('button', { name: 'Pianta del set' }).click();
      await expect(editor).toBeVisible();
      await page.keyboard.press('Escape');

      // The presentation (round 6, i): a slide for scene 5 with its frames and its plan.
      await page.goto(`/p/${project.id}/b/${root}`);
      await page.getByRole('button', { name: 'Presenta', exact: true }).click();
      const present = page.getByRole('dialog', { name: 'Presenta' });
      await expect(present.locator('.present-scene__plan .plan__svg')).toBeVisible();
      await expect(present.locator('.present-scene__frames .frame-pic')).toHaveCount(3);
      await page.screenshot({ path: join(out, `desktop-${theme}-presentation.png`) });
      await page.keyboard.press('Escape');

      // The call sheet: the scene with its frames, the plan and the kit list.
      await page.goto(`/p/${project.id}/b/${productionId}`);
      await page.getByRole('button', { name: 'Foglio di lavorazione', exact: true }).click();
      const sheet = page.getByRole('article', { name: 'Anteprima foglio di lavorazione' });
      const scenes = sheet.locator('.sheet__section').filter({ hasText: 'Piante del set' });
      await expect(scenes.locator('.plan__svg')).toBeVisible();
      await expect(scenes.locator('.sheet__kit')).toContainText('Fresnel 1,2K');
      await expect(scenes.locator('.sheet__kit')).toContainText(/Binario \d/);
      // The power per circuit under the kit (decision 0111): 1.2 kW at 230 V, on no circuit.
      await expect(scenes.locator('.sheet__power')).toContainText('1,2 kW · 5,2 A');
      await scenes.scrollIntoViewIfNeeded();
      await page
        .getByRole('dialog', { name: 'Foglio di lavorazione' })
        .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      await page.screenshot({ path: join(out, `desktop-${theme}-callsheet.png`) });
      await page.keyboard.press('Escape');
    }
    const state = await page.context().storageState();
    await page.close();

    // Phones: the editor takes the whole screen, the set icons above the tools.
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
      const mobile = await phone.newPage();
      await mobile.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await mobile.goto(`${baseURL}/p/${project.id}/b/${root}?view=canvas`);
      const plan = mobile.locator(`[data-el="${planId}"]`);
      await mobile.getByRole('button', { name: 'Adatta alla vista' }).click();
      await expect(plan).toBeInViewport({ ratio: 0.95 });
      await plan.dblclick();
      const full = mobile.getByRole('dialog', { name: /Pianta del set/ });
      await expect(full.getByRole('button', { name: 'Fatto' })).toBeVisible();
      // A tap on A cam: its properties in a sheet under the plan, the tools above it.
      const phoneBox = (await full.locator('.plan-editor__stage').boundingBox())!;
      await mobile.touchscreen.tap(
        phoneBox.x + (100 / 400) * phoneBox.width,
        phoneBox.y + (200 / (400 / 1.5)) * phoneBox.height,
      );
      const selection = full.getByRole('region', { name: 'Elemento selezionato' });
      await expect(selection).toBeVisible();
      await expect(selection.getByRole('group', { name: 'Ottica' })).toBeVisible();
      await selection.getByRole('button', { name: 'Tutte le proprietà' }).tap();
      const height = selection.getByRole('textbox', { name: 'Altezza' });
      await expect(height).toHaveValue('0');
      await height.fill('1,2');
      await height.press('Enter');
      await expect(height).toHaveValue('1,2');
      // The tools keep their names and are not covered by the sheet.
      const tools = full.getByRole('navigation', { name: 'Strumenti della pianta' });
      for (const name of ['Seleziona', 'Disegna', 'Misura', 'Icone da set']) {
        const button = tools.getByRole('button', { name, exact: true });
        expect(
          await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }),
        ).toBe(true);
      }
      await mobile.mouse.move(0, 0);
      await mobile.screenshot({ path: join(out, `phone-${theme}-selection.png`) });
      await tools.getByRole('button', { name: 'Seleziona', exact: true }).tap();
      await mobile.keyboard.press('Escape');
      await tools.getByRole('button', { name: 'Icone da set', exact: true }).tap();
      const sheet = full.getByRole('region', { name: 'Icone da set' });
      await expect(sheet.getByRole('button', { name: 'Fresnel', exact: true })).toBeVisible();
      await sheet.getByRole('button', { name: 'Set', exact: true }).tap();
      await expect(sheet.getByRole('button', { name: 'Divano', exact: true })).toBeVisible();
      await sheet.getByRole('button', { name: 'Luci', exact: true }).tap();
      await mobile.screenshot({ path: join(out, `phone-${theme}-library.png`) });
      await sheet.getByRole('button', { name: 'Chiudi le icone' }).tap();
      // A route on a phone: B cam, Add a position, then a tap on a new spot.
      const phoneStage = (await full.locator('.plan-editor__stage').boundingBox())!;
      const pt = (x: number, y: number) => ({
        x: phoneStage.x + (x / 400) * phoneStage.width,
        y: phoneStage.y + (y / (400 / 1.5)) * phoneStage.height,
      });
      const bCam = pt(326, 70);
      await mobile.touchscreen.tap(bCam.x, bCam.y);
      await selection.getByRole('button', { name: 'Tutte le proprietà' }).tap();
      await selection.getByRole('button', { name: 'Aggiungi una posizione' }).tap();
      const spot3 = pt(120, 150);
      await mobile.touchscreen.tap(spot3.x, spot3.y);
      await expect(full.locator('.plan-canvas__toast')).toContainText('Tocca la posizione 3');
      await mobile.screenshot({ path: join(out, `phone-${theme}-blocking.png`) });
      await full
        .getByRole('toolbar', { name: 'Percorso' })
        .getByRole('button', { name: 'Fatto' })
        .tap();
      await full.locator('.plan-top').getByRole('button', { name: 'Fatto' }).tap();
      await expect(full).toHaveCount(0);
    } finally {
      await phone.close();
    }
  });
}
