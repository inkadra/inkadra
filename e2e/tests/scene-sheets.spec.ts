// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  addFrame,
  addScene,
  addTodoItem,
  createElement,
  updateElement,
} from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Scene sheets by department (decision 0083), in English like the approved mockup.
// Runs after first-run.spec.ts: the administrator exists.
test.use({ locale: 'en-GB' });
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const opts = { userId: null } as const;
const out = process.env.SCENESHEETS_SHOTS ?? join(tmpdir(), 'inkadra-scenesheets');
let url = '';
let cookie = '';

/** A solid PNG, standing in for a costume reference. */
function png(rgb: [number, number, number], width = 60, height = 80): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const id = () => randomUUID().replace(/-/g, '').slice(0, 21);
const INK = '#1C1C1E';

/** A figure in a room, drawn with the frame's shapes, so thumbnails are not empty. */
function sketch(x: number) {
  const g = (v: number) => Math.round(v * 4096);
  return [
    {
      id: id(),
      kind: 'rect' as const,
      color: INK,
      width: 6,
      x0: g(0.05),
      y0: g(0.1),
      x1: g(0.95),
      y1: g(0.9),
    },
    {
      id: id(),
      kind: 'ellipse' as const,
      color: INK,
      width: 8,
      x0: g(x),
      y0: g(0.3),
      x1: g(x + 0.1),
      y1: g(0.48),
    },
    {
      id: id(),
      kind: 'line' as const,
      color: INK,
      width: 8,
      x0: g(x + 0.05),
      y0: g(0.48),
      x1: g(x + 0.05),
      y1: g(0.8),
    },
  ];
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  cookie = await signIn(base, admin);
  const post = async <T>(path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  // The administrator reads Italian in the other specs: English only while these run.
  await setLocale(base, 'en');
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'The Long Night',
  });
  const board = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Storyboard',
  });
  const refs = await Promise.all(
    (
      [
        [90, 74, 60],
        [120, 104, 88],
        [60, 64, 80],
        [150, 120, 96],
        [70, 80, 70],
      ] as const
    ).map((rgb, i) =>
      uploadFile(base, cookie, project.id, {
        body: png([...rgb]),
        name: `look-${i + 1}.png`,
        type: 'image/png',
      }),
    ),
  );
  const assets = refs.filter((r): r is string => !!r);
  await waitForAssets(base, cookie, assets);

  const doc = new Y.Doc();
  initBoardDoc(doc, board.id);
  const s11 = addScene(
    doc,
    { number: '11', title: 'Street', setting: 'ext', time: 'night', location: 'Street' },
    opts,
  );
  const f11 = addFrame(
    doc,
    s11.id,
    null,
    { shot: 'ws', cast: ['Mara'], shapes: sketch(0.4) },
    opts,
  );
  const s12 = addScene(
    doc,
    {
      number: '12',
      title: 'Kitchen',
      setting: 'int',
      time: 'night',
      location: 'Kitchen',
      synopsis:
        'Mara comes home soaked; Luca is already there, the lights off. They talk without looking at each other.',
    },
    opts,
  );
  const shots = [
    ['ws', 'eye', 'static', '24', 'Door opens, dark room'],
    ['ms', 'eye', 'dolly', '35', 'Follow Mara to the table'],
    ['mcu', 'low', 'static', '50', 'Luca in silhouette'],
    ['cu', 'ots', 'static', '85', ''],
    ['insert', 'high', 'tilt', '100', 'Wet keys on the table'],
    ['ws', 'eye', 'static', '24', 'Lamp on'],
  ] as const;
  const f12 = shots.map(([shot, angle, movement, lens, notes], i) =>
    addFrame(
      doc,
      s12.id,
      null,
      {
        shot,
        angle,
        movement,
        lens,
        ...(notes ? { notes } : {}),
        cast: i === 2 ? ['Luca'] : ['Mara', 'Luca'],
        shapes: sketch(0.15 + i * 0.12),
      },
      opts,
    ),
  );
  const s13 = addScene(
    doc,
    { number: '13', title: 'Hallway', setting: 'int', time: 'night', location: 'Hallway' },
    opts,
  );
  addFrame(doc, s13.id, null, { shot: 'ms', cast: ['Luca'], shapes: sketch(0.5) }, opts);
  // A later draft left it out (decision 0082): no sheet, and Mara's continuity skips it.
  const s13a = addScene(
    doc,
    { number: '13A', title: 'Stairs', setting: 'int', time: 'night', location: 'Stairs' },
    opts,
  );
  updateElement(doc, s13a.id, { omitted: true });
  addFrame(doc, s13a.id, null, { shot: 'ms', cast: ['Mara'], shapes: sketch(0.3) }, opts);
  const s14 = addScene(
    doc,
    { number: '14A', title: 'Rooftop', setting: 'ext', time: 'night', location: 'Rooftop' },
    opts,
  );
  const f14 = addFrame(
    doc,
    s14.id,
    null,
    { shot: 'ews', cast: ['Mara'], shapes: sketch(0.7) },
    opts,
  );

  createElement(
    doc,
    'character',
    { x: 0, y: 900 },
    {
      w: 300,
      name: 'Mara',
      actor: 'Giulia R.',
      costume:
        'Costume 2 · wet coat\nHair wet, mascara slightly run. Same look as scenes 11 and 14A.',
      references: assets.slice(0, 3),
      contact: 'Agent: never printed for clients',
    },
    opts,
  );
  createElement(
    doc,
    'character',
    { x: 340, y: 900 },
    {
      w: 300,
      name: 'Luca',
      actor: 'Marco D.',
      costume: 'Costume 1 · home\nSleeves rolled up. Bruise on left hand from scene 9.',
      references: assets.slice(3, 5),
    },
    opts,
  );
  createElement(
    doc,
    'location',
    { x: 680, y: 900 },
    {
      w: 300,
      name: 'Kitchen',
      address: 'Via Roma 12, kitchen',
      notes: 'Parking in the courtyard. Owner: S. Bianchi.',
      light: 'Practical lamp only; blackout on the windows.',
      scenes: ['12'],
    },
    opts,
  );
  const g = (v: number) => Math.round(v * 4096);
  createElement(
    doc,
    'plan',
    { x: 0, y: 1300 },
    {
      w: 480,
      title: 'Kitchen A',
      sceneIds: [s12.id],
      shapes: [
        {
          id: id(),
          kind: 'rect' as const,
          color: INK,
          width: 4,
          x0: g(0.1),
          y0: g(0.1),
          x1: g(0.9),
          y1: g(0.9),
        },
        {
          id: id(),
          kind: 'rect' as const,
          color: INK,
          width: 3,
          x0: g(0.38),
          y0: g(0.4),
          x1: g(0.58),
          y1: g(0.6),
        },
      ],
      icons: [
        {
          id: id(),
          kind: 'camera',
          color: '#9DB8F2',
          x: g(0.78),
          y: g(0.78),
          rotation: 200,
          label: 'A cam',
        },
        {
          id: id(),
          kind: 'fresnel',
          color: '#EDD963',
          x: g(0.2),
          y: g(0.21),
          rotation: 30,
          label: 'Key',
        },
        { id: id(), kind: 'actor', color: '#F79B54', x: g(0.33), y: g(0.5), label: 'Mara' },
        { id: id(), kind: 'actor', color: '#B897F0', x: g(0.65), y: g(0.5), label: 'Luca' },
      ],
    },
    opts,
  );
  const list = createElement(doc, 'todo', { x: 0, y: 1700 }, { items: [] }, opts).id;
  updateElement(doc, list, { list: 'props', sceneId: s12.id });
  for (const text of [
    'Rain machine (from scene 11)',
    'Practical lamp, kitchen table',
    'Two towels, coffee pot',
  ])
    addTodoItem(doc, list, text);
  await pushBoardDoc(base, cookie, board.id, doc);
  doc.destroy();

  const block = (shotId: string, departments: string[] = []) => ({
    id: randomUUID(),
    type: 'shot',
    title: '',
    start: null,
    duration: 45,
    shotId,
    cast: [],
    departments,
  });
  for (const [date, callTime, blocks] of [
    ['2026-11-16', '07:00', [block(f11.id)]],
    ['2026-11-17', '08:00', []],
    [
      '2026-11-18',
      '18:30',
      [
        block(f12[0]?.id as string, [
          'Production: Lights off at the start, blackout on the windows.',
        ]),
        ...f12.slice(1).map((f) => block(f.id)),
        block(f14.id),
      ],
    ],
  ] as const)
    await post(`/boards/${board.id}/schedule`, {
      date,
      callTime,
      wrap: null,
      location: '',
      notes: '',
      blocks,
    });
  // The days move to the Production board; the sheets read the blocks of this storyboard there
  // (decision 0123).
  await post(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    title: 'Produzione',
    kind: 'production',
  });
  url = `/p/${project.id}/b/${board.id}`;
});

