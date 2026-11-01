// SPDX-License-Identifier: AGPL-3.0-only
// Set plans (#335): the card on the board, its editor on a desktop and on a phone. Runs after
// first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, encodeStroke } from '@inkadra/canvas-core';
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
  const root = project.rootBoardId as string;

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
  const plan = createElement(
    doc,
    'plan',
    { x: 320, y: 120 },
    {
      w: 480,
      title: 'Cucina, giorno 2',
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
        text('Table', 176, 124, 'tavolo'),
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
        icon('Window', 'window', INK, 160, 20),
        icon('Door', 'door', INK, 210, 212),
        icon('Table', 'table', INK, 204, 121),
        icon('Track', 'track', INK, 112, 211),
        icon('ACam', 'camera', '#9DB8F2', 100, 200, 310, 'A cam'),
        icon('BCam', 'camera', '#9DB8F2', 326, 70, 160, 'B cam'),
        icon('Key', 'fresnel', '#EDD963', 340, 198, 225, 'Key 1,2K'),
        icon('Anna', 'actor', '#B897F0', 204, 78, 90, 'Anna'),
        icon('Marco', 'actor', '#7AD689', 214, 168, 270, 'Marco'),
      ],
    },
    opts,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { cookie, project, planId: plan.id };
}

for (const theme of ['dark', 'light'] as const) {
  test(`set plan: card, editor and phone (${theme})`, async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const { cookie, project, planId } = await seed(page, baseURL!, theme);
    const root = project.rootBoardId as string;
    const saved = async () => {
      const doc = await readBoard(baseURL!, cookie, root);
      const plans = [...roots(doc).elements.values()]
        .map((m) => readElement(m))
        .filter((e): e is Plan => e?.type === 'plan');
      return { plan: plans.find((e) => e.id === planId), count: plans.length };
    };
    await page.goto(`/p/${project.id}?view=canvas`);

    // On the board: the title and the drawing, without the grid.
    const card = page.locator(`[data-el="${planId}"]`);
    await expect(card).toContainText('Pianta del set · Cucina, giorno 2');
    await expect(card.locator('.plan__svg text', { hasText: 'A cam' })).toBeVisible();
    await expect(card.locator('pattern')).toHaveCount(0);
    await page.mouse.click(1300, 820);
    await page.screenshot({ path: join(out, `desktop-${theme}-board.png`) });

    // Editing: a window in front of the dimmed board, tools inside its left edge, the library
    // of 42 icons in 7 categories (and the annotations) on the right.
    await card.dblclick();
    const editor = page.getByRole('dialog', { name: 'Pianta del set · Cucina, giorno 2' });
    await expect(editor.getByRole('toolbar', { name: 'Strumenti della pianta' })).toBeVisible();
    await expect(editor.locator('pattern')).toHaveCount(1);
    // 42 icons and 4 annotations, plus the recent and starred ones of earlier runs.
    expect(await editor.locator('.plan-lib__tile').count()).toBeGreaterThanOrEqual(46);
    // The last match: the category tile, after Recent and Favourites.
    const tile = (name: string) => editor.getByRole('button', { name, exact: true }).last();
    await expect(tile('Binario')).toBeVisible();
    // The tools stay inside the window: nothing covers the cards next to the plan.
    const win = (await editor.boundingBox())!;
    const tools = (await editor
      .getByRole('toolbar', { name: 'Strumenti della pianta' })
      .boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(win.x);

    // Search knows synonyms: "kino" finds the tube; Enter would place it.
    const search = editor.getByRole('searchbox', { name: 'Cerca un’icona' });
    await search.fill('kino');
    await expect(editor.locator('.plan-lib__tile')).toHaveCount(1);
    await expect(tile('Tubo')).toBeVisible();
    if (theme === 'dark') await page.screenshot({ path: join(out, 'desktop-dark-search.png') });
    await search.fill('');
    // A star keeps an icon among the Favourites.
    // (The account is the same for both themes: the star stays from the dark run.)
    if (theme === 'dark')
      await editor.getByRole('button', { name: 'Preferito: Pannello LED' }).click();
    await expect(editor.getByText('Preferiti', { exact: true })).toBeVisible();

    // Selecting A cam: the bar with its colour, its label, Ruota, Duplica and Elimina.
    const stage = editor.locator('.plan-editor__stage');
    const box = (await stage.boundingBox())!;
    const at = (x: number, y: number) => ({
      x: box.x + (x / 400) * box.width,
      y: box.y + (y / (400 / 1.5)) * box.height,
    });
    const aCam = at(100, 200);
    await page.mouse.click(aCam.x, aCam.y);
    const bar = editor.getByRole('toolbar', { name: 'Elemento selezionato' });
    await expect(bar.getByLabel('Etichetta')).toHaveValue('A cam');
    await expect(bar.getByRole('button', { name: 'Blu' })).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.locator('[data-rotate]')).toBeVisible();
    await page.screenshot({ path: join(out, `desktop-${theme}-editing.png`) });

    const camera = async () => (await saved()).plan?.icons?.find((i) => i.label === 'A cam');
    await page.keyboard.press('r');
    await expect.poll(async () => (await camera())?.rotation).toBe(325);
    await bar.getByRole('button', { name: 'Ruota (R)' }).click();
    await expect.poll(async () => (await camera())?.rotation).toBe(340);
    await bar.getByRole('button', { name: 'Giallo' }).click();
    await expect.poll(async () => (await camera())?.color).toBe('#EDD963');
    await bar.getByLabel('Etichetta').fill('A cam 35mm');
    await expect
      .poll(async () => (await saved()).plan?.icons?.some((i) => i.label === 'A cam 35mm'))
      .toBe(true);

    // Duplicate, then delete the copy; the plan keeps the nine icons it had.
    await bar.getByRole('button', { name: 'Duplica' }).click();
    await expect.poll(async () => (await saved()).plan?.icons?.length).toBe(10);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await saved()).plan?.icons?.length).toBe(9);

    // Tap Fresnel, then tap the plan twice: it stays armed and places two, then Recent shows it.
    await tile('Fresnel').click();
    const spot = at(60, 60);
    await page.mouse.click(spot.x, spot.y);
    const spot2 = at(60, 120);
    await page.mouse.click(spot2.x, spot2.y);
    await expect
      .poll(async () => (await saved()).plan?.icons?.filter((i) => i.kind === 'fresnel').length)
      .toBe(3);
    await expect(editor.getByText('Recenti', { exact: true })).toBeVisible();
    await page.mouse.click(aCam.x, aCam.y);
    await page.screenshot({ path: join(out, `desktop-${theme}-library.png`) });

    // A line with the Linea tool, next to the walls.
    await editor.getByRole('button', { name: 'Linea' }).click();
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
    await card.click({ position: { x: 300, y: 20 } });
    await page.keyboard.press('Control+d');
    await expect.poll(async () => (await saved()).count).toBe(2);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await saved()).count).toBe(1);
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
      await mobile.goto(`${baseURL}/p/${project.id}?view=canvas`);
      const plan = mobile.locator(`[data-el="${planId}"]`);
      await mobile.getByRole('button', { name: 'Adatta alla vista' }).click();
      await expect(plan).toBeInViewport({ ratio: 1 });
      await plan.dblclick();
      const full = mobile.getByRole('dialog', { name: /Pianta del set/ });
      await expect(full.getByRole('button', { name: 'Fatto' })).toBeVisible();
      await full.getByRole('button', { name: 'Icone da set' }).tap();
      await expect(full.getByRole('button', { name: 'Fresnel', exact: true })).toBeVisible();
      await full.getByRole('tab', { name: 'Arredi' }).tap();
      await expect(full.getByRole('button', { name: 'Divano', exact: true })).toBeVisible();
      await full.getByRole('tab', { name: 'Luci' }).tap();
      await mobile.screenshot({ path: join(out, `phone-${theme}-library.png`) });
      await full.getByRole('button', { name: 'Fatto' }).tap();
      await expect(full).toHaveCount(0);
    } finally {
      await phone.close();
    }
  });
}
