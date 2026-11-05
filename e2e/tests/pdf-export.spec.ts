import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { addFrame, addScene, createElement, updateElement } from '@inkadra/canvas-core';
import { initBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const opts = { userId: null } as const;

interface Seeded {
  projectId: string;
  rootBoardId: string;
  storyboardId: string;
  longStoryboardId: string;
}
let seeded: Seeded;

async function readPdf(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const pages: string[] = [];
  const sizes: number[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    const [, , width = 0, height = 0] = page.view;
    sizes.push([Math.round(width), Math.round(height)]);
  }
  const meta = await pdf.getMetadata();
  return { pages, sizes, title: (meta.info as { Title?: string }).Title ?? '' };
}

/** A small opaque PNG (solid colour), as a logo would be. */
function pngLogo(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
}

async function signInPage(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const send = async <T>(method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const post = <T>(path: string, body: unknown) => send<T>('POST', path, body);
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Last Train',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Night platform',
  });

  const longBoard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Long sequence',
  });

  const board = new Y.Doc();
  initBoardDoc(board, project.rootBoardId);
  const note = (x: number, text: string) => {
    const el = createElement(board, 'note', { x, y: 0 }, { w: 240 }, opts);
    const body = roots(board).elements.get(el.id)?.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    body.insert(0, [p]);
    return el;
  };
  const visible = note(0, 'Sodium light against wet blue');
  updateElement(board, visible.id, { tags: ['budget-tag'] });
  const secret = note(300, 'Budget note for the team only');
  updateElement(board, secret.id, { guestHidden: true });
  createElement(
    board,
    'todo',
    { x: 0, y: 200 },
    {
      title: 'Before the shoot',
      items: [{ id: 'item000001', text: 'Book the platform', done: false }],
    },
    opts,
  );
  await pushBoardDoc(base, cookie, project.rootBoardId, board);

  const story = new Y.Doc();
  let firstFrameId = '';
  const frameIds: string[] = [];
  initBoardDoc(story, storyboard.id);
  const scene = addScene(
    story,
    { number: '1', title: 'The platform', setting: 'ext', time: 'night', location: 'Station' },
    opts,
  );
  for (let i = 0; i < 5; i++) {
    const frame = addFrame(
      story,
      scene.id,
      null,
      { action: `Frame action ${i + 1}`, shot: 'ws', durationMs: 3000 },
      opts,
    );
    frameIds.push(frame.id);
    // Frames 1 and 2 approved in the shot list, frame 3 in review (below): the client pitch.
    if (i < 2) updateElement(story, frame.id, { approved: true });
    if (i === 0) {
      firstFrameId = frame.id;
      updateElement(story, frame.id, { notes: 'Director only note', tags: ['internal-tag'] });
    }
    if (i === 4)
      updateElement(story, frame.id, { guestHidden: true, action: 'Hidden frame action' });
  }
  // An open task for the kickoff summary.
  createElement(
    story,
    'todo',
    { x: 0, y: 900 },
    { title: 'Prep', items: [{ id: 'item000002', text: 'Rent the dolly', done: false }] },
    opts,
  );
  await pushBoardDoc(base, cookie, storyboard.id, story);
  await send('PUT', `/boards/${storyboard.id}/elements/${frameIds[2]}/review`, {
    status: 'approved',
  });
  // One shooting day: the production book prints its call sheet, the kickoff its schedule.
  await post(`/boards/${storyboard.id}/schedule`, {
    date: '2026-11-10',
    callTime: '07:00',
    wrap: '19:00',
    location: 'Station platform 4',
    notes: '',
    blocks: [
      {
        id: randomUUID(),
        type: 'shot',
        title: 'Train arrives',
        start: null,
        duration: 60,
        shotId: frameIds[0],
        cast: ['Marta'],
        departments: ['Camera: dolly track'],
      },
    ],
  });
  // 32 frames, enough to squeeze into a strip when the pages were stacked in one image.
  const long = new Y.Doc();
  initBoardDoc(long, longBoard.id);
  const longScene = addScene(long, { number: '1', title: 'Many shots' }, opts);
  for (let i = 0; i < 32; i++) {
    addFrame(long, longScene.id, null, { action: `Long action ${i + 1}`, shot: 'ws' }, opts);
  }
  await pushBoardDoc(base, cookie, longBoard.id, long);
  // One comment for everyone, one for the team only, on the first frame.
  for (const [body, visibility] of [
    ['Shared with the client', 'everyone'],
    ['Team only remark', 'team'],
  ] as const) {
    await post(`/boards/${storyboard.id}/comments`, { elementId: firstFrameId, body, visibility });
  }
  seeded = {
    projectId: project.id,
    rootBoardId: project.rootBoardId,
    storyboardId: storyboard.id,
    longStoryboardId: longBoard.id,
  };
});

