// SPDX-License-Identifier: AGPL-3.0-only
// Walls, openings and starting a set plan (decision 0110): the start dialog of an empty plan
// (a ready room, the set of another plan of the same location), the Walls tool (corner by
// corner, a typed length, closing on the first corner, one undo step per side), the Openings
// tool (a door placed on a wall and dragged along it) and the background picture (uploaded,
// placed, its opacity changed). Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createElement, toWallPoints } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
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
const H = 1000 / 1.5;

/** A small PNG, twice as wide as it is tall, in a light grey. */
function png(width = 64, height = 32): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xc8)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function seed(page: Page, baseURL: string, extra = 0) {
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
    data: { name: 'Pianta · muri' },
  });
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const opts = { userId: null };
  const diner = createElement(doc, 'location', { x: 900, y: 80 }, { name: 'Da Rosa' }, opts);
  const empty = createElement(doc, 'plan', { x: 80, y: 80 }, { w: 420, title: 'Vuota' }, opts);
  const drawn = createElement(doc, 'plan', { x: 80, y: 520 }, { w: 420, title: 'Muri' }, opts);
  const room = toWallPoints([
    { x: 200, y: 150 },
    { x: 700, y: 150 },
    { x: 700, y: 500 },
    { x: 200, y: 500 },
  ]);
  const scene5 = createElement(
    doc,
    'plan',
    { x: 560, y: 80 },
    {
      w: 300,
      title: 'Scena 5',
      locationId: diner.id,
      scale: 60,
      grid: '0.5',
      walls: [{ id: 'wallSourceAAA', points: room, thickness: 9, closed: true }],
      openings: [{ id: 'doorSourceAAA', wall: 'wallSourceAAA', kind: 'door', at: 120, width: 54 }],
      icons: [
        { id: 'iconTableAAAA', kind: 'table', color: '#1C1C1E', x: 1800, y: 1800, w: 90, h: 60 },
        { id: 'iconLightAAAA', kind: 'fresnel', color: '#EDD963', x: 1200, y: 1200 },
      ],
    },
    opts,
  );
  const reuser = createElement(
    doc,
    'plan',
    { x: 560, y: 520 },
    { w: 300, title: 'Scena 9', locationId: diner.id },
    opts,
  );
  const spare = Array.from(
    { length: extra },
    (_, i) =>
      createElement(
        doc,
        'plan',
        { x: 1300 + i * 460, y: 80 },
        { w: 420, title: `Vuota ${i}` },
        opts,
      ).id,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  await page.goto(`/p/${project.id}?view=canvas`);
  const read = async (id: string) => {
    const stored = await readBoard(baseURL, cookie, root);
    return [...roots(stored).elements.values()]
      .map((m) => readElement(m))
      .find((e): e is Plan => e?.id === id) as Plan;
  };
  return {
    project,
    ids: { empty: empty.id, drawn: drawn.id, scene5: scene5.id, reuser: reuser.id, spare },
    read,
  };
}

const pointOf = async (stage: Locator, [x, y]: readonly number[]) => {
  const box = (await stage.boundingBox())!;
  return {
    x: box.x + ((x as number) / 1000) * box.width,
    y: box.y + ((y as number) / H) * box.height,
  };
};

