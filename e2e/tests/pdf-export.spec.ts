import { readFile } from 'node:fs/promises';
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
}
let seeded: Seeded;

async function readPdf(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const meta = await pdf.getMetadata();
  return { pages, title: (meta.info as { Title?: string }).Title ?? '' };
}

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
    );
  });
  return () => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
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
  const post = async <T>(path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const project = await post<{ id: string; rootBoardId: string }>('/projects', { name: 'Last Train' });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Night platform',
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
  note(0, 'Sodium light against wet blue');
  const secret = note(300, 'Budget note for the team only');
  updateElement(board, secret.id, { guestHidden: true });
  createElement(board, 'todo', { x: 0, y: 200 }, { title: 'Before the shoot', items: [{ id: 'item000001', text: 'Book the platform', done: false }] }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, board);

  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  const scene = addScene(story, { number: '1', title: 'The platform', setting: 'ext', time: 'night', location: 'Station' }, opts);
  for (let i = 0; i < 5; i++) {
    const frame = addFrame(story, scene.id, null, { action: `Frame action ${i + 1}`, shot: 'ws', durationMs: 3000 }, opts);
    if (i === 4) updateElement(story, frame.id, { guestHidden: true, action: 'Hidden frame action' });
  }
  await pushBoardDoc(base, cookie, storyboard.id, story);
  seeded = { projectId: project.id, rootBoardId: project.rootBoardId, storyboardId: storyboard.id };
});

test('a board exports to PDF for clients without the cards hidden from guests', async ({ page }, info) => {
  const violations = await watchCsp(page);
  await signInPage(page);
  await page.goto(`/p/${seeded.projectId}/b/${seeded.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-type="note"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Menu della board' }).click();
  await page.getByRole('menuitem', { name: 'Esporta…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Esporta' });
  await expect(dialog.getByRole('button', { name: 'Clienti' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('checkbox', { name: 'Escludi le card nascoste agli ospiti' })).toBeChecked();
  await expect(dialog.getByRole('img', { name: 'Anteprima della prima pagina di contenuto' })).toBeVisible();
  await expect(dialog.getByText('2 pagine')).toBeVisible();

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

  // For the team, with the option off, the hidden card is printed.
  await page.getByRole('button', { name: 'Menu della board' }).click();
  await page.getByRole('menuitem', { name: 'Esporta…' }).click();
  await dialog.getByRole('button', { name: 'Il team' }).click();
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
  await dialog.getByRole('button', { name: '2', exact: true }).click();
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
  expect(pdf.pages[2]).toContain('Frame action 4');
  expect(pdf.pages.join(' ')).not.toContain('Hidden frame action');

  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await dialog.getByRole('button', { name: 'Immagine (PNG)' }).click();
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
