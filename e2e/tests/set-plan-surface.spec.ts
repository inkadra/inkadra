// SPDX-License-Identifier: AGPL-3.0-only
// The drawing surface of the set plan editor (decision 0117): it fills the area, pans and zooms
// round the pointer, Fit frames the plan, items go beyond the old 3:2 extent; a click picks a
// light before its modifiers, a click again or Alt the item under the picked one; Shift adds and
// takes away; the dolly slides along its track; people stack over furniture whatever the order.
// Desktop and phone. Runs after first-run.spec.ts in CI; alone, it signs up.
import { attachIcon, createElement } from '@inkadra/canvas-core';
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

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
type Plan = Extract<Element, { type: 'plan' }>;
const gx = (x: number) => Math.round((x / 1000) * STROKE_GRID);
const gy = (y: number) => Math.round((y / (1000 / 1.5)) * STROKE_GRID);
const P = {
  key: [300, 220],
  stool: [650, 220],
  table: [480, 420],
  track: [300, 500],
  empty: [880, 600],
} as const;
const icon = (
  id: string,
  kind: PlanIcon['kind'],
  [x, y]: readonly number[],
  extra: Partial<PlanIcon> = {},
): PlanIcon => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color: '#9DB8F2',
  x: gx(x as number),
  y: gy(y as number),
  ...extra,
});

/** A key light with a softbox, Anna on a stool, a table under a person, a dolly on a track. */
function rig(): PlanIcon[] {
  let icons: PlanIcon[] = [
    icon('Key', 'cob', P.key, { label: 'Key' }),
    icon('Box', 'softbox', P.key, { label: 'Box' }),
    icon('Stool', 'stool', P.stool, { label: 'Sgabello' }),
    icon('Anna', 'actor', P.stool, { label: 'Anna' }),
    // The person first, the table after: the person still draws and picks on top.
    icon('Rosa', 'actor', P.table, { label: 'Rosa' }),
    icon('Table', 'table', P.table, { label: 'Tavolo', w: 120, h: 70 }),
    icon('Track', 'track', P.track, { label: 'Binario', w: 300, h: 40 }),
    icon('Dolly', 'dolly', P.track, { label: 'Carrello' }),
  ];
  const on = (id: string, base: string) => {
    const changed = attachIcon(icons, `icon${id}`.padEnd(13, 'A'), `icon${base}`.padEnd(13, 'A'));
    icons = icons.map((i) => changed.find((c) => c.id === i.id) ?? i);
  };
  on('Box', 'Key');
  on('Anna', 'Stool');
  on('Dolly', 'Track');
  return icons;
}

async function seed(page: Page, baseURL: string) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => ({
      name: pair.slice(0, pair.indexOf('=')),
      value: pair.slice(pair.indexOf('=') + 1),
      url: baseURL,
    })),
  );
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Pianta · superficie' },
  });
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const plan = createElement(
    doc,
    'plan',
    { x: 200, y: 80 },
    { w: 480, title: 'Superficie', icons: rig() },
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
  const find = async (label: string) =>
    ((await saved()).icons ?? []).find((i) => i.label === label) as PlanIcon;
  return { project, planId: plan.id, find };
}

/** A point of the drawing (view units of its old extent) on screen. */
const pointOf = async (stage: Locator, [x, y]: readonly number[]) => {
  const box = (await stage.boundingBox())!;
  return {
    x: box.x + ((x as number) / 1000) * box.width,
    y: box.y + ((y as number) / (1000 / 1.5)) * box.height,
  };
};
/** Where an icon stands, in view units. */
const at = (i: PlanIcon) => [(i.x / STROKE_GRID) * 1000, (i.y / STROKE_GRID) * (1000 / 1.5)];

test('the surface fills the editor, pans, zooms round the pointer and fits the plan', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId, find } = await seed(page, baseURL!);
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  const surface = editor.locator('.plan-canvas__surface');
  const area = (await editor.locator('.plan-main__canvas').boundingBox())!;
  // The surface is the whole area between the panels, without scroll bars.
  const s = (await surface.boundingBox())!;
  expect([s.width, s.height]).toEqual([area.width, area.height]);
  expect(await surface.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const fitted = (await stage.boundingBox())!;

  // The toolbar and the zoom control do not overlap at 1280.
  const tools = (await editor.getByRole('toolbar', { name: 'Strumenti della pianta' }).boundingBox())!;
  const zoom = (await editor.getByRole('group', { name: 'Zoom' }).boundingBox())!;
  expect(tools.x + tools.width).toBeLessThanOrEqual(zoom.x);

  // The wheel zooms round the pointer: the point under it stays under it.
  const pointer = await pointOf(stage, P.empty);
  await page.mouse.move(pointer.x, pointer.y);
  const percent = editor.locator('.plan-canvas__percent');
  const before = Number((await percent.innerText()).replace('%', ''));
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number((await percent.innerText()).replace('%', ''))).toBeGreaterThan(before);
  const after = await pointOf(stage, P.empty);
  expect(Math.abs(after.x - pointer.x)).toBeLessThan(2);
  expect(Math.abs(after.y - pointer.y)).toBeLessThan(2);

  // A drag on empty space pans; it picks nothing and moves nothing.
  const key = (await find('Key')).x;
  const from = (await stage.boundingBox())!;
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down();
  await page.mouse.move(pointer.x - 120, pointer.y + 60, { steps: 6 });
  await page.mouse.up();
  const panned = (await stage.boundingBox())!;
  expect(Math.round(panned.x - from.x)).toBe(-120);
  expect(Math.round(panned.y - from.y)).toBe(60);
  expect((await find('Key')).x).toBe(key);

  // Fit frames the plan again.
  await editor.getByRole('button', { name: 'Adatta la pianta' }).click();
  await expect.poll(async () => Math.round((await stage.boundingBox())!.x)).toBe(Math.round(fitted.x));
  expect(Math.round((await stage.boundingBox())!.width)).toBe(Math.round(fitted.width));

  // An item dragged beyond the old extent stays there (decision 0117).
  await editor.getByRole('button', { name: 'Riduci' }).click();
  await editor.getByRole('button', { name: 'Riduci' }).click();
  const table = at(await find('Tavolo'));
  const t = await pointOf(stage, [table[0] as number, (table[1] as number) + 30]);
  const box = (await stage.boundingBox())!;
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, t.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await find('Tavolo')).x).toBeLessThan(0);
});

