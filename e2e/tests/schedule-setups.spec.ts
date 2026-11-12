// SPDX-License-Identifier: AGPL-3.0-only
// The schedule groups shots by setup (decision 0115): the choice is this person's, kept in the
// account's preferences on the server, and the shot list groups the same way. Runs after
// first-run.spec.ts in CI; alone, it signs up.
import { addFrame, createElement } from '@inkadra/canvas-core';
import { createBoardDoc, type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { addProduction, addStoryboard } from '../helpers/views.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };

test.use({ locale: 'it-IT' });
// The grouping is the account's: leave the default to the next tests, even after a failure.
test.afterEach(async ({ page, baseURL }) => {
  await page.request.patch('/api/v1/me/preferences', {
    headers: { origin: baseURL! },
    data: { shotGroupBy: 'scene' },
  });
});

test('the schedule groups by setup, saved on the account and shared with the shot list', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const cookie = await signIn(baseURL!, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
    }),
  );
  await page.goto('/');
  const headers = { origin: baseURL! };
  // Start from the default, whatever an earlier test chose.
  await page.request.patch('/api/v1/me/preferences', { headers, data: { shotGroupBy: 'scene' } });
  const created = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Raggruppa per setup' },
  });
  const project = await created.json();
  // Scenes, frames and plans live on a storyboard, whose views show them (decision 0121).
  const root = (await addStoryboard(page.request, baseURL!, project, ['shotlist'])).id;
  // Its frames are scheduled on the Production board (decision 0123).
  const production = await addProduction(page.request, baseURL!, project);
  const doc = createBoardDoc(root);
  const scene = createElement(
    doc,
    'scene',
    { x: 60, y: 640 },
    { number: '4', title: 'Il bancone', setting: 'int', time: 'night' },
    opts,
  );
  const wide = addFrame(doc, scene.id, null, { action: 'Totale del bancone' }, opts);
  const close = addFrame(doc, scene.id, null, { action: 'Primo piano di Rosa' }, opts);
  addFrame(doc, scene.id, null, { action: 'Insegna' }, opts);
  const camera = (id: string, frameId: string): PlanIcon => ({
    id: id.padEnd(13, 'A'),
    kind: 'camera',
    color: '#9DB8F2',
    x: Math.round(0.5 * STROKE_GRID),
    y: Math.round(0.8 * STROKE_GRID),
    frameId,
  });
  const plan = createElement(
    doc,
    'plan',
    { x: 60, y: 120 },
    { w: 400, title: 'Bancone', icons: [camera('camA', wide.id)] },
    opts,
  );
  createElement(
    doc,
    'plan',
    { x: 560, y: 120 },
    { w: 300, variantOf: plan.id, variant: 'Primo piano', icons: [camera('camB', close.id)] },
    opts,
  );
  await pushBoardDoc(baseURL!, cookie, root, doc);

  await page.goto(`/p/${project.id}/b/${production.id}`);
  await page.getByRole('tab', { name: 'Piano riprese', exact: true }).click();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  const queue = schedule.locator('.schedule__queue');
  const group = queue.getByRole('combobox', { name: 'Raggruppa per' });
  await expect(group).toContainText('Scena');
  await group.click();
  await page.getByRole('option', { name: 'Raggruppa per: Setup' }).click();
  const setups = queue.locator('.schedule__setup-title');
  await expect(setups).toHaveText(['1 · Base', '2 · Primo piano', 'Senza setup']);
  await expect(queue.locator('.schedule__setup').nth(1)).toContainText('Primo piano di Rosa');
  // Saved on the account, not in the browser.
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/me/preferences')).json()).shotGroupBy)
    .toBe('setup');

  await page.evaluate(() => localStorage.removeItem('inkadra.preferences'));
  await page.reload();
  await page.getByRole('tab', { name: 'Piano riprese', exact: true }).click();
  await expect(setups).toHaveText(['1 · Base', '2 · Primo piano', 'Senza setup']);
  // The storyboard's shot list groups the same way.
  await page.goto(`/p/${project.id}/b/${root}?view=shotlist`);
  await expect(page.getByRole('combobox', { name: 'Raggruppa per' })).toContainText(
    'Raggruppa per: Setup',
  );
});
