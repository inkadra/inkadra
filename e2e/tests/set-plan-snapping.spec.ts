// SPDX-License-Identifier: AGPL-3.0-only
// Icons snap together in the set plan editor (decision 0104): a person on a seat, modifiers on
// the front of a light, a light on a stand; the base moves what is on it; pulling away detaches;
// Alt places free; on a phone the Snap toggle does what Alt does. Runs after first-run.spec.ts in
// CI; alone, it signs up.
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
const gx = (x: number) => Math.round((x / 1000) * STROKE_GRID);
const gy = (y: number) => Math.round((y / (1000 / 1.5)) * STROKE_GRID);
const P = { chair: [300, 300], light: [600, 220], stand: [800, 480], free: [150, 560] } as const;
const icon = (id: string, kind: PlanIcon['kind'], color: string, [x, y]: readonly number[]) => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color,
  x: gx(x as number),
  y: gy(y as number),
});

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
    data: { name: 'Pianta · aggancio' },
  });
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const plan = createElement(
    doc,
    'plan',
    { x: 200, y: 80 },
    {
      w: 480,
      title: 'Aggancio',
      icons: [
        { ...icon('Chair', 'chair', '#1C1C1E', P.chair), w: 44, h: 44 },
        icon('Light', 'cob', '#EDD963', P.light),
        icon('Stand', 'cstand', '#1C1C1E', P.stand),
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
  return { project, planId: plan.id, saved };
}

const pointOf = async (stage: Locator, [x, y]: readonly number[]) => {
  const box = (await stage.boundingBox())!;
  return {
    x: box.x + ((x as number) / 1000) * box.width,
    y: box.y + ((y as number) / (1000 / 1.5)) * box.height,
  };
};

test('icons snap together: seats, modifiers, stands; the base carries them; Alt drops free', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { planId, saved } = await seed(page, baseURL!);
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  const library = editor.getByRole('complementary', { name: 'Icone da set' });
  const rail = library.getByRole('navigation', { name: 'Categorie di icone' });
  const find = async (kind: PlanIcon['kind']) =>
    ((await saved()).icons ?? []).filter((i) => i.kind === kind);
  /** A tile dragged onto the plan; the target lights up before the release. */
  const dropTile = async (name: string, at: readonly number[], lit = true) => {
    const tile = library.getByRole('button', { name, exact: true }).first();
    const t = (await tile.boundingBox())!;
    const to = await pointOf(stage, at);
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(editor.locator('.plan-editor__target')).toHaveCount(lit ? 1 : 0);
    await page.mouse.up();
  };
  const drag = async (from: readonly number[], to: readonly number[], lit?: boolean) => {
    const a = await pointOf(stage, from);
    const b = await pointOf(stage, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    if (lit !== undefined)
      await expect(editor.locator('.plan-editor__target')).toHaveCount(lit ? 1 : 0);
    await page.mouse.up();
  };

  // A person dropped on the chair sits on it.
  await rail.getByRole('button', { name: 'Persone', exact: true }).click();
  await dropTile('Protagonista', P.chair);
  await expect
    .poll(async () => {
      const a = (await find('actor'))[0];
      return [a?.on, a?.pose];
    })
    .toEqual(['iconChairAAAA', 'seated']);

  // Two modifiers on the light: both attached, both drawn.
  await rail.getByRole('button', { name: 'Modificatori e grip', exact: true }).click();
  await dropTile('Softbox', P.light);
  await dropTile('Griglia', P.light);
  await expect
    .poll(async () => [...(await find('softbox')), ...(await find('grid'))].map((i) => i.on))
    .toEqual(['iconLightAAAA', 'iconLightAAAA']);
  await page.screenshot({ path: join(out, 'snap-1280-modifiers.png') });

  // The light is now project kit: placed from it, its modifiers come attached, one undo step.
  await rail.getByRole('button', { name: 'Preferiti e recenti', exact: true }).click();
  await library.locator('.plan-lib__item', { hasText: 'LED COB' }).first().click();
  await expect.poll(async () => (await find('cob')).length).toBe(2);
  const copy = (await find('cob')).find((i) => i.id !== 'iconLightAAAA') as PlanIcon;
  await expect
    .poll(async () => [...(await find('softbox')), ...(await find('grid'))].map((i) => i.on))
    .toEqual(['iconLightAAAA', copy.id, 'iconLightAAAA', copy.id]);
  await editor.getByRole('tab', { name: 'Proprietà' }).click();
  await expect(editor.getByRole('tabpanel', { name: 'Proprietà' })).toContainText('LED COB');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await find('cob')).length).toBe(1);
  await expect.poll(async () => (await find('softbox')).length).toBe(1);

  // The light dragged onto the stand stands on it; moving the stand carries light and modifiers.
  await drag(P.light, P.stand, true);
  await expect.poll(async () => (await find('cob'))[0]?.on).toBe('iconStandAAAA');
  // A base covered by what is on it is picked in Elements; moving it carries the rest along.
  const elements = editor.getByRole('tabpanel', { name: 'Elementi' });
  const pick = async (name: string) => {
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    await elements.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  };
  const before = (await find('softbox'))[0]?.x ?? 0;
  await pick('C-stand');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await find('softbox'))[0]?.x ?? 0).toBeLessThan(before);
  expect((await find('cob'))[0]?.on).toBe('iconStandAAAA');

  // Turning the stand by its handle turns the light and its modifiers with it.
  const turnedBefore = (await find('softbox'))[0]?.rotation ?? 0;
  const handle = editor.locator('[data-rotate]').first();
  const h = (await handle.boundingBox())!;
  const stand = (await find('cstand'))[0] as PlanIcon;
  const middle = await pointOf(stage, [
    (stand.x / STROKE_GRID) * 1000,
    (stand.y / STROKE_GRID) * (1000 / 1.5),
  ]);
  const r = Math.hypot(h.x + h.width / 2 - middle.x, h.y + h.height / 2 - middle.y);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + r, middle.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await find('softbox'))[0]?.rotation ?? 0).not.toBe(turnedBefore);
  expect((await find('softbox'))[0]?.on).toBe('iconLightAAAA');
  expect((await find('cob'))[0]?.on).toBe('iconStandAAAA');

  // The chair carries its person; pulling the person away detaches it.
  const seated = (await find('actor'))[0]?.y ?? 0;
  await pick('Sedia');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await find('actor'))[0]?.y ?? 0).toBeGreaterThan(seated);
  expect((await find('actor'))[0]?.on).toBe('iconChairAAAA');
  const chair = (await find('chair'))[0] as PlanIcon;
  const at = [(chair.x / STROKE_GRID) * 1000, (chair.y / STROKE_GRID) * (1000 / 1.5)];
  await drag(at, [520, 560]);
  await expect.poll(async () => (await find('actor'))[0]?.on).toBeUndefined();

  // Alt while dropping places free, even on the chair.
  await rail.getByRole('button', { name: 'Persone', exact: true }).click();
  await page.keyboard.down('Alt');
  await dropTile('Comparsa', at, false);
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await find('extra')).length).toBe(1);
  expect((await find('extra'))[0]?.on).toBeUndefined();
  await page.screenshot({ path: join(out, 'snap-1280-free.png') });
});

test('on a phone the Snap toggle takes the place of Alt', async ({ page, baseURL, browser }) => {
  test.setTimeout(90_000);
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
    const toggle = full.getByRole('button', { name: 'Aggancia le icone' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await m.screenshot({ path: join(out, 'snap-390-toggle.png') });
  } finally {
    await phone.close();
  }
});
