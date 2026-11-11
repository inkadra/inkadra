// SPDX-License-Identifier: AGPL-3.0-only
// Parity with the approved mockup (decision 0110): an item locked on its own cannot be moved,
// edited or deleted until it is unlocked; the project kit lists a light set up on another board
// of the project, and a guest of one board does not see the kit of a board they cannot open.
// Runs after first-run.spec.ts in CI; alone, it signs up.
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
import { type Browser, expect, type Page, test } from '@playwright/test';
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
const CHAIR = [400, 300] as const;
const icon = (id: string, kind: PlanIcon['kind'], [x, y]: readonly number[], extra = {}) => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: gx(x as number),
  y: gy(y as number),
  ...extra,
});

/** A project: a plan with a chair on the root board, a light set up on each of two sub-boards. */
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
    await page.request.post('/api/v1/projects', { headers, data: { name: 'Pianta · parità' } })
  ).json();
  const root = project.rootBoardId as string;
  const board = async (title: string) =>
    (
      await (
        await page.request.post(`/api/v1/projects/${project.id}/boards`, {
          headers,
          data: { parentBoardId: root, title },
        })
      ).json()
    ).id as string;
  const plan = async (boardId: string, title: string, icons: object[]) => {
    const doc = createBoardDoc(boardId);
    const el = createElement(
      doc,
      'plan',
      { x: 200, y: 80 },
      { w: 480, title, icons: icons as PlanIcon[] },
      { userId: null },
    );
    await pushBoardDoc(baseURL, cookie, boardId, doc);
    return el.id;
  };
  const lockPlan = await plan(root, 'Blocco', [
    { ...icon('Chair', 'chair', CHAIR), color: '#1C1C1E', w: 60, h: 60, label: 'Sedia Rosa' },
  ]);
  const guestBoard = await board('Set ospite');
  const otherBoard = await board('Set chiuso');
  const guestPlan = await plan(guestBoard, 'Ospite', [
    icon('Mine', 'fresnel', [300, 300], { make: 'Luce ospite', watts: 650 }),
  ]);
  const key = icon('Key', 'cob', [500, 300], { make: 'Aputure 600d', watts: 600 });
  await plan(otherBoard, 'Altro set', [
    key,
    icon('Grid', 'grid', [520, 300], { color: '#1C1C1E', on: key.id }),
  ]);
  // The other boards' plans are read through the board index, written a moment after an edit.
  await expect
    .poll(
      async () =>
        JSON.stringify(
          await (
            await page.request.get(`/api/v1/projects/${project.id}/plan-kit?excludeBoardId=${root}`)
          ).json(),
        ),
      { timeout: 20_000 },
    )
    .toContain('Aputure 600d');
  const saved = async () => {
    const stored = await readBoard(baseURL, cookie, root);
    return [...roots(stored).elements.values()]
      .map((m) => readElement(m))
      .find((e): e is Plan => e?.id === lockPlan) as Plan;
  };
  return { project, root, lockPlan, guestBoard, guestPlan, saved };
}

/** The page in both themes, light then dark (the theme is the app's, not the system's). */
async function shoot(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    // Colours ease into the new theme.
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
  }
}

async function signUpGuest(browser: Browser, url: string) {
  const context = await browser.newContext({ locale: 'it-IT' });
  const guest = await context.newPage();
  await guest.goto(url);
  await guest.getByLabel('Nome').fill('Pietro Ospite');
  await guest.getByLabel('Email').fill(`pietro-${Date.now()}@example.com`);
  await guest.getByLabel('Password').fill('fourth-horse-battery');
  await guest.getByRole('button', { name: 'Crea account' }).click();
  // Signed in: the app's navigation shows before the board is opened.
  await expect(guest.getByRole('complementary', { name: 'Navigazione' })).toBeVisible();
  return guest;
}

