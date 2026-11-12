// SPDX-License-Identifier: AGPL-3.0-only
// The last parity pass of the set plan (decision 0119): the zoom reads 100 % on the plan fitted;
// a room with a scale shows its size outside its walls in the editor and on the board card; a
// counter counts its stools; the sun's date offers the shooting days of the plan's scene and
// north reads "Up, 0°"; the editor's personal choices live in the account and survive a reload;
// a phone fits the room by its width. Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFrame, createElement, toWallPoints } from '@inkadra/canvas-core';
import {
  createBoardDoc,
  type Element,
  type PlanIcon,
  readElement,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
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
const INK = '#1C1C1E';

/** A plan of an 8 × 6.3 m room at 70 units a metre: a counter with four stools, a sun. */
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
  const headers = { origin: baseURL };
  const project = await (
    await page.request.post('/api/v1/projects', { headers, data: { name: 'Pianta · finale' } })
  ).json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const opts = { userId: null };
  const scene = createElement(
    doc,
    'scene',
    { x: 80, y: 700 },
    { number: '2', title: "L'ultima ordinazione", setting: 'ext', time: 'day' },
    opts,
  );
  const frame = addFrame(doc, scene.id, null, { action: 'Campo largo', lens: '32mm' }, opts);
  const icon = (id: string, kind: PlanIcon['kind'], x: number, y: number, extra = {}) =>
    ({ id: `icon${id}`.padEnd(13, 'A'), kind, color: INK, x: gx(x), y: gy(y), ...extra }) as PlanIcon;
  const plan = createElement(
    doc,
    'plan',
    { x: 80, y: 80 },
    {
      w: 480,
      title: 'Da Rosa',
      sceneIds: [scene.id],
      scale: 70,
      grid: '0.5',
      walls: [
        {
          id: 'wallRoomAAAAA',
          points: toWallPoints([
            { x: 220, y: 110 },
            { x: 780, y: 110 },
            { x: 780, y: 551 },
            { x: 220, y: 551 },
          ]),
          thickness: 9,
          closed: true,
        },
      ],
      icons: [
        icon('Counter', 'counter', 500, 250, { w: 320, h: 56 }),
        ...[380, 460, 540, 620].map((x, i) => icon(`Stool${i}`, 'stool', x, 304)),
        icon('Sun', 'sun', 700, 450, { color: '#EDD963', label: 'Sole' }),
      ],
    } as never,
    opts,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  // Three shooting days; the third shoots the scene's shot.
  for (const [date, shot] of [
    ['2026-03-12', null],
    ['2026-03-13', null],
    ['2026-03-14', frame.id],
  ] as const) {
    const day = await page.request.post(`/api/v1/boards/${root}/schedule`, {
      headers,
      data: {
        date,
        callTime: '08:00',
        wrap: null,
        location: 'Da Rosa',
        notes: '',
        blocks: shot
          ? [
              {
                id: crypto.randomUUID(),
                type: 'shot',
                title: '2A',
                start: null,
                duration: 60,
                shotId: shot,
                cast: [],
                departments: [],
              },
            ]
          : [],
      },
    });
    expect(day.status()).toBe(201);
  }
  const saved = async () => {
    const stored = await readBoard(baseURL, cookie, root);
    return [...roots(stored).elements.values()]
      .map((m) => readElement(m))
      .find((e): e is Plan => e?.id === plan.id) as Plan;
  };
  return { project, planId: plan.id, saved };
}

test('the plan opens at 100 % with its room sizes, stools counted, the sun on a shooting day, choices kept', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project, planId, saved } = await seed(page, baseURL!);
  const prefs = async () =>
    (await (await page.request.get('/api/v1/me/preferences')).json()) as Record<string, unknown>;
  try {
    await page.goto(`/p/${project.id}?view=canvas`);
    const card = page.locator(`[data-el="${planId}"]`);
    // The card draws the room's size, as the mockup's drawing does.
    await expect(card.locator('[data-room-dims] text')).toHaveText(['8,0 m', '6,3 m']);
    await card.dblclick();
    const editor = page.getByRole('dialog', { name: /Pianta del set/ });
    const percent = editor.locator('.plan-canvas__percent');
    const elements = editor.getByRole('tabpanel', { name: 'Elementi' });
    const props = editor.getByRole('tabpanel', { name: 'Proprietà' });

    // Fitted is 100 %; a step in is 150 %; 0 fits again.
    await expect(percent).toHaveText('100%');
    await expect(editor.locator('[data-room-dims] text')).toHaveText(['8,0 m', '6,3 m']);
    await editor.getByRole('button', { name: 'Ingrandisci' }).click();
    await expect(percent).toHaveText('150%');
    await page.keyboard.press('0');
    await expect(percent).toHaveText('100%');

    const pick = async (name: RegExp) => {
      await editor.getByRole('tab', { name: 'Elementi' }).click();
      const closed = elements.locator('.plan-elements__toggle[aria-expanded="false"]');
      if (await closed.count()) await closed.click();
      await elements.getByRole('button', { name }).first().click();
      await editor.getByRole('tab', { name: 'Proprietà' }).click();
    };
    // A counter names its seats by their kind.
    await pick(/^Bancone/);
    await expect(props).toContainText('4 sgabelli');

    // The sun's date: the shooting days of the plan's scene, as the schedule numbers them.
    await pick(/^Sole/);
    await expect(props.getByLabel('Il nord è')).toHaveValue('0');
    await expect(props.locator('.plan-num__lead')).toHaveText('In alto,');
    await props.getByRole('combobox', { name: 'Data' }).click();
    await page.getByRole('option', { name: /Giorno 3 delle riprese/ }).click();
    await expect.poll(async () => (await saved()).sun?.date).toBe('2026-03-14');
    await page.screenshot({ path: join(out, 'final-1280-sun.png') });

    // Personal choices live in the account: snap to the grid off (G), Lights hidden for me.
    const area = (await editor.locator('.plan-main__canvas').boundingBox())!;
    await page.mouse.click(area.x + 12, area.y + area.height - 12);
    await page.keyboard.press('g');
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    await elements.getByRole('button', { name: 'Nascondi Luci' }).click();
    await expect
      .poll(async () => {
        const p = await prefs();
        return [p.planSnap, p.planHidden];
      })
      .toEqual([false, ['lights']]);
    await page.reload();
    await page.locator(`[data-el="${planId}"]`).dblclick();
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    await expect(elements.getByRole('button', { name: 'Mostra Luci' })).toBeVisible();

    // A phone fits the room by its width.
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
      const walls = (await full.locator('.plan__walls').boundingBox())!;
      // The walls span the width but for the margins (24 px a side).
      expect(walls.width).toBeGreaterThan(390 - 2 * 24 - 8);
      expect(walls.x).toBeGreaterThanOrEqual(0);
      await m.screenshot({ path: join(out, 'final-390-room.png') });
    } finally {
      await phone.close();
    }
  } finally {
    // The account is shared with the specs after this one: its choices go back to the defaults.
    await page.request.patch('/api/v1/me/preferences', {
      headers: { origin: baseURL! },
      data: { planSnap: true, planAttach: true, planGhosts: true, planHidden: [], planShelf: 'lights' },
    });
  }
});
