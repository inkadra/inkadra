import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArrow, createElement } from '@inkadra/canvas-core';
import { readElement, roots } from '@inkadra/doc-schema';
import { type Browser, chromium, type Page } from '@playwright/test';
import { readBoard } from '../tests/frame-grab.helpers.ts';
import { pushBoardDoc, uploadFile, waitForAssets } from '../tests/perf/seed.ts';
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
const opts = { userId: null };

interface Seed extends SampleProject {
  ids: { image: string; note: string; character: string; location: string; arrow: string };
  guestUrl: string;
}

/** Characters, locations and arrows on the casting board; a video on the moodboard. */
async function seedExtras(browser: Browser, sample: SampleProject): Promise<Seed> {
  const { cookie, project, casting, asset } = sample;
  const page = await browser.newPage();
  await page.goto(`${base}/login`);
  const footage = await recordFootage(page);
  await page.close();
  const video = await uploadFile(base, cookie, project.id, {
    body: footage,
    name: 'Platform rehearsal.webm',
    type: 'video/webm',
  });
  if (!video) throw new Error('This instance does not take uploads');
  await waitForAssets(base, cookie, [video]);

  const cast = await readBoard(base, cookie, casting.id);
  let character = '';
  let location = '';
  let arrow = '';
  cast.transact(() => {
    character = createElement(
      cast,
      'character',
      { x: 700, y: 0 },
      {
        name: 'Anna',
        role: 'Protagonist',
        assetId: asset.window,
        age: '28',
        description: 'Misses the last train, and stays.',
        actor: 'Giulia Neri',
        contact: 'Lumen agency · 02 0000 0000',
        scenes: ['1', '2'],
      },
      opts,
    ).id;
    location = createElement(
      cast,
      'location',
      { x: 1000, y: 0 },
      {
        name: 'Central station',
        setting: 'int-ext',
        assetId: asset.platform,
        address: 'Piazza della Stazione 1',
        light: 'Sodium lamps, blue hour',
        availability: 'After the last train, 0:30–5:00',
        scenes: ['1'],
      },
      opts,
    ).id;
    const rect = (id: string) => {
      const el = readElement(roots(cast).elements.get(id)!)!;
      return { x: el.x, y: el.y, w: el.w, h: 200 };
    };
    const end = (id: string) => ({ elementId: id, ...rect(id) });
    arrow = createArrow(
      cast,
      end(character),
      end(location),
      rect,
      { label: 'waits here' },
      opts,
    ).id;
  });
  await pushBoardDoc(base, cookie, casting.id, cast);

  const mood = await readBoard(base, cookie, project.rootBoardId);
  const els = [...roots(mood).elements.values()].map((m) => readElement(m)!);
  const image = els.find((e) => e.type === 'image' && e.x === 360 && e.y === 0)!.id;
  const noteId = els.find((e) => e.type === 'note')!.id;
  mood.transact(() => {
    createElement(mood, 'file', { x: 1140, y: 700 }, { assetId: video }, opts);
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, mood);

  const res = await fetch(`${base}/api/v1/boards/${project.rootBoardId}/share-links`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ role: 'guest_view', label: 'Client' }),
  });
  if (!res.ok) throw new Error(`share link: ${res.status}`);
  const { url } = (await res.json()) as { url: string };
  return {
    ...sample,
    ids: { image, note: noteId, character, location, arrow },
    guestUrl: url,
  };
}

/** A few seconds of WebM drawn in the browser, for the frame grab. */
async function recordFootage(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<Blob>((r) => {
      recorder.onstop = () => r(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    const started = performance.now();
    for (let i = 0; performance.now() - started < 3000; i++) {
      ctx.fillStyle = '#0b1a2a';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#e07a3f';
      ctx.fillRect(200 + (i % 60) * 10, 300, 400, 160);
      await new Promise((r) => setTimeout(r, 33));
    }
    recorder.stop();
    for (const track of stream.getTracks()) track.stop();
    return [...new Uint8Array(await (await done).arrayBuffer())];
  });
  return Buffer.from(bytes);
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
      await board(page, seed);
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
    seed = await seedExtras(browser, await seedSampleProject(browser, base));
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
