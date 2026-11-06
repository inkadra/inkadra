// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// QA 2026-11-02 round 2: the guest's card list reads in storyboard order. Set E2E_SHOTS to a
// folder to also capture the open list on a desktop and on a phone, light and dark.
import { addFrame, addScene } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null } as const;

async function shoot(page: Page, name: string) {
  if (!shots) return;
  // The guest page has no theme switch: it follows the browser's.
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
}

test('the card list of a guest follows the storyboard, not the order the cards came in', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `Ordine ${Date.now()}`, type: 'short_film' }),
  });
  const project = (await created.json()) as { id: string; rootBoardId: string };

  // Scenes 2, 8 and 13 in that order; their shots are added the other way round.
  const doc = createBoardDoc(project.rootBoardId);
  const s2 = addScene(doc, { number: '2', title: 'Ponte' }, opts);
  const s8 = addScene(doc, { number: '8', title: 'Stazione' }, opts);
  const s13 = addScene(doc, { number: '13', title: 'Binario' }, opts);
  addFrame(doc, s8.id, null, { action: 'Il treno' }, opts);
  addFrame(doc, s13.id, null, { action: 'Una corsa' }, opts);
  addFrame(doc, s2.id, null, { action: 'Il fiume' }, opts);
  addFrame(doc, s13.id, null, { action: 'Il fischio' }, opts);
  addFrame(doc, s2.id, null, { action: 'La riva' }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);

  const link = await fetch(`${base}/api/v1/boards/${project.rootBoardId}/share-links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'guest_approve', label: 'Regia' }),
  });
  expect(link.ok).toBe(true);
  const { url } = (await link.json()) as { url: string };

  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(guest.locator('[data-el]').first()).toBeVisible({ timeout: 20_000 });
  await guest.getByLabel('Card', { exact: true }).click();
  const list = guest.getByRole('listbox');
  await expect(list.getByRole('option').nth(1)).toBeVisible();
  expect(await list.getByRole('option').allTextContents()).toEqual([
    'Tutta la board',
    '2A',
    '2B',
    '8A',
    '13A',
    '13B',
  ]);
  await shoot(guest, 'guest-cards-desktop');
  await guest.keyboard.press('Escape');
  await guest.setViewportSize({ width: 390, height: 844 });
  // On a phone the link opens the review one shot at a time (#110): its Card list jumps to any
  // shot, in the same storyboard order.
  await expect(guest.getByRole('region', { name: 'Revisione' })).toBeVisible();
  await guest.getByLabel('Card', { exact: true }).scrollIntoViewIfNeeded();
  await guest.getByLabel('Card', { exact: true }).click();
  const shotList = guest.getByRole('listbox');
  await expect(shotList.getByRole('option').nth(1)).toBeVisible();
  expect(
    (await shotList.getByRole('option').allTextContents()).map((t) => t.match(/^\d+[A-Z]/)?.[0]),
  ).toEqual(['2A', '2B', '8A', '13A', '13B']);
  await shoot(guest, 'guest-cards-phone');
  await shotList.getByRole('option').nth(3).click();
  await expect(guest.getByText('4 di 5')).toBeVisible();
  await context.close();
});