test('an item locked on its own is not moved, edited or deleted until it is unlocked', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project, lockPlan, saved } = await seed(page, baseURL!);
  await page.goto(`/p/${project.id}?view=canvas`);
  await page.locator(`[data-el="${lockPlan}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const stage = editor.locator('.plan-editor__stage');
  const props = editor.getByRole('tabpanel', { name: 'Proprietà' });
  const chair = async () => (await saved()).icons?.find((i) => i.kind === 'chair') as PlanIcon;
  const box = (await stage.boundingBox())!;
  const at = (x: number, y: number) => ({
    x: box.x + (x / 1000) * box.width,
    y: box.y + (y / (1000 / 1.5)) * box.height,
  });
  const drag = async (from: readonly number[], to: readonly number[]) => {
    const a = at(from[0] as number, from[1] as number);
    const b = at(to[0] as number, to[1] as number);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
  };

  // Picked and locked from Properties.
  const start = at(CHAIR[0], CHAIR[1]);
  await page.mouse.click(start.x, start.y);
  await expect(props.getByRole('textbox', { name: 'Nome' })).toHaveValue('Sedia Rosa');
  await props.getByRole('button', { name: 'Blocca', exact: true }).click();
  await expect.poll(async () => (await chair()).locked).toBe(true);
  const locked = await chair();
  await expect(props.getByRole('status').getByText(/Bloccato/)).toBeVisible();
  await expect(props.getByRole('textbox', { name: 'Nome' })).toBeDisabled();
  await expect(props.getByRole('button', { name: 'Elimina' })).toBeDisabled();
  await shoot(page, 'parity-1280-locked');

  // Dragged, nudged, turned and deleted: it stays as it was.
  await drag(CHAIR, [700, 450]);
  await page.mouse.click(start.x, start.y);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('r');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(1500);
  expect(await chair()).toEqual(locked);

  // Elements shows the lock on the item.
  await editor.getByRole('tab', { name: 'Elementi' }).click();
  const elements = editor.getByRole('tabpanel', { name: 'Elementi' });
  await expect(elements.getByRole('button', { name: /Sedia Rosa.*Bloccato/ })).toBeVisible();
  await shoot(page, 'parity-1280-elements');

  // Unlocked, it moves again.
  await elements.getByRole('button', { name: /Sedia Rosa/ }).click();
  await editor.getByRole('tab', { name: 'Proprietà' }).click();
  await props.getByRole('button', { name: 'Sblocca', exact: true }).click();
  await expect.poll(async () => (await chair()).locked).toBeUndefined();
  await drag(CHAIR, [700, 450]);
  await expect.poll(async () => (await chair()).x).toBeGreaterThan(locked.x);
});

test('the project kit shows the lights of other boards, and a guest only those they can open', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(150_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { project, lockPlan, guestBoard, guestPlan } = await seed(page, baseURL!);
  const kitOf = async (p: Page) => {
    const editor = p.getByRole('dialog', { name: /Pianta del set/ });
    const library = editor.getByRole('complementary', { name: 'Icone da set' });
    await library
      .getByRole('navigation', { name: 'Categorie di icone' })
      .getByRole('button', { name: 'Preferiti e recenti', exact: true })
      .click();
    await expect(library.getByTestId('plan-kit-scope')).toHaveCount(0);
    return library;
  };

  // The owner, on the root board, sees the light of a sub-board with its modifier.
  await page.goto(`/p/${project.id}?view=canvas`);
  await page.locator(`[data-el="${lockPlan}"]`).dblclick();
  const library = await kitOf(page);
  await expect(library.getByRole('button', { name: /Aputure 600d/ })).toContainText('Griglia');
  await expect(library.getByRole('button', { name: /Luce ospite/ })).toBeVisible();
  await shoot(page, 'parity-1280-project-kit');

  // A guest of one sub-board sees its own light, not the one of a board they cannot open.
  const invited = await page.request.post('/api/v1/invitations', {
    headers: { origin: baseURL! },
    data: { kind: 'link', boardId: guestBoard, role: 'editor' },
  });
  expect(invited.status()).toBe(201);
  const guest = await signUpGuest(browser, (await invited.json()).invitation.url);
  try {
    await guest.goto(`/p/${project.id}/b/${guestBoard}?view=canvas`);
    await guest.locator(`[data-el="${guestPlan}"]`).dblclick();
    const theirs = await kitOf(guest);
    await expect(theirs.getByRole('button', { name: /Luce ospite/ })).toBeVisible();
    await expect(theirs.getByRole('button', { name: /Aputure 600d/ })).toHaveCount(0);
    const asked = await guest.request.get(`/api/v1/projects/${project.id}/plan-kit`);
    expect(JSON.stringify(await asked.json())).not.toContain('Aputure 600d');
  } finally {
    await guest.context().close();
  }
});