async function setLocale(base: string, locale: string) {
  const res = await fetch(`${base}/api/v1/me`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) throw new Error(`locale: ${res.status}`);
}

test.afterAll(async ({ baseURL }) => {
  await setLocale(baseURL as string, 'it');
});

async function readPdf(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages;
}

async function open(page: Page, base: string, theme: 'dark' | 'light', phone: boolean) {
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  await page.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.goto(url);
}

/**
 * Opens the export on the scene sheets of one department and the third shooting day, A4
 * portrait, for the team unless `audience` says otherwise.
 */
async function sheets(
  page: Page,
  department: string,
  audience: 'Clients' | 'The team' = 'The team',
) {
  await page.getByRole('button', { name: 'Export PDF' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Export/ });
  await dialog.getByRole('combobox', { name: 'Content' }).click();
  await page.getByRole('option', { name: 'Scene sheets' }).click();
  await dialog
    .locator('.export__departments')
    .getByRole('radio', { name: new RegExp(`^${department}`) })
    .check();
  await dialog.getByRole('combobox', { name: /^Scenes/ }).click();
  await page.getByRole('option', { name: /^Day 3/ }).click();
  await dialog.getByRole('radio', { name: audience }).check();
  await dialog.getByRole('radio', { name: 'Portrait' }).check();
  return dialog;
}

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
}

