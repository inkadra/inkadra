// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Locator, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// A frame with "changes requested" and open comments: its review badges stay inside the shot
// list cell, the kanban card and the storyboard tile, even in French, the longest status name.
// Runs after first-run.spec.ts: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.BADGE_SHOTS;
let url = '';
let cookie = '';

async function setLocale(base: string, locale: string) {
  const res = await fetch(`${base}/api/v1/me`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) throw new Error(`locale: ${res.status}`);
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  cookie = await signIn(base, admin);
  const send = async <T>(method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  await setLocale(base, 'fr');
  const project = await send<{ id: string; rootBoardId: string }>('POST', '/projects', {
    name: 'Badge fit',
  });
  const board = await send<{ id: string }>('POST', `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Storyboard',
  });
  const doc = new Y.Doc();
  initBoardDoc(doc, board.id);
  const scene = addScene(doc, { number: '2', title: 'Diner' }, { userId: null });
  const frame = addFrame(doc, scene.id, null, { shot: 'ws' }, { userId: null });
  await pushBoardDoc(base, cookie, board.id, doc);
  await send('PUT', `/boards/${board.id}/elements/${frame.id}/review`, {
    status: 'changes_requested',
  });
  for (const body of ['Rosa turns to the counter?', 'And the neon cup?'])
    await send('POST', `/boards/${board.id}/comments`, { elementId: frame.id, body });
  url = `/p/${project.id}/b/${board.id}`;
});

test.afterAll(async ({ baseURL }) => {
  await setLocale(baseURL as string, 'it');
});

async function open(page: Page, base: string, theme: string, width: number, view = '') {
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  await page.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${url}${view}`);
}

/** Both badges are shown and sit inside the box that holds them. */
async function expectInside(holder: Locator, name: string) {
  const badges = holder.locator('.card-review');
  await expect(badges.getByRole('button', { name: /Modifications demandées/ })).toBeVisible();
  await expect(badges.getByRole('button', { name: /^2 discussions/ })).toBeVisible();
  const outer = await holder.boundingBox();
  const inner = await badges.boundingBox();
  if (!outer || !inner) throw new Error(`${name}: no box`);
  expect.soft(inner.x, `${name}: left edge`).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect
    .soft(inner.x + inner.width, `${name}: right edge`)
    .toBeLessThanOrEqual(outer.x + outer.width + 0.5);
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.mouse.move(1, 1);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

for (const theme of shots ? ['light', 'dark'] : ['dark'])
  test(`review badges stay inside the shot list, kanban and storyboard (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL as string, theme, 1280, '?view=shotlist');
    await expectInside(page.locator('td.shots__pic-col'), 'shot list cell');
    await shoot(page, `${theme}-1280-table`);
    await page.getByRole('tab', { name: 'Kanban' }).click();
    await expectInside(page.locator('.kanban__card'), 'kanban card');
    await shoot(page, `${theme}-1280-kanban`);
    await page.goto(url);
    await expectInside(page.locator('.story__tile'), 'storyboard tile');
    await shoot(page, `${theme}-1280-storyboard`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}?view=shotlist`);
    await expectInside(page.locator('.shot-card'), 'phone shot card');
    await shoot(page, `${theme}-390-shotlist`);
    await page.goto(url);
    await expectInside(page.locator('.story__tile'), 'phone storyboard tile');
    await shoot(page, `${theme}-390-storyboard`);
  });
