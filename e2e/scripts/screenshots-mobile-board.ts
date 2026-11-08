import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readElement, roots } from '@inkadra/doc-schema';
import { chromium, type Page } from '@playwright/test';
import { readBoard } from '../tests/frame-grab.helpers.ts';
import { type SampleProject, seedSampleProject } from './sample-project.ts';

/**
 * Phone screenshots of the board and the film views, at 390×844 and 360×780, in the light and
 * the dark theme, to review the mobile layout:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 SHOTS_OUT=/tmp/mobile SHOTS_TAG=before \
 *     pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-mobile-board.ts
 *
 * The first run seeds the sample project and keeps its ids in SHOTS_OUT/seed.json, so a later
 * run (after a fix and a new build) photographs the same project. SHOTS_ONLY=03,07 limits the
 * run to some screens. Files are named NN-screen-TAG-WIDTH-THEME.png.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = process.env.SHOTS_OUT ?? join(process.cwd(), 'mobile-shots');
const tag = process.env.SHOTS_TAG ?? 'before';
const only = process.env.SHOTS_ONLY?.split(',').filter(Boolean);

interface Seed extends SampleProject {
  ids: { image: string; note: string; character: string; location: string; arrow: string };
}

/** The ids of the sample's cards that the screens open. */
async function seedExtras(sample: SampleProject): Promise<Seed> {
  const { cookie, project, casting, asset } = sample;
  // The sample's casting board holds Anna, the station and the arrow between them.
  const cast = [...roots(await readBoard(base, cookie, casting.id)).elements.values()].map(
    (m) => readElement(m)!,
  );
  const named = (type: string, name: string) =>
    cast.find((e) => e.type === type && 'name' in e && e.name === name)!.id;
  const character = named('character', 'Anna');
  const location = named('location', 'Central station');
  const arrow = cast.find((e) => e.type === 'arrow' && e.label === 'waits here')!.id;

  const mood = await readBoard(base, cookie, project.rootBoardId);
  const els = [...roots(mood).elements.values()].map((m) => readElement(m)!);
  const image = els.find((e) => e.type === 'image' && e.assetId === asset.platform)!.id;
  const noteId = els.find((e) => e.type === 'note')!.id;
  return { ...sample, ids: { image, note: noteId, character, location, arrow } };
}

type Shot = [id: string, prepare: (page: Page, seed: Seed) => Promise<void>];

const settled = (page: Page) => page.waitForLoadState('networkidle').catch(() => {});

async function board(page: Page, seed: Seed, boardId = seed.project.rootBoardId, view = 'canvas') {
  await page.goto(`/p/${seed.project.id}/b/${boardId}?view=${view}`);
  // The phone header leaves the sync status out: wait for the view itself.
  await page.locator('.ink-main').waitFor({ timeout: 20_000 });
  await settled(page);
}

const card = (page: Page, id: string) => page.locator(`[data-el="${id}"]`);

