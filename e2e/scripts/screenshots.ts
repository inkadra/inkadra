import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addFrame, addScene, createElement, moveIntoParent } from '@inkadra/canvas-core';
import { initBoardDoc, roots } from '@inkadra/doc-schema';
import { type Browser, chromium, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';

/**
 * Builds a sample project on an empty instance and takes the screenshots of the README
 * (docs/screenshots/readme), in the dark and the light theme:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e screenshots
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
 *
 * The pictures on the boards are drawn here, so the screenshots carry no third-party images.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../../docs/screenshots/readme', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };

/** Film stills as SVG: sky, sun or moon, a skyline or hills, and a few details per scene. */
const stills: Record<string, { sky: [string, string, string]; body: string }> = {
  platform: {
    sky: ['#0B1A2A', '#1E3A4C', '#E07A3F'],
    body: `<rect y="560" width="1600" height="340" fill="#0A0F14"/>
      <rect x="0" y="600" width="1600" height="14" fill="#F2A65A" opacity=".8"/>
      <g fill="#F2C76E" opacity=".9">${lamps(8, 90, 200, 330)}</g>
      <path d="M0 640 L1600 760 L1600 900 L0 900Z" fill="#05080B"/>
      <rect x="1030" y="430" width="34" height="140" rx="12" fill="#05080B"/>
      <circle cx="1047" cy="412" r="22" fill="#05080B"/>`,
  },
  rain: {
    sky: ['#06121C', '#12324A', '#2D6F86'],
    body: `<g stroke="#9FD4E6" stroke-width="3" opacity=".35">${rain(140)}</g>
      <rect x="180" y="300" width="300" height="600" fill="#08131B"/>
      <rect x="560" y="200" width="380" height="700" fill="#0B1822"/>
      <rect x="1040" y="340" width="360" height="560" fill="#08131B"/>
      <rect x="610" y="260" width="160" height="40" fill="#FF4F7B" opacity=".85"/>
      <rect x="1090" y="400" width="110" height="26" fill="#56E0FF" opacity=".8"/>`,
  },
  dawn: {
    sky: ['#2B2A4C', '#B66E7A', '#F6C98A'],
    body: `<circle cx="1100" cy="560" r="120" fill="#FFE2A8" opacity=".9"/>
      <path d="M0 640 Q400 520 800 620 T1600 600 L1600 900 L0 900Z" fill="#3D2B3F"/>
      <path d="M0 720 Q500 640 1000 720 T1600 700 L1600 900 L0 900Z" fill="#22182A"/>`,
  },
  diner: {
    sky: ['#1A0F0A', '#3B2216', '#6A3A22'],
    body: `<rect x="120" y="180" width="1360" height="420" fill="#F0B35A" opacity=".18"/>
      <rect x="120" y="580" width="1360" height="40" fill="#C9772E"/>
      <rect x="0" y="620" width="1600" height="280" fill="#120A06"/>
      <g fill="#120A06"><circle cx="520" cy="430" r="46"/><rect x="470" y="470" width="100" height="150" rx="30"/>
      <circle cx="980" cy="420" r="42"/><rect x="934" y="458" width="92" height="160" rx="30"/></g>
      <rect x="240" y="230" width="220" height="60" fill="#FF6A3D" opacity=".75"/>`,
  },
  field: {
    sky: ['#3C6E8F', '#8DB5C9', '#E9D7A6'],
    body: `<path d="M0 600 Q800 560 1600 600 L1600 900 L0 900Z" fill="#B8A15A"/>
      <path d="M0 700 Q800 640 1600 700 L1600 900 L0 900Z" fill="#8C7A3C"/>
      <rect x="1180" y="420" width="12" height="200" fill="#2A2418"/>
      <path d="M1186 300 L1110 430 L1262 430Z" fill="#2A2418"/>`,
  },
  tunnel: {
    sky: ['#05060A', '#0E1420', '#1C2A40'],
    body: `<ellipse cx="800" cy="470" rx="560" ry="420" fill="#0A0D14"/>
      <ellipse cx="800" cy="480" rx="200" ry="150" fill="#E8F1FF" opacity=".85"/>
      <ellipse cx="800" cy="480" rx="300" ry="230" fill="#6E8CC8" opacity=".25"/>
      <path d="M560 900 L780 520 L820 520 L1040 900Z" fill="#1A2130"/>`,
  },
  window: {
    sky: ['#101418', '#1B242C', '#2A3640'],
    body: `<rect x="420" y="120" width="760" height="560" fill="#7FA6C4" opacity=".55"/>
      <rect x="792" y="120" width="16" height="560" fill="#101418"/>
      <rect x="420" y="392" width="760" height="16" fill="#101418"/>
      <g fill="#0A0D10"><circle cx="640" cy="560" r="70"/><rect x="560" y="610" width="160" height="290" rx="50"/></g>`,
  },
  sea: {
    sky: ['#1F2E45', '#4F6E8C', '#C99A7A'],
    body: `<circle cx="420" cy="520" r="70" fill="#F3D3A8" opacity=".85"/>
      <rect y="560" width="1600" height="340" fill="#1B2A3A"/>
      <g stroke="#F3D3A8" stroke-width="4" opacity=".5"><path d="M330 600h180M300 640h240M340 690h160M280 740h280"/></g>
      <path d="M1180 560 L1600 470 L1600 560Z" fill="#101A24"/>`,
  },
};

function lamps(n: number, x0: number, step: number, y: number) {
  return Array.from(
    { length: n },
    (_, i) => `<circle cx="${x0 + i * step}" cy="${y}" r="9"/>`,
  ).join('');
}

function rain(n: number) {
  let seed = 7;
  const r = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: n }, () => {
    const x = Math.round(r() * 1600);
    const y = Math.round(r() * 900);
    return `<path d="M${x} ${y}l-14 46"/>`;
  }).join('');
}