test('starts from a ready room, draws and closes a room with a typed length, places and moves a door', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { ids, read } = await seed(page, baseURL!);
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  const at = (p: readonly number[]) => pointOf(stage, p);

  // An empty plan opens with the start dialog; a ready room 8 × 6 m.
  await page.locator(`[data-el="${ids.empty}"]`).dblclick();
  const start = editor.getByRole('dialog', { name: /Inizia la pianta/ });
  await expect(start).toBeVisible();
  await page.screenshot({ path: join(out, 'walls-1280-start.png') });
  await start.getByRole('radio', { name: 'Rettangolo' }).check();
  await start.getByRole('textbox', { name: 'Larghezza' }).fill('8');
  await start.getByRole('textbox', { name: 'Larghezza' }).press('Enter');
  await start.getByRole('textbox', { name: 'Profondità' }).fill('6');
  await start.getByRole('textbox', { name: 'Profondità' }).press('Enter');
  await start.getByRole('button', { name: 'Crea la stanza' }).click();
  await expect(start).toHaveCount(0);
  await expect
    .poll(async () => {
      const p = await read(ids.empty);
      return [p.walls?.length, p.walls?.[0]?.closed, p.walls?.[0]?.points.length, p.scale];
    })
    .toEqual([1, true, 8, 88]);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);

  // Drawing a room: corner by corner, a typed length, closed on the first corner.
  await page.locator(`[data-el="${ids.drawn}"]`).dblclick();
  await expect(start).toBeVisible();
  await start.getByRole('radio', { name: /Disegna i muri/ }).check();
  await start.getByRole('button', { name: 'Disegna i muri' }).click();
  await expect(editor.getByRole('button', { name: 'Fine muri' })).toBeVisible();
  let p = await at([400, 250]);
  await page.mouse.click(p.x, p.y);
  p = await at([800, 255]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.keyboard.type('4');
  await expect(editor.getByRole('textbox', { name: /Lunghezza del prossimo lato/ })).toHaveValue('4');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await read(ids.drawn)).walls?.length).toBe(1);
  // 4 m at the nominal scale the first wall gave the plan: 352 view units to the right. The
  // points stay clear of the openings palette, over the top left of the drawing.
  const first = (await read(ids.drawn)).walls?.[0];
  const rightX = ((first?.points[2] as number) / 4096) * 1000;
  expect(rightX).toBeCloseTo(752, 0);
  expect((await read(ids.drawn)).scale).toBe(88);
  p = await at([rightX, 555]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.screenshot({ path: join(out, 'walls-1280-drawing.png') });
  await page.mouse.click(p.x, p.y);
  p = await at([400, 552]);
  await page.mouse.click(p.x, p.y);
  await expect(editor.getByText('Clicca qui per chiudere la stanza')).toBeVisible();
  p = await at([401, 251]);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => {
      const w = (await read(ids.drawn)).walls?.[0];
      return [w?.closed, w?.points.length];
    })
    .toEqual([true, 8]);
  // One undo step per side: undo opens the room again, redo closes it.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await read(ids.drawn)).walls?.[0]?.closed).toBeUndefined();
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await read(ids.drawn)).walls?.[0]?.closed).toBe(true);

  // A door placed on the top wall, its width and distances shown, then dragged along it.
  await editor.getByRole('button', { name: /^Aperture/ }).click();
  await expect(editor.getByRole('toolbar', { name: 'Aperture' })).toBeVisible();
  p = await at([550, 250]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await expect(editor.locator('.plan-walls__ghost')).toBeVisible();
  await page.screenshot({ path: join(out, 'walls-1280-door.png') });
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await read(ids.drawn)).openings?.[0]?.kind).toBe('door');
  const placed = (await read(ids.drawn)).openings?.[0]?.at as number;
  expect(placed).toBeGreaterThan(100);
  await editor.getByRole('button', { name: 'Fine muri' }).click();
  // The Select tool picks the door and drags it along its wall: one change.
  p = await at([550, 250]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const to = await at([650, 270]);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await read(ids.drawn)).openings?.[0]?.at).toBeGreaterThan(placed + 60);
  const panel = editor.getByRole('tabpanel', { name: 'Proprietà' });
  await expect(panel.getByText('Porta', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: join(out, 'walls-1280-door-picked.png') });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await read(ids.drawn)).openings?.[0]?.at).toBeCloseTo(placed, 0);
  // Its width typed in the properties.
  await panel.getByRole('textbox', { name: "Larghezza dell'apertura" }).fill('1,2');
  await panel.getByRole('textbox', { name: "Larghezza dell'apertura" }).press('Enter');
  await expect.poll(async () => (await read(ids.drawn)).openings?.[0]?.width).toBeCloseTo(105.6, 0);
});