for (const theme of ['dark', 'light'] as const)
  test(`the export dialog offers scene sheets (${theme})`, async ({ page, baseURL }) => {
    mkdirSync(out, { recursive: true });
    await open(page, baseURL as string, theme, false);
    const dialog = await sheets(page, 'Camera');
    await expect(dialog.locator('.export__preview figcaption')).toHaveText(/^Page 1 of \d+$/);
    await expect(dialog.locator('.export__summary')).toHaveText(/^\d+ scene sheets · A4 portrait$/);
    await expect(dialog.locator('.export__paper')).toHaveAttribute('data-status', 'ready');
    await dialog
      .locator('.export__pdf-options')
      .evaluate((el) =>
        el.scrollTo(0, (el.querySelector('.export__field') as HTMLElement).offsetTop),
      );
    await settle(page);
    await page.screenshot({ path: join(out, `dialog-desktop-${theme}.png`) });
  });

test('every department prints its own sheet, and clients get no schedule', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await open(page, baseURL as string, 'light', false);
  const texts: Record<string, string[]> = {};
  for (const [name, label] of [
    ['camera', 'Camera'],
    ['lighting', 'Lighting & grip'],
    ['costume', 'Costume & make-up'],
    ['production', 'Production'],
    ['everything', 'Everything'],
  ] as const) {
    const dialog = await sheets(page, label);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    const path = join(out, `sheets-${name}.pdf`);
    await download.saveAs(path);
    texts[name] = await readPdf(path);
  }
  const sheet = (name: string) => texts[name]?.join('\n') ?? '';
  // For the team: the sheets of scenes 12 and 14A.
  expect(sheet('camera')).toContain('12 · INT. KITCHEN – NIGHT');
  expect(sheet('camera')).toContain('Door opens, dark room');
  expect(sheet('camera')).toContain('SET PLAN · KITCHEN A');
  expect(sheet('camera')).not.toContain('Played by');
  expect(sheet('lighting')).toContain('Practical lamp only');
  expect(sheet('costume')).toContain('Played by Giulia R.');
  expect(sheet('costume')).toContain(
    'Previous scene with Mara: 11 (EXT. STREET – NIGHT). Next: 14A.',
  );
  expect(sheet('costume')).not.toContain('Door opens');
  expect(sheet('production')).toContain('Via Roma 12, kitchen');
  expect(sheet('production')).toContain('Day 3 of 3 · scenes 12, 14A');
  expect(sheet('production')).toContain('Rain machine (from scene 11)');
  expect(sheet('production')).toContain('Lights off at the start');
  expect(sheet('everything')).toContain('Played by Marco D.');
  expect(sheet('everything')).toContain('Two towels, coffee pot');
  expect(texts.camera?.some((p) => /Inkadra · The team\s+1 \/ \d/.test(p))).toBe(true);

  const dialog = await sheets(page, 'Production', 'Clients');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const path = join(out, 'sheets-production-clients.pdf');
  await download.saveAs(path);
  const client = (await readPdf(path)).join('\n');
  expect(client).toContain('Inkadra · Clients');
  expect(client).toContain('Rain machine (from scene 11)');
  expect(client).not.toContain('18:30');
  expect(client).not.toContain('Parking in the courtyard');
});

