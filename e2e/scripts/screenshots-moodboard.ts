import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, updateElement } from '@inkadra/canvas-core';
import { readElement, roots } from '@inkadra/doc-schema';
import { type Browser, chromium, type Page } from '@playwright/test';
import { readBoard } from '../tests/frame-grab.helpers.ts';
import { pushBoardDoc } from '../tests/perf/seed.ts';
import { api, type SampleProject, seedSampleProject } from './sample-project.ts';

/**
 * Screenshots of the Moodboard view (#301): the sample project's moodboard with tagged
 * pictures, a link with a preview and a palette; a board with nothing to show; desktop and
 * phone, dark and light.
 *
 *   SHOTS_BASE_URL=http://localhost:3200 SHOTS_OUT=/tmp/moodboard SHOTS_TAG=after \
 *     pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-moodboard.ts
 *
 * Files are named moodboard-SCREEN-TAG-SIZE-THEME.png.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = process.env.SHOTS_OUT ?? join(process.cwd(), 'moodboard-shots');
const tag = process.env.SHOTS_TAG ?? 'after';
const origin = 'seed';

/** What the pictures of the sample are about, by still. */
const about: Record<string, { tags: string[]; caption?: string }> = {
  platform: { tags: ['luce', 'location'], caption: 'Platform 4, 2 a.m.' },
  diner: { tags: ['location', 'costumi'], caption: 'The diner, after closing' },
  rain: { tags: ['luce'], caption: 'Rain on the windows' },
  window: { tags: ['location'] },
  tunnel: { tags: ['location', 'luce'], caption: 'Tunnel, last train' },
  dawn: { tags: ['luce'], caption: 'Blue hour for the ending' },
  sea: { tags: ['palette'] },
  field: { tags: ['location'], caption: 'The field behind the station' },
};

async function enrich(sample: SampleProject) {
  const { cookie, project, asset } = sample;
  const names = new Map(Object.entries(asset).map(([name, id]) => [id, name]));
  const mood = await readBoard(base, cookie, project.rootBoardId);
  const els = [...roots(mood).elements.values()].map((m) => readElement(m)!);
  mood.transact(() => {
    for (const el of els) {
      if (el.type === 'image') {
        const info = about[names.get(el.assetId) ?? ''];
        if (info) updateElement(mood, el.id, { tags: info.tags, ...(info.caption && !el.caption ? { caption: info.caption } : {}) }, origin);
      }
      if (el.type === 'color') updateElement(mood, el.id, { tags: ['palette'] }, origin);
    }
    createElement(
      mood,
      'link',
      { x: 360, y: 900 },
      {
        url: 'https://vimeo.com/beyond-the-grid',
        title: 'Beyond the Grid',
        imageAssetId: asset.field as string,
        tags: ['luce'],
      },
      { userId: null },
    );
    for (const [hex, label] of [
      ['#C2593B', 'Brick'],
      ['#1E2A33', 'Night blue'],
    ] as const)
      createElement(mood, 'color', { x: 1600, y: 0 }, { hex, label, tags: ['palette'] }, { userId: null });
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, mood);
}

async function gallery(page: Page, project: SampleProject, boardId: string) {
  await page.goto(`/p/${project.project.id}/b/${boardId}?view=moodboard`);
  await page.getByRole('region', { name: 'Moodboard', exact: true }).waitFor({ timeout: 20_000 });
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, {
      timeout: 20_000,
    })
    .catch(() => {});
  await page.waitForTimeout(600);
}

async function main(browser: Browser) {
  mkdirSync(out, { recursive: true });
  const sample = await seedSampleProject(browser, base);
  await enrich(sample);
  // A board with no pictures, links or colors: the casting board holds some.
  const nothing = await api<{ id: string }>(base, sample.cookie, `/projects/${sample.project.id}/boards`, {
    parentBoardId: sample.project.rootBoardId,
    kind: 'board',
    title: 'Empty',
  });
  const shots: Array<{ id: string; width: number; height: number; phone: boolean; board: string; themes: Array<'dark' | 'light'>; after?: (page: Page) => Promise<void> }> = [
    { id: 'gallery', width: 1440, height: 900, phone: false, board: sample.project.rootBoardId, themes: ['dark', 'light'] },
    {
      id: 'hover',
      width: 1440,
      height: 900,
      phone: false,
      board: sample.project.rootBoardId,
      themes: ['dark'],
      after: async (page) => {
        await page.locator('.moodboard__card--image').nth(1).hover();
        await page.waitForTimeout(400);
      },
    },
    {
      id: 'add-menu',
      width: 1440,
      height: 900,
      phone: false,
      board: sample.project.rootBoardId,
      themes: ['dark'],
      after: async (page) => {
        await page.getByRole('button', { name: 'Aggiungi' }).click();
        await page.waitForTimeout(300);
      },
    },
    { id: 'gallery', width: 390, height: 844, phone: true, board: sample.project.rootBoardId, themes: ['dark', 'light'] },
    { id: 'empty', width: 1440, height: 900, phone: false, board: nothing.id, themes: ['dark', 'light'] },
    { id: 'empty', width: 390, height: 844, phone: true, board: nothing.id, themes: ['dark'] },
  ];
  for (const shot of shots)
    for (const theme of shot.themes) {
      const context = await browser.newContext({
        baseURL: base,
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 2,
        isMobile: shot.phone,
        hasTouch: shot.phone,
        locale: 'it-IT',
        colorScheme: theme,
      });
      await context.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
      await context.addCookies(
        sample.cookie.split('; ').map((c) => {
          const [name, ...value] = c.split('=');
          return { name: name as string, value: value.join('='), url: base };
        }),
      );
      const page = await context.newPage();
      await gallery(page, sample, shot.board);
      await shot.after?.(page);
      const file = join(out, `moodboard-${shot.id}-${tag}-${shot.width}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await context.close();
    }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: process.env.SHOTS_ARGS?.split(' ').filter(Boolean) ?? [],
});
try {
  await main(browser);
} finally {
  await browser.close();
}