test('sets a background picture, places it and changes its opacity', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { ids, read } = await seed(page, baseURL!);
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  await page.locator(`[data-el="${ids.scene5}"]`).dblclick();
  const chooser = page.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Sfondo', exact: true }).click();
  await (await chooser).setFiles({ name: 'sopralluogo.png', mimeType: 'image/png', buffer: png() });
  await expect.poll(async () => (await read(ids.scene5)).background?.assetId, { timeout: 30_000 }).toBeTruthy();
  const placed = (await read(ids.scene5)).background;
  // Fitted with its shape kept, faint and grey, and the editor places it.
  expect(placed?.w).toBeCloseTo(1000, 0);
  expect(placed?.h).toBeCloseTo(500, 0);
  expect([placed?.opacity, placed?.grey]).toEqual([0.4, true]);
  const bar = editor.getByRole('toolbar', { name: /Trascina l'immagine/ });
  await expect(bar).toBeVisible();
  const a = await pointOf(stage, [500, 300]);
  const b = await pointOf(stage, [500, 360]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await read(ids.scene5)).background?.y ?? 0).toBeGreaterThan((placed?.y ?? 0) + 40);
  await bar.getByRole('button', { name: 'Fatto' }).click();
  await expect(bar).toHaveCount(0);
  // Opacity from the Background panel.
  await editor.getByRole('button', { name: 'Sfondo', exact: true }).click();
  const pop = page.getByRole('dialog', { name: 'Immagine di sfondo' });
  await pop.getByRole('slider', { name: 'Opacità' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await read(ids.scene5)).background?.opacity).toBeCloseTo(0.5, 2);
  await page.screenshot({ path: join(out, 'walls-1280-background.png') });
  await pop.getByRole('button', { name: 'Fatto' }).click();
  // The Set layer in Elements lists it, and hides it.
  await editor.getByRole('tab', { name: 'Elementi' }).click();
  await editor.getByRole('button', { name: 'Nascondi lo sfondo' }).click();
  await expect.poll(async () => (await read(ids.scene5)).background?.hidden).toBe(true);
});

test('reuses the set of another plan of the same location', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { ids, read } = await seed(page, baseURL!);
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  await page.locator(`[data-el="${ids.reuser}"]`).dblclick();
  const start = editor.getByRole('dialog', { name: 'Inizia la pianta di Da Rosa' });
  await expect(start).toBeVisible();
  const reuse = start.getByRole('radio', { name: /Riusa il set di questa location/ });
  await expect(reuse).toBeChecked();
  await expect(start).toContainText('Da Rosa, Scena 5');
  await page.screenshot({ path: join(out, 'walls-1280-reuse.png') });
  await start.getByRole('button', { name: 'Riusa il set' }).click();
  await expect
    .poll(async () => {
      const p = await read(ids.reuser);
      return [
        p.walls?.length,
        p.openings?.length,
        p.openings?.[0]?.wall === p.walls?.[0]?.id,
        p.icons?.map((i) => i.kind),
        p.scale,
      ];
    })
    .toEqual([1, 1, true, ['table'], 60]);
  // The source keeps its own.
  expect((await read(ids.scene5)).icons).toHaveLength(2);
});

test('on a phone, Walls is in the tools and the start dialog is a sheet', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(90_000);
  const { project, ids, read } = await seed(page, baseURL!);
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
    await m.locator(`[data-el="${ids.drawn}"]`).dblclick();
    const full = m.getByRole('dialog', { name: /Pianta del set/ });
    const start = full.getByRole('dialog', { name: /Inizia la pianta/ });
    await expect(start).toBeVisible();
    await m.screenshot({ path: join(out, 'walls-390-start.png') });
    // Picking Walls in the tools is starting too: the sheet goes.
    await full.getByRole('button', { name: 'Muri', exact: true }).tap();
    await expect(start).toHaveCount(0);
    const stage = full.locator('.plan-editor__stage');
    for (const q of [
      [200, 150],
      [600, 150],
      [600, 450],
    ]) {
      const p = await pointOf(stage, q);
      await m.touchscreen.tap(p.x, p.y);
    }
    await expect.poll(async () => (await read(ids.drawn)).walls?.[0]?.points.length).toBe(6);
    await m.screenshot({ path: join(out, 'walls-390-drawing.png') });
    await full.getByRole('button', { name: 'Fine muri' }).tap();
  } finally {
    await phone.close();
  }
});