test('a click picks a light before its softbox, a click again what lies under, Shift adds', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId, find } = await seed(page, baseURL!);
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  const props = editor.getByRole('tabpanel', { name: 'Proprietà' });
  const name = props.getByRole('textbox', { name: 'Nome' });
  const click = async (where: readonly number[], modifiers: string[] = []) => {
    const p = await pointOf(stage, where);
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(p.x, p.y);
    for (const m of modifiers) await page.keyboard.up(m);
  };

  // The light, not the softbox on its front; the softbox on a second click.
  const key = at(await find('Key'));
  await click(key);
  await expect(name).toHaveValue('Key');
  await click(key);
  await expect(name).toHaveValue('Box');
  await click(key);
  await expect(name).toHaveValue('Key');

  // Anna on top of her stool; the stool on a second click, and Alt picks it at once.
  await page.keyboard.press('Escape');
  const anna = at(await find('Anna'));
  await click(anna);
  await expect(name).toHaveValue('Anna');
  await click(anna);
  await expect(name).toHaveValue('Sgabello');
  await page.keyboard.press('Escape');
  await click(anna, ['Alt']);
  await expect(name).toHaveValue('Sgabello');
  // The picked stool is dragged from there, and carries Anna.
  const annaX = (await find('Anna')).x;
  const a = await pointOf(stage, anna);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await find('Anna')).x).toBeGreaterThan(annaX);
  expect((await find('Anna')).on).toBe((await find('Sgabello')).id);

  // People stack over furniture whatever the order: Rosa, stored first, is on top of the table.
  await page.keyboard.press('Escape');
  await click(at(await find('Rosa')));
  await expect(name).toHaveValue('Rosa');

  // Shift adds to the selection and takes away.
  await click(key);
  await click(at(await find('Rosa')), ['Shift']);
  await expect(props).toContainText('2 elementi selezionati');
  await click(key, ['Shift']);
  await expect(name).toHaveValue('Rosa');

  // A dolly pulled across its track slides along it only.
  await page.keyboard.press('Escape');
  const dolly = await find('Carrello');
  const d = await pointOf(stage, at(dolly));
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 40, d.y + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await find('Carrello')).x).toBeGreaterThan(dolly.x);
  expect((await find('Carrello')).on).toBe((await find('Binario')).id);
  expect(Math.abs((await find('Carrello')).y - dolly.y)).toBeLessThan(8);
});

test('on a phone the plan fills the screen, a tap picks the light and two fingers zoom', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(120_000);
  const { project, planId } = await seed(page, baseURL!);
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
    const surface = (await full.locator('.plan-canvas__surface').boundingBox())!;
    // Between the header and the bar of tools, edge to edge.
    expect(surface.width).toBe(390);
    expect(surface.height).toBeGreaterThan(600);
    const tools = (await full.getByRole('navigation', { name: 'Strumenti della pianta' }).boundingBox())!;
    expect(Math.round(tools.y + tools.height)).toBe(844);

    // A tap on the light opens the light, not its softbox.
    const key = await pointOf(stage, P.key);
    await m.touchscreen.tap(key.x, key.y);
    const sheet = full.getByRole('region', { name: 'Elemento selezionato' });
    await expect(sheet).toContainText('Key');
    // The tools stay under the sheet.
    const s = (await sheet.boundingBox())!;
    const bar = (await full.getByRole('navigation', { name: 'Strumenti della pianta' }).boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(bar.y + 1);

    // Two fingers spread apart zoom in.
    const cdp = await phone.newCDPSession(m);
    const before = (await stage.boundingBox())!.width;
    const c = { x: 195, y: 300 };
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', d: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [
                { x: c.x - d, y: c.y, id: 1 },
                { x: c.x + d, y: c.y, id: 2 },
              ],
      });
    await touch('touchStart', 30);
    for (const d of [45, 60, 80, 100]) {
      await touch('touchMove', d);
      await m.waitForTimeout(40);
    }
    await touch('touchEnd', 0);
    await expect.poll(async () => (await stage.boundingBox())!.width).toBeGreaterThan(before * 1.5);
  } finally {
    await phone.close();
  }
});
