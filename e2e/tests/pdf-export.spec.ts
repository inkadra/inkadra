import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { addFrame, addScene, createElement, updateElement } from '@inkadra/canvas-core';
import { initBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

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
  await dialog.getByRole('radio', { name: 'Immagine (PNG)' }).click();
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
  // PRESET_SHOTS: the dialog of each preset, dark and light, desktop and phone, for review.
  const shots = process.env.PRESET_SHOTS;
  const shoot = async (name: string) => {
    if (!shots) return;
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
  };
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
  await dialog.getByRole('button', { name: /Personalizza/ }).click();
  await dialog.getByRole('radio', { name: 'Immagine (PNG)' }).click();
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