test('a board exports to PDF for clients without the cards hidden from guests', async ({
  page,
}, info) => {
  const violations = await watchCsp(page);
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-type="note"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Menu della board' }).click();
  await page.getByRole('menuitem', { name: 'Esporta…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  await dialog.getByRole('button', { name: /Personalizza/ }).click();
  if (process.env.SELECT_SCREENSHOTS) {
    await page.screenshot({ path: '../docs/screenshots/ui-select/export-dialog.png' });
    const trigger = dialog.getByRole('combobox').first();
    await trigger.click();
    await page.screenshot({ path: '../docs/screenshots/ui-select/default-open-desktop-dark.png' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await trigger.click();
    await page.screenshot({ path: '../docs/screenshots/ui-select/default-open-desktop-light.png' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await expect(page.locator('.ink-select__panel')).toBeVisible();
    await page.screenshot({
      path: '../docs/screenshots/ui-select/phone-bottom-sheet.png',
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await trigger.click();
    await expect(page.locator('.ink-select__panel')).toBeVisible();
    await page.screenshot({
      path: '../docs/screenshots/ui-select/phone-bottom-sheet-dark.png',
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await expect(dialog.getByRole('radio', { name: 'Clienti' })).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Escludi le card nascoste agli ospiti' }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('img', { name: 'Anteprima della prima pagina di contenuto' }),
  ).toBeVisible();
  await expect(dialog.getByText('2 pagine')).toBeVisible();

  // The logo is stored on the server, for the whole project.
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: pngLogo(240, 80),
  });
  await expect(dialog.locator('.export__logo-img')).toBeVisible({ timeout: 30_000 });
  const stored = await (
    await page.request.get(`/api/v1/projects/${seeded.projectId}/export-settings`)
  ).json();
  expect(stored.logo).toMatchObject({ mime: 'image/png', filename: 'logo.png' });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Last Train.pdf');
  const path = info.outputPath('board.pdf');
  await download.saveAs(path);
  const pdf = await readPdf(path);
  expect(pdf.title).toBe('Last Train');
  expect(pdf.pages).toHaveLength(2);
  expect(pdf.pages[0]).toContain('Last Train');
  expect(pdf.pages[1]).toContain('Sodium light against wet blue');
  expect(pdf.pages[1]).toContain('Book the platform');
  expect(pdf.pages.join(' ')).not.toContain('Budget note');
  expect(pdf.pages.join(' ')).not.toContain('budget-tag');

  // For the team, with the option off, the hidden card is printed.
  await page.getByRole('button', { name: 'Menu della board' }).click();
  await page.getByRole('menuitem', { name: 'Esporta…' }).click();
  await dialog.getByRole('button', { name: /Personalizza/ }).click();
  await dialog.getByRole('radio', { name: 'Il team' }).click();
  await dialog.getByRole('checkbox', { name: 'Escludi le card nascoste agli ospiti' }).uncheck();
  await dialog.getByRole('checkbox', { name: /Copertina/ }).uncheck();
  await expect(dialog.getByText('1 pagina')).toBeVisible();
  const [teamDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const teamPath = info.outputPath('board-team.pdf');
  await teamDownload.saveAs(teamPath);
  const team = await readPdf(teamPath);
  expect(team.pages).toHaveLength(1);
  expect(team.pages[0]).toContain('Budget note for the team only');
  expect(await violations()).toEqual([]);
});

test('a storyboard exports to PDF with frames per page, and to PNG', async ({ page }, info) => {
  const violations = await watchCsp(page);
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  // The dialog starts from the choices the last export saved for the project, logo included.
  await expect(dialog.getByRole('radio', { name: 'Il team' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Copertina/ })).not.toBeChecked();
  await expect(dialog.locator('.export__logo-img')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Clienti' }).click();
  await dialog.getByRole('checkbox', { name: /Copertina/ }).check();
  await dialog.getByRole('radio', { name: '2', exact: true }).click();
  // Title page and four frames shown to clients, two a page.
  await expect(dialog.getByText('3 pagine')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const path = info.outputPath('storyboard.pdf');
  await download.saveAs(path);
  const pdf = await readPdf(path);
  expect(pdf.title).toBe('Night platform');
  expect(pdf.pages).toHaveLength(3);
  expect(pdf.pages[0]).toContain('Night platform');
  expect(pdf.pages[0]).toContain('STORYBOARD');
  expect(pdf.pages[1]).toContain('1A');
  expect(pdf.pages[1]).toContain('Frame action 1');
  // Page numbers count the title page, like the preview.
  expect(pdf.pages[1]).toContain('2 di 3');
  expect(pdf.pages[2]).toContain('3 di 3');
  expect(pdf.pages[2]).toContain('Frame action 4');
  expect(pdf.pages.join(' ')).not.toContain('Hidden frame action');
  // Nothing internal reaches a client: director's notes, tags, production status.
  for (const internal of ['Director only note', 'internal-tag', 'Bozza']) {
    expect(pdf.pages.join(' ')).not.toContain(internal);
  }

  // With comments, clients get only the threads meant for everyone.
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await expect(dialog.getByRole('radio', { name: 'Clienti' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Includi i commenti' }).check();
  const [withComments] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const commentsPath = info.outputPath('storyboard-comments.pdf');
  await withComments.saveAs(commentsPath);
  const commented = (await readPdf(commentsPath)).pages.join(' ');
  expect(commented).toContain('Shared with the client');
  expect(commented).not.toContain('Team only remark');
  expect(commented).not.toContain('Director only note');

  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await dialog.getByRole('radio', { name: 'PNG', exact: true }).click();
  // Five frames on one page: a single image, not an archive.
  await dialog.getByRole('radio', { name: '6', exact: true }).click();
  await expect(dialog.getByText('1 pagina')).toBeVisible();
  const [png] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  expect(png.suggestedFilename()).toBe('Night platform.png');
  const bytes = await readFile(await png.path());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  // Width in the IHDR chunk: high resolution, not a screen capture.
  expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(2000);
  expect(await violations()).toEqual([]);
});

/**
 * PRESET_SHOTS: the export dialog, dark and light, desktop and phone, for review. A no-op
 * without it.
 */
async function shootDialog(page: Page, name: string) {
  const shots = process.env.PRESET_SHOTS;
  if (!shots) return;
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  await page.mouse.move(size.width - 2, 2);
  for (const [device, width, height] of [
    ['desktop', 1280, 900],
    ['phone', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const mode of ['dark', 'light']) {
      await page.evaluate((m) => {
        document.documentElement.dataset.theme = m;
      }, mode);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${shots}/${name}-${device}-${mode}.png`,
        animations: 'disabled',
      });
      // The options sit below the fold: their own picture, scrolled into view.
      if (name.endsWith('customise'))
        await dialog.locator('.export__options').screenshot({
          path: `${shots}/${name}-options-${device}-${mode}.png`,
          animations: 'disabled',
        });
    }
  }
  await page.setViewportSize(size);
  await page.evaluate((m) => {
    document.documentElement.dataset.theme = m;
  }, theme);
}

test('each audience preset exports a PDF and remembers the last preset for the project', async ({
  page,
}, info) => {
  const violations = await watchCsp(page);
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  // 1. Storyboard view recommends Pitch cliente: 16:9, approved frames only (by flag or by
  // review), one per page, for clients, no comments.
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  await expect(dialog.locator('.export__preset', { hasText: 'Pitch cliente' })).toContainText(
    'Consigliato',
  );
  await dialog.getByRole('radio', { name: /Pitch cliente/ }).click();
  await expect(dialog.getByText('4 pagine')).toBeVisible();
  const shots = process.env.PRESET_SHOTS;
  const shoot = (name: string) => shootDialog(page, name);
  const customise = async (open: boolean) => {
    const button = dialog.getByRole('button', { name: /Personalizza/ });
    if ((await button.getAttribute('aria-expanded')) !== String(open)) await button.click();
  };
  if (shots) {
    await customise(false);
    await shoot('1-pitch');
    await customise(true);
    await shoot('1-pitch-customise');
  }
  const [pitchDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const pitchPath = info.outputPath('preset-client-pitch.pdf');
  await pitchDownload.saveAs(pitchPath);
  if (shots) await pitchDownload.saveAs(`${shots}/preset-client-pitch.pdf`);
  const pitchPdf = await readPdf(pitchPath);
  expect(pitchPdf.pages).toHaveLength(4);
  expect(pitchPdf.sizes).toEqual(Array(4).fill([960, 540]));
  expect(pitchPdf.pages[0]).toContain('STORYBOARD');
  expect(pitchPdf.pages[1]).toContain('Frame action 1');
  expect(pitchPdf.pages[3]).toContain('Frame action 3');
  expect(pitchPdf.pages.join(' ')).not.toContain('Frame action 4');
  expect(pitchPdf.pages.join(' ')).not.toContain('Hidden frame action');
  expect(pitchPdf.pages.join(' ')).not.toContain('Director only note');
  expect(pitchPdf.pages.join(' ')).not.toContain('Shared with the client');

  // 2. Shot list view selects its recommended preset (Libro di produzione) instead of silently exporting the storyboard.
  await page.getByRole('tab', { name: 'Shot list' }).click();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await expect(dialog.getByRole('radio', { name: /Libro di produzione/ })).toBeChecked();
  await expect(dialog.locator('.export__preset', { hasText: 'Libro di produzione' })).toContainText(
    'Consigliato',
  );
  await expect(dialog.getByText('3 pagine')).toBeVisible();
  if (shots) {
    await customise(false);
    await shoot('2-book');
    await customise(true);
    await shoot('2-book-customise');
  }
  const [bookDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const bookPath = info.outputPath('preset-production-book.pdf');
  await bookDownload.saveAs(bookPath);
  if (shots) await bookDownload.saveAs(`${shots}/preset-production-book.pdf`);
  const bookPdf = await readPdf(bookPath);
  expect(bookPdf.pages).toHaveLength(3);
  expect(bookPdf.pages[0]).toContain('SHOT LIST');
  expect(bookPdf.pages[1]).toContain('Hidden frame action');
  expect(bookPdf.pages[1]).toContain('Bozza');
  // The call sheet of the shooting day closes the book.
  expect(bookPdf.pages[2]).toContain('Ordine del giorno');
  expect(bookPdf.pages[2]).toContain('Station platform 4');
  expect(bookPdf.pages[2]).toContain('1A · Train arrives');
  expect(bookPdf.pages[2]).toContain('dolly track');
  expect(bookPdf.pages.join(' ')).not.toContain('Shared with the client');

  // 3. Schedule view recommends Kickoff interno (since Libro di produzione is a shot list preset).
  await page.getByRole('tab', { name: 'Piano riprese' }).click();
  await page.locator('.board-header-export').click();
  await expect(dialog.getByRole('radio', { name: /Kickoff interno/ })).toBeChecked();
  await expect(dialog.locator('.export__preset', { hasText: 'Kickoff interno' })).toContainText(
    'Consigliato',
  );
  await expect(dialog.getByText('5 pagine')).toBeVisible();
  if (shots) {
    await customise(false);
    await shoot('3-kickoff');
    await customise(true);
    await shoot('3-kickoff-customise');
  }
  const [kickoffDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const kickoffPath = info.outputPath('preset-internal-kickoff.pdf');
  await kickoffDownload.saveAs(kickoffPath);
  if (shots) await kickoffDownload.saveAs(`${shots}/preset-internal-kickoff.pdf`);
  const kickoffPdf = await readPdf(kickoffPath);
  expect(kickoffPdf.pages).toHaveLength(5);
  expect(kickoffPdf.pages[0]).toContain('STORYBOARD');
  // The kickoff summary follows the title page: dates, people, open tasks and schedule.
  for (const value of [
    'Riepilogo kickoff',
    '1 giorno di riprese',
    'Giulia',
    'Proprietario',
    'Rent the dolly',
    'Station platform 4',
    '1 inquadratura',
  ])
    expect(kickoffPdf.pages[1]).toContain(value);
  const kickoffText = kickoffPdf.pages.join(' ');
  expect(kickoffText).toContain('Hidden frame action');
  expect(kickoffText).toContain('Director only note');
  expect(kickoffText).toContain('Shared with the client');
  expect(kickoffText).toContain('Team only remark');

  // 4. Returning to Storyboard remembers Kickoff interno (both export the storyboard) while marking Pitch cliente as Consigliato.
  await page.getByRole('tab', { name: 'Storyboard' }).click();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await expect(dialog.getByRole('radio', { name: /Kickoff interno/ })).toBeChecked();
  await expect(dialog.locator('.export__preset', { hasText: 'Pitch cliente' })).toContainText(
    'Consigliato',
  );
  await dialog.getByRole('button', { name: 'Annulla' }).click();

  const stored = await (
    await page.request.get(`/api/v1/projects/${seeded.projectId}/export-settings`)
  ).json();
  expect(stored.preset).toBe('internal-kickoff');
  expect(await violations()).toEqual([]);
});

test('the Storyboard recommends the pitch only once a frame is approved', async ({
  page,
  baseURL,
}, info) => {
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const post = async <T>(path: string, body: unknown, method = 'POST') => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  // A project of its own: no export settings remembered.
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'First Light',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Dawn pier',
  });
  await signInPage(page);
  // A real picture in the frames, so the 16:9 page is checked with an image, not an empty box.
  const picture = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const c = canvas.getContext('2d') as CanvasRenderingContext2D;
      const sky = c.createLinearGradient(0, 0, 0, 720);
      sky.addColorStop(0, '#22324a');
      sky.addColorStop(0.6, '#e48a5a');
      sky.addColorStop(1, '#1d2430');
      c.fillStyle = sky;
      c.fillRect(0, 0, 1280, 720);
      c.fillStyle = '#f6d38a';
      c.beginPath();
      c.arc(860, 430, 70, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#10151d';
      c.fillRect(0, 470, 1280, 250);
      c.fillRect(220, 300, 26, 170);
      return canvas.toDataURL('image/png').split(',')[1] as string;
    }),
    'base64',
  );
  const assetId = await uploadFile(base, cookie, project.id, {
    body: picture,
    name: 'dawn.png',
    type: 'image/png',
  });
  if (!assetId) throw new Error('Upload failed');
  await waitForAssets(base, cookie, [assetId]);
  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  const scene = addScene(
    story,
    { number: '1', title: 'The pier', setting: 'ext', time: 'day', location: 'Harbour' },
    opts,
  );
  const frameIds = [
    'Mara walks to the end of the pier as the sun comes up.',
    'Close on her hands.',
  ].map(
    (action) =>
      addFrame(story, scene.id, null, { action, shot: 'ws', durationMs: 4000, assetId }, opts).id,
  );
  await pushBoardDoc(base, cookie, storyboard.id, story);

  // No approved frame: the pitch would be empty, so the production book is recommended.
  await page.goto(`/p/${project.id}/b/${storyboard.id}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  await expect(dialog.getByRole('radio', { name: /Pitch cliente/ })).toBeVisible();
  await shootDialog(page, 'rec-no-approved');
  await expect(dialog.getByRole('radio', { name: /Libro di produzione/ })).toBeChecked();
  await expect(dialog.locator('.export__preset', { hasText: 'Libro di produzione' })).toContainText(
    'Consigliato',
  );
  await expect(dialog.locator('.export__preset', { hasText: 'Pitch cliente' })).not.toContainText(
    'Consigliato',
  );
  await dialog.getByRole('button', { name: 'Annulla' }).click();

  // Approved in review: the pitch is recommended and shows that frame on a 16:9 page.
  await post(
    `/boards/${storyboard.id}/elements/${frameIds[0]}/review`,
    { status: 'approved' },
    'PUT',
  );
  await page.reload();
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await expect(dialog.getByRole('radio', { name: /Pitch cliente/ })).toBeVisible();
  await shootDialog(page, 'rec-approved');
  await expect(dialog.getByRole('radio', { name: /Pitch cliente/ })).toBeChecked();
  await expect(dialog.locator('.export__preset', { hasText: 'Pitch cliente' })).toContainText(
    'Consigliato',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  const path = info.outputPath('pitch-with-picture.pdf');
  await download.saveAs(path);
  if (process.env.PRESET_SHOTS)
    await download.saveAs(`${process.env.PRESET_SHOTS}/pitch-with-picture.pdf`);
  const pdf = await readPdf(path);
  expect(pdf.sizes).toEqual([
    [960, 540],
    [960, 540],
  ]);
  expect(pdf.pages[1]).toContain('Mara walks to the end of the pier');
  expect(pdf.pages.join(' ')).not.toContain('Close on her hands');
});

/** The PNG files of a stored ZIP: name and the width and height from each IHDR. */
function pngsInZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: { name: string; width: number; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString();
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    expect(zip.subarray(data + 1, data + 4).toString()).toBe('PNG');
    files.push({ name, width: zip.readUInt32BE(data + 16), height: zip.readUInt32BE(data + 20) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test('a long storyboard exports to PNG as one readable image per page, zipped (QA R2-05)', async ({
  page,
}, info) => {
  // 32 pages drawn and encoded one by one on a CI runner.
  test.setTimeout(180_000);
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.longStoryboardId}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  await dialog.getByRole('radio', { name: 'PNG', exact: true }).click();
  await dialog.getByRole('radio', { name: '1', exact: true }).click();
  await expect(dialog.getByText('32 pagine')).toBeVisible();
  await expect(dialog.getByText(/scaricate in un unico file ZIP/)).toBeVisible();
  const shots = process.env.PNG_SHOTS_DIR;
  if (shots) {
    await dialog.screenshot({ path: `${shots}/export-png-dialog-dark.png` });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await dialog.screenshot({ path: `${shots}/export-png-dialog-light.png` });
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Long sequence.zip');
  const zipPath = info.outputPath('long-sequence.zip');
  await download.saveAs(zipPath);
  if (shots) await download.saveAs(`${shots}/long-sequence.zip`);
  const files = pngsInZip(await readFile(zipPath));
  expect(files).toHaveLength(32);
  expect(files[0]?.name).toBe('Long sequence-001.png');
  expect(files[31]?.name).toBe('Long sequence-032.png');
  // Every page keeps the PDF's proportions at a size where the text can be read.
  for (const f of files) {
    expect(Math.min(f.width, f.height)).toBeGreaterThanOrEqual(1200);
    expect(
      Math.abs(Math.max(f.width, f.height) / Math.min(f.width, f.height) - 842 / 595),
    ).toBeLessThan(0.01);
  }
});

test('a card exports as a picture in social formats, remembered for the project', async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const post = async <T>(path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const project = await post<{ id: string; rootBoardId: string }>('/projects', { name: 'Harbour' });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Pier',
  });
  await signInPage(page);
  // Red on the left half, blue on the right: the crop shows which part it kept.
  const picture = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1500;
      canvas.height = 1000;
      const c = canvas.getContext('2d') as CanvasRenderingContext2D;
      c.fillStyle = '#d02020';
      c.fillRect(0, 0, 750, 1000);
      c.fillStyle = '#2040d0';
      c.fillRect(750, 0, 750, 1000);
      return canvas.toDataURL('image/png').split(',')[1] as string;
    }),
    'base64',
  );
  const assetIds = await Promise.all(
    ['one.png', 'two.png'].map((name) =>
      uploadFile(base, cookie, project.id, { body: picture, name, type: 'image/png' }),
    ),
  );
  const [first, second] = assetIds as [string, string];
  await waitForAssets(base, cookie, [first, second]);
  const doc = new Y.Doc();
  initBoardDoc(doc, project.rootBoardId);
  createElement(doc, 'image', { x: 0, y: 0 }, { w: 300, h: 200, assetId: first }, opts);
  createElement(doc, 'image', { x: 340, y: 0 }, { w: 300, h: 200, assetId: second }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  const scene = addScene(story, { number: '1', title: 'Pier' }, opts);
  addFrame(story, scene.id, null, { action: 'Boats', assetId: first }, opts);
  await pushBoardDoc(base, cookie, storyboard.id, story);

  const pixel = (bytes: Buffer, x: number, y: number) => pixelOf(page, bytes, x, y);
  const save = async (path: string, click: () => Promise<unknown>) => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    const file = info.outputPath(path);
    await download.saveAs(file);
    if (process.env.IMAGE_SHOTS) await download.saveAs(`${process.env.IMAGE_SHOTS}/${path}`);
    return { name: download.suggestedFilename(), bytes: await readFile(file) };
  };
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  const submit = () => dialog.getByRole('button', { name: 'Esporta', exact: true }).click();

  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const openFirst = async () => {
    await page.locator('[data-type="image"]').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Esporta immagine…' }).click();
  };
  await page.locator('[data-type="image"]').first().click();
  await openFirst();

  // 4:5 Fill, the focus point moved all the way left by keyboard: only the red half is left.
  await expect(dialog.getByRole('radio', { name: '4:5' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Riempi' })).toBeChecked();
  await expect(dialog.getByText('Post verticale · 1080 × 1350 px')).toBeVisible();
  const focus = dialog.getByRole('slider', { name: 'Punto di interesse' });
  await focus.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(focus).toHaveAttribute('aria-valuenow', '0');
  const fill = await save('social-4x5-fill.png', submit);
  expect(fill.name).toBe('Harbour.png');
  expect(fill.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect([fill.bytes.readUInt32BE(16), fill.bytes.readUInt32BE(20)]).toEqual([1080, 1350]);
  near(await pixel(fill.bytes, 1000, 700), [0xd0, 0x20, 0x20]);

  // Remembered for the project; the focus point is not. 9:16 Fit: black bands by default.
  await page.locator('[data-type="image"]').first().click();
  await openFirst();
  await expect(dialog.getByRole('radio', { name: '4:5' })).toBeChecked();
  await dialog.getByRole('radio', { name: '9:16' }).click();
  await dialog.getByRole('radio', { name: 'Contieni' }).click();
  await expect(dialog.getByRole('slider', { name: 'Punto di interesse' })).toBeHidden();
  const fit = await save('social-9x16-fit.png', submit);
  expect([fit.bytes.readUInt32BE(16), fit.bytes.readUInt32BE(20)]).toEqual([1080, 1920]);
  near(await pixel(fit.bytes, 540, 10), [0, 0, 0]);
  near(await pixel(fit.bytes, 10, 960), [0xd0, 0x20, 0x20]);
  // The picture alone, with no outline of its card: red, then straight to the bar.
  near(await pixel(fit.bytes, 300, 1319), [0xd0, 0x20, 0x20]);
  near(await pixel(fit.bytes, 300, 1321), [0, 0, 0]);
  near(await pixel(fit.bytes, 1070, 960), [0x20, 0x40, 0xd0]);
  const stored = await (
    await page.request.get(`/api/v1/projects/${project.id}/export-settings`)
  ).json();
  expect(stored).toMatchObject({
    imageFormat: 'png',
    imageAspect: '9:16',
    imageFit: 'fit',
    imageBandColor: '#000000',
  });
  expect(stored.focus).toBeUndefined();

  // Two cards in JPEG: one image per card by default, in one ZIP.
  await page.getByRole('button', { name: 'Adatta alla vista' }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('[data-type="image"]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Esporta selezione…' }).click();
  await dialog.getByRole('radio', { name: 'JPEG' }).click();
  await dialog.getByRole('radio', { name: '1:1' }).click();
  await expect(dialog.getByRole('radio', { name: 'Una per card' })).toBeChecked();
  await expect(dialog.getByText('Immagine 1 di 2')).toBeVisible();
  await dialog.getByRole('button', { name: 'Immagine successiva' }).click();
  await expect(dialog.getByText('Immagine 2 di 2')).toBeVisible();
  const zip = await save('social-cards.zip', submit);
  expect(zip.name).toBe('Harbour.zip');
  expect(filesInZip(zip.bytes).map((f) => f.name)).toEqual(['Harbour-001.jpg', 'Harbour-002.jpg']);
  for (const f of filesInZip(zip.bytes)) {
    // A real JPEG, 1080 × 1080 in its start-of-frame marker.
    expect(f.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpegSize(f.bytes)).toEqual([1080, 1080]);
  }

  // A frame of the storyboard, from the "…" of its tile: the picture alone.
  await page.goto(`/p/${project.id}/b/${storyboard.id}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: /^Menu dell.inquadratura/ }).click();
  await page.getByRole('menuitem', { name: 'Esporta immagine…' }).click();
  await expect(dialog.getByRole('radio', { name: 'JPEG' })).toBeChecked();
  await dialog.getByRole('radio', { name: '16:9' }).click();
  const frame = await save('social-frame.jpg', submit);
  expect(frame.name).toBe('Pier.jpg');
  expect(jpegSize(frame.bytes)).toEqual([1920, 1080]);
});

test('bands take the chosen colour in any theme, and a selection downloads its files', async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Quay' }),
  });
  const project = (await res.json()) as { id: string; rootBoardId: string };
  await signInPage(page);
  const solid = async (colour: string) =>
    Buffer.from(
      await page.evaluate((fill) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1500;
        canvas.height = 1000;
        const c = canvas.getContext('2d') as CanvasRenderingContext2D;
        c.fillStyle = fill;
        c.fillRect(0, 0, 1500, 1000);
        return canvas.toDataURL('image/png').split(',')[1] as string;
      }, colour),
      'base64',
    );
  const [red, blue] = [await solid('#d02020'), await solid('#2040d0')];
  const first = await uploadFile(base, cookie, project.id, {
    body: red,
    name: 'one.png',
    type: 'image/png',
  });
  const second = await uploadFile(base, cookie, project.id, {
    body: blue,
    name: 'two.png',
    type: 'image/png',
  });
  await waitForAssets(base, cookie, [first, second]);
  const doc = new Y.Doc();
  initBoardDoc(doc, project.rootBoardId);
  createElement(doc, 'image', { x: 0, y: 0 }, { w: 300, h: 200, assetId: first }, opts);
  createElement(doc, 'image', { x: 340, y: 0 }, { w: 300, h: 200, assetId: second }, opts);
  createElement(doc, 'note', { x: 680, y: 0 }, { w: 240 }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);

  const save = async (path: string, click: () => Promise<unknown>) => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    const file = info.outputPath(path);
    await download.saveAs(file);
    return { name: download.suggestedFilename(), bytes: await readFile(file) };
  };
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const radio = (name: string) => dialog.getByRole('radio', { name });
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const openFirst = async () => {
    await page.locator('[data-type="image"]').first().click();
    await page.locator('[data-type="image"]').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Esporta immagine…' }).click();
  };
  const canvasToken = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ink-bg-canvas'),
    );

  // White bands from the dark theme, then the very same file from the light theme.
  const theme = (mode: 'dark' | 'light') =>
    page.evaluate((m) => {
      document.documentElement.dataset.theme = m;
    }, mode);
  await theme('dark');
  const darkToken = await canvasToken();
  await openFirst();
  await radio('9:16').click();
  await radio('Contieni').click();
  await expect(radio('Nero')).toBeChecked();
  await radio('Bianco').click();
  const inDark = await save('band-dark.png', () => button('Esporta').click());
  near(await pixelOf(page, inDark.bytes, 540, 10), [255, 255, 255]);
  await theme('light');
  expect(await canvasToken()).not.toBe(darkToken);
  await openFirst();
  await expect(radio('Bianco')).toBeChecked();
  const inLight = await save('band-light.png', () => button('Esporta').click());
  expect(inLight.bytes.equals(inDark.bytes)).toBe(true);

  // Any colour, from the app's picker: Escape closes the picker and leaves the dialog open.
  await openFirst();
  await radio('Colore…').click();
  const picker = page.getByRole('dialog', { name: 'Selettore colore' });
  await picker.getByRole('textbox', { name: 'Esadecimale' }).fill('#206040');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(radio('Colore…')).toBeChecked();
  const custom = await save('band-custom.png', () => button('Esporta').click());
  near(await pixelOf(page, custom.bytes, 540, 10), [0x20, 0x60, 0x40]);
  const stored = await (
    await page.request.get(`/api/v1/projects/${project.id}/export-settings`)
  ).json();
  expect(stored.imageBandColor).toBe('#206040');

  // One card: its file as it was uploaded, under its own name.
  await openFirst();
  await radio('Originale').click();
  await expect(radio('Anteprima')).toBeChecked();
  await expect(radio('Nero')).toBeHidden();
  await radio('File originale').click();
  await expect(dialog.getByText('anche la posizione GPS')).toBeVisible();
  await expect(radio('PNG')).toBeHidden();
  const single = await save('one.png', () => button('Scarica il file').click());
  expect(single.name).toBe('one.png');
  expect(single.bytes.equals(red)).toBe(true);
  await expect(dialog).toBeHidden();

  // Several: a refused file is named and the others are saved; then all of them in one ZIP.
  await page.getByRole('button', { name: 'Adatta alla vista' }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('[data-type="image"]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Esporta selezione…' }).click();
  await radio('Originale').click();
  await radio('File originale').click();
  await expect(dialog.getByText('1 card senza file resta fuori.')).toBeVisible();
  await page.route(`**/api/v1/assets/${second}/file*`, (route) => route.fulfill({ status: 403 }));
  const partial = await save('partial.zip', () => button('Scarica 2 file').click());
  expect(filesInZip(partial.bytes).map((f) => f.name)).toEqual(['one.png']);
  await expect(dialog.getByRole('alert')).toContainText('two.png');
  await page.unroute(`**/api/v1/assets/${second}/file*`);
  const whole = await save('whole.zip', () => button('Scarica 2 file').click());
  expect(whole.name).toBe('Quay.zip');
  const files = filesInZip(whole.bytes);
  expect(files.map((f) => f.name)).toEqual(['one.png', 'two.png']);
  expect(files[0]?.bytes.equals(red)).toBe(true);
  expect(files[1]?.bytes.equals(blue)).toBe(true);
  await expect(dialog).toBeHidden();

  // Never remembered.
  await openFirst();
  await radio('Originale').click();
  await expect(radio('Anteprima')).toBeChecked();
});

const pixelOf = (page: Page, bytes: Buffer, x: number, y: number) =>
  page.evaluate(
    async ([data, px, py]) => {
      const res = await fetch(`data:image/png;base64,${data}`);
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      return [...ctx.getImageData(px as number, py as number, 1, 1).data];
    },
    [bytes.toString('base64'), x, y] as const,
  );

function near(actual: number[], rgb: number[]) {
  for (const [i, v] of rgb.entries()) expect(Math.abs((actual[i] as number) - v)).toBeLessThan(12);
}

/** Files of a stored ZIP, with their bytes. */
function filesInZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: { name: string; bytes: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.push({
      name: zip.subarray(at + 46, at + 46 + nameLength).toString(),
      bytes: zip.subarray(data, data + size),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(bytes: Buffer): number[] {
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1] as number;
    if (marker >= 0xc0 && marker <= 0xc3)
      return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return [];
}
