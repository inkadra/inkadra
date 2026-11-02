// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

test('a guest opens an Office file in the thumbnail and download viewer, never the account one', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL as string;
  const cookie = await signIn(base, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  await page.goto('/');
  const headers = { origin: base };
  const created = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Office per gli ospiti' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const id = await uploadFile(base, cookie, project.id, {
    body: Buffer.from('Voce,Totale\r\nLuci,1080.5\r\n'),
    name: 'budget-riprese.csv',
    type: 'text/csv',
  });
  expect(id).toBeTruthy();
  await waitForAssets(base, cookie, [id as string]);
  // The team's viewer does show the grid: the manifest exists for the owner.
  expect((await page.request.get(`/api/v1/assets/${id}/office/manifest.json`)).ok()).toBe(true);
  const doc = createBoardDoc(project.rootBoardId);
  const file = createElement(
    doc,
    'file',
    { x: 80, y: 80 },
    { assetId: id as string, w: 250 },
    { userId: null },
  );
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  const link = await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
    headers,
    data: { role: 'guest_view', allowDownload: true, label: 'Cliente' },
  });
  expect(link.ok()).toBe(true);
  const { url } = await link.json();

  const guest = await browser.newContext({ locale: 'it-IT' });
  const guestPage = await guest.newPage();
  const accountCalls: string[] = [];
  guestPage.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/v1/assets/') || path.startsWith('/collab')) accountCalls.push(path);
  });
  await guestPage.goto(url);
  const card = guestPage.locator(`[data-el="${file.id}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.dblclick();
  const viewer = guestPage.getByRole('dialog', { name: 'budget-riprese.csv' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Scarica' })).toHaveAttribute(
    'href',
    /\/api\/v1\/guest\/links\//,
  );
  // No grid, no account derivatives, no Office viewer: guests keep the existing flow.
  await expect(guestPage.locator('.viewer--office, .office-sheet')).toHaveCount(0);
  expect(accountCalls).toEqual([]);
  await guest.close();
});