// The screenshots of the pull request: light and dark, 1280 and 390, each state of the tools.
// Only when SET_PLAN_SHOTS names a folder; CI checks the behaviour above.
test('screenshots of the walls tools, the start dialog and the background', async ({
  page,
  baseURL,
  browser,
}) => {
  test.skip(!process.env.SET_PLAN_SHOTS, 'screenshots only on request');
  test.setTimeout(300_000);
  mkdirSync(out, { recursive: true });
  const { project, ids } = await seed(page, baseURL!, 4);
  const state = await page.context().storageState();
  let n = 0;
  for (const theme of ['light', 'dark'] as const)
    for (const width of [1280, 390]) {
      const phone = width < 600;
      const ctx = await browser.newContext({
        viewport: { width, height: phone ? 844 : 800 },
        hasTouch: phone,
        isMobile: phone,
        locale: 'it-IT',
        colorScheme: theme,
        reducedMotion: 'reduce',
        storageState: state,
      });
      const m = await ctx.newPage();
      const shot = (name: string) =>
        m.screenshot({ path: join(out, `${theme}-${width}-${name}.png`) });
      const tap = (l: Locator) => (phone ? l.tap() : l.click());
      try {
        await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
        await m.getByRole('button', { name: 'Adatta alla vista' }).click();
        const fresh = ids.spare[n++] as string;
        await m.locator(`[data-el="${fresh}"]`).dblclick();
        const editor = m.getByRole('dialog', { name: /Pianta del set/ });
        const stage = editor.locator('.plan-editor__stage');
        const start = editor.getByRole('dialog', { name: /Inizia la pianta/ });
        await expect(start).toBeVisible();
        await shot('start');
        // An 8 × 6 m room: x 148 to 852, y 69 to 597 of the drawing.
        await tap(start.getByRole('button', { name: 'Crea la stanza' }));
        await expect(start).toHaveCount(0);
        // The walls tool, a side being drawn with its length and angle.
        await tap(editor.getByRole('button', { name: /^Muri/ }).first());
        const go = async (q: readonly number[], click = true) => {
          const p = await pointOf(stage, q);
          if (phone && click) await m.touchscreen.tap(p.x, p.y);
          else if (click) await m.mouse.click(p.x, p.y);
          else await m.mouse.move(p.x, p.y, { steps: 3 });
        };
        await go([300, 200]);
        await go([500, 202]);
        await go([502, 330], false);
        await shot('walls-drawing');
        await m.keyboard.press('Escape');
        // The Openings tool over a wall.
        await tap(editor.getByRole('button', { name: /^Porta/ }).first());
        await go([480, 72], false);
        await shot('door-ghost');
        await go([480, 72]);
        await tap(editor.getByRole('button', { name: 'Fine muri' }));
        // A wall picked: its sides and corners; then the door: its properties.
        await go([148, 400]);
        await m.mouse.move(0, 0);
        await shot('wall-picked');
        await go([480, 70]);
        await m.mouse.move(0, 0);
        await shot('door-picked');
        await m.keyboard.press('Escape');
        if (!phone) {
          // The background: picked, placed, its panel, and the Set layer in Elements.
          const chooser = m.waitForEvent('filechooser');
          await editor.getByRole('button', { name: 'Sfondo', exact: true }).click();
          await (await chooser).setFiles({
            name: 'sopralluogo.png',
            mimeType: 'image/png',
            buffer: png(),
          });
          const bar = editor.getByRole('toolbar', { name: /Trascina l'immagine/ });
          await expect(bar).toBeVisible({ timeout: 30_000 });
          await shot('background-placing');
          await bar.getByRole('button', { name: 'Fatto' }).click();
          await editor.getByRole('button', { name: 'Sfondo', exact: true }).click();
          await shot('background-panel');
          await m.getByRole('dialog', { name: 'Immagine di sfondo' }).getByRole('button', { name: 'Fatto' }).click();
          await editor.getByRole('tab', { name: 'Elementi' }).click();
          await shot('elements');
        }
      } finally {
        await ctx.close();
      }
    }
});