const shots: Shot[] = [
  ['01-board', (page, seed) => board(page, seed)],
  [
    '02-card-selected',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.image).tap();
    },
  ],
  [
    '03-card-menu',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.image).click({ button: 'right' });
    },
  ],
  [
    '04-canvas-menu',
    async (page, seed) => {
      await board(page, seed);
      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    },
  ],
  [
    '05-note-sheet',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.note).dblclick();
    },
  ],
  [
    '06-viewer',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.image).dblclick();
      await page.locator('.viewer').waitFor();
    },
  ],
  [
    '07-image-crop',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.image).tap();
      await page.getByRole('button', { name: 'Ritaglia e ruota' }).click();
      await page.getByTestId('image-crop-stage').waitFor();
    },
  ],
  [
    '08-arrows',
    async (page, seed) => {
      await board(page, seed, seed.casting.id);
      await page.locator('.arrows__label', { hasText: 'waits here' }).click();
    },
  ],
  [
    '09-character-sheet',
    async (page, seed) => {
      await board(page, seed, seed.casting.id);
      await card(page, seed.ids.character).dblclick();
      await page.getByRole('complementary', { name: 'Scheda personaggio' }).waitFor();
    },
  ],
  [
    '10-location-sheet',
    async (page, seed) => {
      await board(page, seed, seed.casting.id);
      await card(page, seed.ids.location).dblclick();
      await page.getByRole('complementary', { name: 'Scheda location' }).waitFor();
    },
  ],
  ['11-storyboard', (page, seed) => board(page, seed, seed.storyboard.id, 'storyboard')],
  [
    '12-frame-panel',
    async (page, seed) => {
      await board(page, seed, seed.storyboard.id, 'storyboard');
      await page.locator('.story__tile-pic').first().click();
      await page.getByRole('complementary', { name: 'Dettagli' }).waitFor();
    },
  ],
  ['13-shotlist', (page, seed) => board(page, seed, seed.storyboard.id, 'shotlist')],
  ['14-schedule', (page, seed) => board(page, seed, seed.storyboard.id, 'schedule')],
  [
    '15-schedule-day',
    async (page, seed) => {
      await board(page, seed, seed.storyboard.id, 'schedule');
      await page.locator('.schedule__day').first().click();
    },
  ],
  [
    '16-call-sheet',
    async (page, seed) => {
      await board(page, seed, seed.storyboard.id, 'schedule');
      await page.getByRole('button', { name: 'Foglio di lavorazione' }).first().click();
    },
  ],
  [
    '18-export',
    async (page, seed) => {
      await board(page, seed);
      await page.getByRole('button', { name: 'Menu della board' }).click();
      await page.getByRole('menuitem', { name: 'Esporta…' }).click();
      await page.getByRole('dialog', { name: 'Esporta' }).waitFor();
      await page.waitForTimeout(1500);
    },
  ],
  [
    '19-export-settings',
    async (page, seed) => {
      await board(page, seed, seed.storyboard.id, 'storyboard');
      await page.getByRole('button', { name: 'Esporta PDF' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Esporta' });
      await dialog.waitFor();
      await page.waitForTimeout(1500);
      await dialog.evaluate((d) => {
        for (const el of d.querySelectorAll('*'))
          if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      });
    },
  ],
  [
    '20-screenplay-import',
    async (page, seed) => {
      await board(page, seed, seed.storyboard.id, 'storyboard');
      await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
      await page.getByRole('dialog', { name: 'Importa una sceneggiatura' }).waitFor();
    },
  ],
  [
    '21-frame-grab',
    async (page, seed) => {
      await board(page, seed, seed.rushes.id);
      await page.locator('[data-type="file"]').first().dblclick();
      const video = page.locator('.viewer video');
      await video.waitFor();
      await video.evaluate(async (v: HTMLVideoElement) => {
        if (v.readyState < 2)
          await new Promise<void>((r) =>
            v.addEventListener('loadeddata', () => r(), { once: true }),
          );
        v.pause();
      });
      await page.keyboard.press('g');
      await page.waitForTimeout(800);
    },
  ],
  [
    '22-share',
    async (page, seed) => {
      await board(page, seed);
      await page.getByRole('button', { name: 'Condividi' }).first().click();
      await page.getByRole('dialog').waitFor();
    },
  ],
  [
    '23-comments',
    async (page, seed) => {
      await board(page, seed);
      await card(page, seed.ids.image).tap();
      await page.getByRole('toolbar').getByRole('button', { name: 'Commenti e revisione' }).click();
      await page.getByRole('complementary', { name: 'Commenti' }).waitFor();
    },
  ],
  [
    '24-guest-board',
    async (page, seed) => {
      await page.goto(seed.guestUrl);
      await page.locator('.card').first().waitFor({ timeout: 20_000 });
      await settled(page);
    },
  ],
  [
    '25-guest-card',
    async (page, seed) => {
      await page.goto(seed.guestUrl);
      await card(page, seed.ids.image).click({ timeout: 20_000 });
      await settled(page);
    },
  ],
  ['26-review', (page, seed) => board(page, seed, seed.storyboard.id, 'review')],
  ['27-moodboard', (page, seed) => board(page, seed, seed.storyboard.id, 'moodboard')],
];

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: process.env.SHOTS_ARGS?.split(' ').filter(Boolean) ?? [],
  });
  mkdirSync(out, { recursive: true });
  const seedFile = join(out, 'seed.json');
  let seed: Seed;
  if (existsSync(seedFile)) seed = JSON.parse(readFileSync(seedFile, 'utf8')) as Seed;
  else {
    seed = await seedExtras(await seedSampleProject(browser, base));
    writeFileSync(seedFile, JSON.stringify(seed, null, 2));
  }
  const failures: string[] = [];
  const sizes = (process.env.SHOTS_SIZES ?? '390x844,360x780')
    .split(',')
    .map((s) => s.split('x').map(Number) as [number, number]);
  const themes = (process.env.SHOTS_THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
  for (const [width, height] of sizes) {
    for (const theme of themes) {
      for (const [id, prepare] of shots) {
        if (only && !only.some((o) => id.startsWith(o))) continue;
        const guest = id.startsWith('24') || id.startsWith('25');
        const context = await browser.newContext({
          baseURL: base,
          viewport: { width, height },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'it-IT',
          colorScheme: theme,
        });
        await context.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
        if (!guest)
          await context.addCookies(
            seed.cookie.split('; ').map((c) => {
              const [name, ...value] = c.split('=');
              return { name: name as string, value: value.join('='), url: base };
            }),
          );
        const page = await context.newPage();
        const file = join(out, `${id}-${tag}-${width}-${theme}.png`);
        try {
          await prepare(page, seed);
          await page.waitForTimeout(700);
          await page.screenshot({ path: file });
          console.log(file);
        } catch (error) {
          failures.push(`${id} ${width} ${theme}: ${(error as Error).message.split('\n')[0]}`);
          await page.screenshot({ path: file }).catch(() => {});
        }
        await context.close();
      }
    }
  }
  await browser.close();
  if (failures.length) console.log(`Failures:\n${failures.join('\n')}`);
}

await main();