function stillSvg(name: string): string {
  const s = stills[name];
  if (!s) throw new Error(`no still ${name}`);
  const [a, b, c] = s.sky;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
    <rect width="1600" height="900" fill="url(#sky)"/>${s.body}
    <rect width="1600" height="900" fill="url(#vig)"/></svg>`;
}

async function renderStills(browser: Browser): Promise<Record<string, Buffer>> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const result: Record<string, Buffer> = {};
  for (const name of Object.keys(stills)) {
    await page.setContent(`<body style="margin:0">${stillSvg(name)}</body>`);
    result[name] = await page.screenshot({ type: 'jpeg', quality: 88 });
  }
  await page.close();
  return result;
}

async function api<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function note(doc: Y.Doc, at: { x: number; y: number }, lines: string[], w?: number) {
  const el = createElement(doc, 'note', at, w ? { w } : {}, opts);
  const body = roots(doc).elements.get(el.id)?.get('body') as Y.XmlFragment;
  lines.forEach((line, i) => {
    const heading = i === 0 && lines.length > 1;
    const node = new Y.XmlElement(heading ? 'heading' : 'paragraph');
    if (heading) node.setAttribute('level', 1 as unknown as string);
    node.insert(0, [new Y.XmlText(line)]);
    body.insert(i, [node]);
  });
  return el.id;
}

async function main() {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : process.env.SHOTS_CHANNEL
        ? { channel: process.env.SHOTS_CHANNEL }
        : {},
  );
  const pictures = await renderStills(browser);
  const cookie = await signIn(base, account);
  const project = await api<{ id: string; rootBoardId: string }>(cookie, '/projects', {
    name: 'Last Train',
  });
  const storyboard = await api<{ id: string }>(cookie, `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Storyboard',
  });
  const casting = await api<{ id: string }>(cookie, `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'board',
    title: 'Casting',
  });

  const asset: Record<string, string> = {};
  for (const [name, body] of Object.entries(pictures)) {
    const id = await uploadFile(base, cookie, project.id, {
      body,
      name: `${name}.jpg`,
      type: 'image/jpeg',
    });
    if (!id) throw new Error('This instance does not take uploads');
    asset[name] = id;
  }
  await waitForAssets(base, cookie, Object.values(asset));
  const pic = (name: string) => asset[name] as string;

  // The moodboard: the project's root board.
  const mood = new Y.Doc();
  initBoardDoc(mood, project.rootBoardId);
  mood.transact(() => {
    note(
      mood,
      { x: 0, y: 0 },
      [
        'Last Train',
        'A short film. One night, one platform, the last train out of the city.',
        'Sodium light against wet blue. Long lenses, little camera movement.',
      ],
      300,
    );
    createElement(mood, 'board', { x: 0, y: 250 }, { boardId: storyboard.id }, opts);
    createElement(mood, 'board', { x: 160, y: 250 }, { boardId: casting.id }, opts);
    createElement(
      mood,
      'todo',
      { x: 0, y: 440 },
      {
        title: 'Before the shoot',
        items: [
          { id: 'shotstodo0001', text: 'Scout the central station', done: true },
          { id: 'shotstodo0002', text: 'Night permit from the city', done: true },
          { id: 'shotstodo0003', text: 'Rent the sodium lamps', done: false },
          { id: 'shotstodo0004', text: 'Rain machine test', done: false },
        ],
        w: 300,
      },
      opts,
    );

    const image = (name: string, x: number, y: number, w: number, caption?: string) =>
      createElement(
        mood,
        'image',
        { x, y },
        { assetId: pic(name), w, ...(caption ? { caption } : {}) },
        opts,
      );
    image('platform', 360, 0, 420, 'Platform 4, 2 a.m.');
    image('diner', 360, 290, 420);
    image('rain', 800, 0, 300);
    image('window', 800, 189, 300);
    image('tunnel', 800, 378, 300);

    const light = createElement(
      mood,
      'column',
      { x: 1140, y: 0 },
      { title: 'Light', w: 240 },
      opts,
    );
    const kids = [
      createElement(mood, 'image', { x: 0, y: 0 }, { assetId: pic('dawn') }, opts).id,
      createElement(mood, 'image', { x: 0, y: 0 }, { assetId: pic('sea') }, opts).id,
      note(mood, { x: 0, y: 0 }, ['Blue hour for the ending, the sky still holding some warmth.']),
    ];
    moveIntoParent(mood, kids, light.id, 0);

    const palette = createElement(
      mood,
      'column',
      { x: 1400, y: 0 },
      { title: 'Palette', w: 160 },
      opts,
    );
    const swatches = [
      ['#E07A3F', 'Sodium'],
      ['#1E3A4C', 'Wet night'],
      ['#F2C76E', 'Lamp'],
      ['#0A0F14', 'Shadow'],
    ].map(
      ([hex, label]) =>
        createElement(mood, 'color', { x: 0, y: 0 }, { hex: hex as string, label }, opts).id,
    );
    moveIntoParent(mood, swatches, palette.id, 0);

    createElement(
      mood,
      'link',
      { x: 360, y: 550 },
      {
        url: 'https://en.wikipedia.org/wiki/Sodium-vapor_lamp',
        title: 'Sodium-vapor lamp',
        description: 'Why everything at night turns orange.',
      },
      opts,
    );
    image('field', 800, 567, 300);
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, mood);

  // The storyboard: two scenes, frames with a picture and the data of the shot.
  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  story.transact(() => {
    const one = addScene(
      story,
      {
        number: '1',
        title: 'The platform',
        setting: 'ext',
        time: 'night',
        location: 'Central station',
        synopsis: 'Anna runs for the last train and misses it.',
      },
      opts,
      { x: 0, y: 0 },
    );
    const frames1: Array<[string, Record<string, unknown>]> = [
      [
        'platform',
        {
          action: 'The empty platform, lamps humming.',
          shot: 'ews',
          lens: '24mm',
          durationMs: 6000,
          status: 'shot',
        },
      ],
      [
        'tunnel',
        {
          action: 'Headlights fill the tunnel.',
          shot: 'ws',
          movement: 'static',
          lens: '85mm',
          durationMs: 4000,
          status: 'ready',
        },
      ],
      [
        'rain',
        {
          action: 'Anna crosses the street in the rain.',
          shot: 'fs',
          movement: 'pan',
          lens: '50mm',
          durationMs: 5000,
          status: 'ready',
          cast: ['Anna'],
        },
      ],
      [
        'window',
        {
          action: 'She watches the train leave.',
          shot: 'mcu',
          angle: 'ots',
          lens: '85mm',
          durationMs: 4500,
          status: 'todo',
          cast: ['Anna'],
        },
      ],
    ];
    for (const [p, f] of frames1) addFrame(story, one.id, null, { assetId: pic(p), ...f }, opts);
    const two = addScene(
      story,
      {
        number: '2',
        title: 'The diner',
        setting: 'int',
        time: 'night',
        location: 'Station diner',
        synopsis: 'Waiting for the morning, a stranger sits down.',
      },
      opts,
    );
    const frames2: Array<[string, Record<string, unknown>]> = [
      [
        'diner',
        {
          action: 'Two strangers, one counter.',
          shot: 'ms',
          lens: '35mm',
          durationMs: 8000,
          status: 'todo',
          cast: ['Anna', 'Leo'],
          dialogue: 'LEO: Missed it too?',
        },
      ],
      [
        'dawn',
        {
          action: 'Dawn through the glass.',
          shot: 'ws',
          lens: '35mm',
          durationMs: 5000,
          status: 'draft',
        },
      ],
      [
        'sea',
        {
          action: 'The first train, the sea behind it.',
          shot: 'ews',
          movement: 'dolly',
          lens: '24mm',
          durationMs: 7000,
          status: 'draft',
        },
      ],
    ];
    for (const [p, f] of frames2) addFrame(story, two.id, null, { assetId: pic(p), ...f }, opts);
  });
  await pushBoardDoc(base, cookie, storyboard.id, story);

  // The casting board, so that its card on Home has a preview.
  const cast = new Y.Doc();
  initBoardDoc(cast, casting.id);
  cast.transact(() => {
    note(cast, { x: 0, y: 0 }, ['Anna', 'Late twenties, tired, quick to laugh.'], 260);
    note(cast, { x: 0, y: 200 }, ['Leo', 'Older, night-shift worker, few words.'], 260);
    createElement(cast, 'image', { x: 300, y: 0 }, { assetId: pic('window'), w: 320 }, opts);
    createElement(cast, 'image', { x: 300, y: 200 }, { assetId: pic('diner'), w: 320 }, opts);
  });
  await pushBoardDoc(base, cookie, casting.id, cast);

  // A shooting day today, for the card on Home. The date is the local one, like the app's.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const block = (type: string, title: string, start: string | null, duration: number) => ({
    id: randomUUID(),
    type,
    title,
    start,
    duration,
    shotId: null,
    cast: [],
    departments: [],
  });
  await api(cookie, `/boards/${storyboard.id}/schedule`, {
    date: today,
    callTime: '18:30',
    wrap: '04:00',
    location: 'Central station',
    notes: '',
    blocks: [
      block('setup', 'Lamps and rain machine', '18:30', 90),
      block('shot', 'The empty platform', null, 60),
      block('break', 'Dinner', null, 45),
      block('shot', 'Anna misses the train', null, 120),
    ],
  });

  mkdirSync(out, { recursive: true });
  const boardUrl = `/p/${project.id}`;
  const storyUrl = `/p/${project.id}/b/${storyboard.id}`;
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      colorScheme: theme,
    });
    await context.addCookies(
      cookie.split('; ').map((c) => {
        const [name, ...value] = c.split('=');
        return { name: name as string, value: value.join('='), url: base };
      }),
    );
    const page = await context.newPage();
    await shoot(page, boardUrl, join(out, `board-${theme}.png`));
    await shoot(page, storyUrl, join(out, `storyboard-${theme}.png`));
    await shoot(page, `${storyUrl}?view=shotlist`, join(out, `shotlist-${theme}.png`));
    await shoot(page, '/', join(out, `home-${theme}.png`));
    await context.close();
  }
  await browser.close();
  console.log(`Screenshots in ${out}`);
}

async function shoot(page: Page, path: string, file: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (path !== '/' && !path.includes('view=')) {
    await page
      .getByTestId('canvas')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await page.keyboard.press('Shift+Digit1');
  }
  await page.waitForTimeout(1500);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file });
  console.log(file);
}

await main();
