// SPDX-License-Identifier: AGPL-3.0-only
// Links of the set plan to the cards of the project (decision 0104): an actor plays a character,
// a camera shoots a storyboard frame, the scene chip, the setup of each shot in the shot list.
// Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFrame, createElement, lensAngle } from '@inkadra/canvas-core';
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
const opts = { userId: null };
type Plan = Extract<Element, { type: 'plan' }>;
const at = (id: string, kind: PlanIcon['kind'], x: number, y: number, label: string) => ({
  id: `icon${id}`.padEnd(13, 'A'),
  kind,
  color: '#9DB8F2',
  x: Math.round(x * STROKE_GRID),
  y: Math.round(y * STROKE_GRID),
  label,
});

async function seed(page: Page, baseURL: string) {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Cortometraggio · collegamenti della pianta' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const scene = createElement(
    doc,
    'scene',
    { x: 60, y: 620 },
    { number: '2', title: '', location: 'Tavola calda', setting: 'int', time: 'night' },
    opts,
  );
  const frame = addFrame(
    doc,
    scene.id,
    null,
    { action: 'Master', lens: '32mm', cast: ['Leo'] },
    opts,
  );
  const leo = createElement(
    doc,
    'character',
    { x: 640, y: 120 },
    { name: 'Leo', actor: 'Marco Rossi' },
    opts,
  );
  createElement(doc, 'character', { x: 640, y: 360 }, { name: 'Anna' }, opts);
  const plan = createElement(
    doc,
    'plan',
    { x: 60, y: 120 },
    {
      w: 480,
      title: 'Bancone',
      sceneIds: [scene.id],
      icons: [at('Actor', 'actor', 0.5, 0.5, 'Attore'), at('Cam', 'camera', 0.2, 0.7, 'A cam')],
    },
    opts,
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { cookie, project, root, planId: plan.id, leoId: leo.id, frameId: frame.id };
}

test('set plan links: character, frame, scene chip and the setup of a shot', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const { cookie, project, root, planId, leoId, frameId } = await seed(page, baseURL!);
  const saved = async () => {
    const doc = await readBoard(baseURL!, cookie, root);
    const plan = [...roots(doc).elements.values()]
      .map((m) => readElement(m))
      .find((e): e is Plan => e?.type === 'plan');
    return plan?.icons ?? [];
  };
  await page.goto(`/p/${project.id}/b/${root}?view=canvas`);
  const card = (id: string) => page.locator(`[data-el="${id}"]`);
  const editor = page.getByRole('dialog', { name: 'Pianta del set · Bancone' });
  const props = editor.getByRole('tabpanel', { name: 'Proprietà' });
  const pick = async (name: RegExp) => {
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    await editor.getByRole('tabpanel', { name: 'Elementi' }).getByRole('button', { name }).click();
    await editor.getByRole('tab', { name: 'Proprietà' }).click();
  };

  await test.step('the scene chip reads the scene card', async () => {
    await card(planId).dblclick();
    await expect(editor.getByRole('button', { name: 'Scena 2 · INT · Notte' })).toBeVisible();
  });

  await test.step('an actor plays a character: name and played by follow the card', async () => {
    await pick(/^Attore/);
    await props.getByRole('button', { name: 'Collega a un personaggio' }).click();
    const picker = page.getByRole('dialog', { name: 'Collega a un personaggio' });
    // The cast of the plan's scenes first.
    await expect(picker.locator('li').first()).toContainText('Proposti');
    await expect(picker.locator('li').first()).toContainText('Leo');
    await picker.getByRole('button', { name: /^Leo/ }).click();
    await expect(props.getByLabel('Nome', { exact: true })).toHaveValue('Leo');
    await expect(props).toContainText('Interpretato da Marco Rossi');
    await expect(editor.locator('.plan__svg text', { hasText: 'Leo' })).toBeVisible();
    await expect
      .poll(async () => (await saved()).find((i) => i.kind === 'actor')?.characterId)
      .toBe(leoId);
    await page.screenshot({ path: join(out, 'links-character.png') });
  });

  await test.step('a camera shoots a frame: it takes the lens, never writes it back', async () => {
    await pick(/^A cam/);
    await props.getByRole('button', { name: 'Collega a un’inquadratura' }).click();
    await page
      .getByRole('dialog', { name: 'Collega a un’inquadratura' })
      .getByRole('button', { name: /^2A/ })
      .click();
    await expect(props).toContainText('32 mm nell’inquadratura');
    // The angle of view of 32 mm on Super 35.
    await expect(props).toContainText(`${Math.round(lensAngle(32))}° orizz.`);
    const cam = (await saved()).find((i) => i.kind === 'camera');
    expect(cam?.frameId).toBe(frameId);
    expect(cam?.lens).toBeUndefined();
    await page.screenshot({ path: join(out, 'links-frame.png') });
    await editor.getByRole('button', { name: 'Fatto' }).click();
  });

  await test.step('renaming the character and the lens of the frame follow on the plan', async () => {
    await card(leoId).dblclick();
    await page.locator('.story-panel').getByLabel('Nome', { exact: true }).fill('Leonardo');
    await page.locator('.story-panel').getByLabel('Nome', { exact: true }).press('Enter');
    await page.mouse.click(1300, 860);
    await expect(card(planId).locator('.plan__svg text', { hasText: 'Leonardo' })).toBeVisible();
    await card(frameId).dblclick();
    await page.locator('.film-panel').getByLabel('Obiettivo', { exact: true }).fill('50mm');
    await page.locator('.film-panel').getByLabel('Obiettivo', { exact: true }).press('Enter');
    await page.mouse.click(1300, 860);
    await card(planId).dblclick();
    await pick(/^A cam/);
    await expect(props).toContainText('50 mm nell’inquadratura');
    await expect(props).toContainText(`${Math.round(lensAngle(50))}° orizz.`);
    await pick(/^Leonardo/);
    await expect(props.getByLabel('Nome', { exact: true })).toHaveValue('Leonardo');
  });

  await test.step('the scene chip opens the scene', async () => {
    await editor.getByRole('button', { name: 'Scena 2 · INT · Notte' }).click();
    await expect(page).toHaveURL(/view=storyboard/);
  });

  await test.step('the shot list shows the setup of the shot and groups by setup', async () => {
    await page.goto(`/p/${project.id}/b/${root}?view=shotlist`);
    const row = page.locator('tr', { hasText: 'Master' });
    await expect(row.locator('.plan-links__setup')).toHaveText('1 · Base');
    await page.getByRole('combobox', { name: 'Raggruppa per' }).click();
    await page.getByRole('option', { name: 'Raggruppa per: Setup' }).click();
    await expect(page.locator('.shots__scene', { hasText: 'Bancone · 1 · Base' })).toBeVisible();
    await page.screenshot({ path: join(out, 'links-shotlist.png') });
    // The grouping is the account's (decision 0115): back to the default for the next tests.
    await page.getByRole('combobox', { name: 'Raggruppa per' }).click();
    await page.getByRole('option', { name: 'Raggruppa per: Scena' }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/v1/me/preferences')).json()).shotGroupBy)
      .toBe('scene');
  });
});
