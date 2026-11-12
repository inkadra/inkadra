// SPDX-License-Identifier: AGPL-3.0-only
// The watts of a set plan's labels follow the app's language, not the browser's: with Inkadra in
// Italian and an English browser a 1200 W light reads "1,2K", on the board and in the editor.
// Runs after first-run.spec.ts in CI; alone, it signs up.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, STROKE_GRID } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out = process.env.SET_PLAN_SHOTS ?? join(tmpdir(), 'inkadra-set-plan');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** A plan with a 1200 W light, the account in Italian; gives the account's language back. */
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
  const me = await (await page.request.get('/api/v1/me')).json();
  const speak = async (locale: string | null) => {
    const r = await page.request.patch('/api/v1/me', {
      headers: { origin: baseURL },
      data: { locale },
    });
    expect(r.ok()).toBe(true);
  };
  await speak('it');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Pianta · watt' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const at = (v: number) => Math.round(v * STROKE_GRID);
  const plan = createElement(
    doc,
    'plan',
    { x: 80, y: 80 },
    {
      w: 480,
      title: 'Cucina',
      icons: [
        {
          id: 'iconKeyAAAAAA',
          kind: 'cob',
          color: '#EDD963',
          x: at(0.4),
          y: at(0.45),
          label: 'Key',
          watts: 1200,
        },
      ],
    },
    { userId: null },
  );
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { project, planId: plan.id, restore: () => speak(me.locale ?? null) };
}

test('a light reads its watts in the app language with an English browser', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(90_000);
  const { project, planId, restore } = await seed(page, baseURL!);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    reducedMotion: 'reduce',
    storageState: await page.context().storageState(),
  });
  try {
    const m = await context.newPage();
    await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
    const card = m.locator(`[data-el="${planId}"]`);
    await expect(card.locator('.plan__label').first()).toHaveText('Key · 1,2K');
    await card.dblclick();
    const editor = m.getByRole('dialog', { name: /Pianta del set/ });
    await expect(editor.locator('.plan__label').first()).toHaveText('Key · 1,2K');
  } finally {
    await context.close();
    await restore();
  }
});

// The screenshots of the pull request: light and dark, 1280 and 390, the editor open on the light.
// Only when SET_PLAN_SHOTS names a folder; CI checks the behaviour above.
test('screenshots of a light with its watts in Italian, English browser', async ({
  page,
  baseURL,
  browser,
}) => {
  test.skip(!process.env.SET_PLAN_SHOTS, 'screenshots only on request');
  test.setTimeout(180_000);
  mkdirSync(out, { recursive: true });
  const { project, planId, restore } = await seed(page, baseURL!);
  const state = await page.context().storageState();
  try {
    for (const theme of ['light', 'dark'] as const)
      for (const width of [1280, 390]) {
        const phone = width < 600;
        const ctx = await browser.newContext({
          viewport: { width, height: phone ? 844 : 800 },
          hasTouch: phone,
          isMobile: phone,
          locale: 'en-US',
          colorScheme: theme,
          reducedMotion: 'reduce',
          storageState: state,
        });
        await ctx.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
        try {
          const m = await ctx.newPage();
          await m.goto(`${baseURL}/p/${project.id}?view=canvas`);
          await m.getByRole('button', { name: 'Adatta alla vista' }).click();
          const card = m.locator(`[data-el="${planId}"]`);
          await expect(card.locator('.plan__label').first()).toHaveText('Key · 1,2K');
          await m.mouse.move(0, 0);
          await m.screenshot({ path: join(out, `watts-${theme}-${width}-board.png`) });
          await card.dblclick();
          const editor = m.getByRole('dialog', { name: /Pianta del set/ });
          await expect(editor.locator('.plan__label').first()).toHaveText('Key · 1,2K');
          await m.mouse.move(0, 0);
          await m.screenshot({ path: join(out, `watts-${theme}-${width}-editor.png`) });
        } finally {
          await ctx.close();
        }
      }
  } finally {
    await restore();
  }
});