for (const theme of ['dark', 'light'] as const)
  test(`the phone shows the first sheets and the departments as chips (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL as string, theme, true);
    await page.getByRole('button', { name: 'Export PDF' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await dialog.getByRole('combobox', { name: 'Content' }).click();
    await page.getByRole('option', { name: 'Scene sheets' }).click();
    await dialog.locator('.export__departments').getByRole('radio', { name: 'Camera' }).check();
    await expect(dialog.locator('.export__chips .ink-tile')).toHaveCount(5);
    await expect(dialog.locator('.export__canvas:not([hidden])')).toHaveCount(3);
    await expect(dialog.locator('.export__paper')).toHaveAttribute('data-status', 'ready');
    await dialog
      .locator('.export__departments')
      .getByRole('radio', { name: 'Camera' })
      .scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({ path: join(out, `dialog-phone-${theme}.png`) });
  });

for (const [theme, phone] of [
  ['dark', false],
  ['light', false],
  ['dark', true],
  ['light', true],
] as const)
  test(`omitted scenes are left out unless asked for (${theme}, ${phone ? 'phone' : 'desktop'})`, async ({
    page,
    baseURL,
  }) => {
    mkdirSync(out, { recursive: true });
    await open(page, baseURL as string, theme, phone);
    await page.getByRole('button', { name: 'Export PDF' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await dialog.getByRole('combobox', { name: 'Content' }).click();
    await page.getByRole('option', { name: 'Scene sheets' }).click();
    const leaveOut = dialog.getByRole('checkbox', { name: 'Leave out omitted scenes' });
    await expect(leaveOut).toBeChecked();
    // The summary counts the sheets' pages: scene 13A takes one more.
    const summary = dialog.locator('.export__summary');
    await expect(summary).toHaveText(/^[1-9]\d* scene sheets/);
    const pages = Number.parseInt((await summary.textContent()) ?? '', 10);
    await leaveOut.uncheck();
    await expect(summary).toHaveText(new RegExp(`^${pages + 1} scene sheets`));
    await leaveOut.check();
    await expect(summary).toHaveText(new RegExp(`^${pages} scene sheets`));
    await expect(dialog.locator('.export__paper')).toHaveAttribute('data-status', 'ready');
    await dialog.getByRole('combobox', { name: /^Scenes/ }).scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({
      path: join(out, `omitted-${phone ? 'phone' : 'desktop'}-${theme}.png`),
    });
  });
