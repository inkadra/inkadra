import { readFile } from 'node:fs/promises';
import { addFrame, addScene, createElement } from '@inkadra/canvas-core';
import { initBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';
import { png, readZip, writeZip } from './support/archive.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists. The project is
// made here, so the story does not depend on the other specs.
test.describe.configure({ mode: 'serial' });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const director = {
  name: 'Luca Regista',
  email: `luca-transfer-${Date.now()}@example.com`,
  password: 'another-horse-battery',
};
const opts = { userId: null } as const;
const NAME = `Porto Vecchio ${Date.now()}`;
const COMMENT = 'Schiarire il cielo a sinistra';

interface Seeded {
  projectId: string;
  rootBoardId: string;
  storyboardId: string;
  noteId: string;
}
let seeded: Seeded;
let archive: Buffer;
let imported: { projectId: string; rootBoardId: string; storyboardId: string };

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

const json = async <T>(page: Page, path: string): Promise<T> => {
  const res = await page.request.get(`/api/v1${path}`);
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return (await res.json()) as T;
};

/** The archive as a drop: the real event, with the file in its data transfer. */
async function dropArchive(page: Page, name: string, bytes: Buffer) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, base64 }) => {
      const data = new DataTransfer();
      const content = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([content], name, { type: 'application/zip' }));
      return data;
    },
    { name, base64: bytes.toString('base64') },
  );
  await page.locator('.transfer-drop').dispatchEvent('drop', { dataTransfer });
}

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const call = async <T>(method: string, path: string, body?: unknown, who = cookie) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie: who, 'content-type': 'application/json', origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  const project = await call<{ id: string; rootBoardId: string }>('POST', '/projects', {
    name: NAME,
  });
  const sub = await call<{ id: string }>('POST', `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'board',
    title: 'Sopralluoghi',
  });
  const storyboard = await call<{ id: string }>('POST', `/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Binario 21',
  });

  // One picture on the board, and a logo for the PDF export (decision 0039).
  const picture = await uploadFile(base, cookie, project.id, {
    body: png(96, 64, 3),
    name: 'molo.png',
    type: 'image/png',
  });
  const logo = await uploadFile(base, cookie, project.id, {
    body: png(240, 80, 5),
    name: 'logo.png',
    type: 'image/png',
  });
  if (!picture || !logo) throw new Error('Uploads are not available');
  await waitForAssets(base, cookie, [picture, logo]);
  await call('PATCH', `/projects/${project.id}/export-settings`, {
    audience: 'team',
    titlePage: false,
    comments: true,
    framesPerPage: 2,
    logoAssetId: logo,
  });

  const board = new Y.Doc();
  initBoardDoc(board, project.rootBoardId);
  const note = createElement(board, 'note', { x: 0, y: 0 }, { w: 240 }, opts);
  const body = roots(board).elements.get(note.id)?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('Sopralluogo al molo')]);
  body.insert(0, [p]);
  createElement(board, 'image', { x: 320, y: 0 }, { assetId: picture }, opts);
  createElement(board, 'board', { x: 0, y: 300 }, { boardId: sub.id }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, board);

  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  const scene = addScene(
    story,
    { number: '1', title: 'Il binario', setting: 'ext', time: 'night', location: 'Stazione' },
    opts,
  );
  for (let i = 0; i < 5; i++)
    addFrame(story, scene.id, null, { action: `Inquadratura ${i + 1}`, shot: 'ws' }, opts);
  await pushBoardDoc(base, cookie, storyboard.id, story);

  // A comment by someone else: the archive carries the name, never the account.
  const directorCookie = await signUpViaInvite(base, cookie, project.id, 'editor', director);
  // Comments check the card in the stored document, written a moment after the push.
  await expect
    .poll(
      () =>
        call(
          'POST',
          `/boards/${project.rootBoardId}/comments`,
          {
            elementId: note.id,
            body: COMMENT,
          },
          directorCookie,
        ).then(
          () => true,
          () => false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  seeded = {
    projectId: project.id,
    rootBoardId: project.rootBoardId,
    storyboardId: storyboard.id,
    noteId: note.id,
  };
});

test('a project exports from its menu to a zip with a manifest', async ({ page }, info) => {
  await login(page);
  await page.getByRole('link', { name: 'Progetti', exact: true }).first().click();
  await page
    .getByRole('button', { name: `Opzioni progetto: ${NAME}` })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Esporta progetto…' }).click();
  const dialog = page.getByRole('dialog', { name: `Esporta «${NAME}»` });
  await expect(dialog.getByText('Board e sotto-board, file originali, commenti')).toBeVisible();
  await dialog.getByRole('button', { name: 'Esporta', exact: true }).click();
  await expect(dialog.getByRole('status').getByText("L'archivio è pronto")).toBeVisible({
    timeout: 60_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('link', { name: 'Scarica' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const path = info.outputPath('porto-vecchio.zip');
  await download.saveAs(path);
  archive = await readFile(path);

  const entries = new Map(readZip(archive).map((e) => [e.name, e.data]));
  const manifest = JSON.parse(entries.get('manifest.json')?.toString() ?? 'null');
  expect(manifest).toMatchObject({ format: 'inkadra-project', formatVersion: 1 });
  for (const name of ['project.json', 'boards.json', 'comments.json', 'export-settings.json']) {
    expect(entries.has(name), name).toBe(true);
  }
  // Three boards (root, sub-board, storyboard), their documents, and the two files.
  expect(JSON.parse(entries.get('boards.json')?.toString() ?? '[]')).toHaveLength(3);
  expect([...entries.keys()].filter((n) => /^boards\/[^/]+\/document\.yjs$/.test(n))).toHaveLength(
    3,
  );
  expect([...entries.keys()].filter((n) => n.startsWith('files/'))).toHaveLength(2);
  // People travel by name: no email address is in the archive.
  const text = [...entries.entries()]
    .filter(([n]) => n.endsWith('.json'))
    .map(([, d]) => d.toString())
    .join('\n');
  expect(text).toContain(director.name);
  expect(text).not.toContain(director.email);
  expect(text).not.toContain(admin.email);
});

test('the archive imports as a new project with everything in it', async ({ page }) => {
  expect(archive, 'the export test makes the archive').toBeTruthy();
  await login(page);
  await page.getByRole('link', { name: 'Progetti', exact: true }).first().click();
  await page.getByRole('button', { name: 'Importa progetto…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Importa progetto' });
  await dropArchive(page, 'porto-vecchio.zip', archive);
  await expect(dialog.getByText('porto-vecchio.zip')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
  const result = dialog.getByRole('status');
  await expect(result.getByText(`«${NAME}» è pronto`)).toBeVisible({ timeout: 60_000 });
  // Boards, files (the picture and the logo) and comments, as the archive counted them.
  await expect(result.getByText('3 board · 2 file · 1 commenti')).toBeVisible();
  await dialog.getByRole('link', { name: 'Apri progetto' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  const projectId = page.url().split('/p/')[1] as string;
  expect(projectId).not.toBe(seeded.projectId);

  // A new project of the importer, with the same boards under new ids.
  const project = await json<{ id: string; rootBoardId: string; myRole: string }>(
    page,
    `/projects/${projectId}`,
  );
  expect(project.myRole).toBe('owner');
  const { items } = await json<{ items: { id: string; kind: string; title: string }[] }>(
    page,
    `/projects/${projectId}/boards`,
  );
  expect(items.map((b) => `${b.kind}:${b.title}`).sort()).toEqual([
    `board:${NAME}`,
    'board:Sopralluoghi',
    'storyboard:Binario 21',
  ]);
  const storyboard = items.find((b) => b.kind === 'storyboard');
  imported = {
    projectId,
    rootBoardId: project.rootBoardId,
    storyboardId: storyboard?.id as string,
  };
  expect(Object.values(imported)).not.toContain(seeded.storyboardId);

  // The root board: note, board card, and the picture, shown again from a regenerated thumbnail.
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.locator('[data-type="note"]')).toContainText('Sopralluogo al molo');
  await expect(page.locator('[data-type="board"]')).toContainText('Sopralluoghi');
  const image = page.locator('[data-type="image"] img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      timeout: 30_000,
    })
    .toBe(true);
  const src = await image.getAttribute('src');
  const thumb = await page.request.get(src as string);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()['content-type']).toMatch(/^image\//);
});

test('the storyboard keeps its frames, the comment its author name, the export its settings', async ({
  page,
}) => {
  expect(imported, 'the import test makes the project').toBeTruthy();
  await login(page);
  // Frames: the same five, in the same scene.
  await page.goto(`/p/${imported.projectId}/b/${imported.storyboardId}?view=storyboard`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scena 1' }).locator('.story__tile')).toHaveCount(
    5,
  );

  // The comment: the new owner is its holder, the author's name is the one of the other server.
  const comments = await json<{
    items: { body: string; author: { kind: string; name?: string } }[];
  }>(page, `/boards/${imported.rootBoardId}/comments`);
  expect(comments.items).toHaveLength(1);
  expect(comments.items[0]).toMatchObject({
    body: COMMENT,
    author: { kind: 'imported', name: director.name },
  });
  await page.goto(`/p/${imported.projectId}/b/${imported.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.locator(`[data-el="${seeded.noteId}"]`).click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Commenti e revisione' }).click();
  const panel = page.getByRole('complementary', { name: 'Commenti' });
  await expect(panel.getByText(COMMENT)).toBeVisible();
  await expect(panel.getByText(director.name)).toBeVisible();

  // Export settings and logo travel with the project.
  const settings = await json<{
    audience: string;
    titlePage: boolean;
    comments: boolean;
    framesPerPage: number;
    logo: { mime: string; filename: string } | null;
  }>(page, `/projects/${imported.projectId}/export-settings`);
  expect(settings).toMatchObject({
    audience: 'team',
    titlePage: false,
    comments: true,
    framesPerPage: 2,
    logo: { mime: 'image/png', filename: 'logo.png' },
  });
  await page.goto(`/p/${imported.projectId}/b/${imported.storyboardId}?view=storyboard`);
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Esporta' });
  await expect(exportDialog.getByRole('radio', { name: 'Il team' })).toBeChecked();
  await expect(exportDialog.getByRole('checkbox', { name: /Copertina/ })).not.toBeChecked();
  await expect(exportDialog.getByRole('checkbox', { name: 'Includi i commenti' })).toBeChecked();
  await expect(exportDialog.locator('.export__logo-img')).toBeVisible();
});

test.describe('an archive that is not an Inkadra export', () => {
  /** Drops `bytes` as `name`, imports, and expects the failure to be told, in the dialog. */
  async function importRejected(page: Page, name: string, bytes: Buffer, message: string) {
    await login(page);
    const before = await json<{ items: unknown[] }>(page, '/projects');
    await page.getByRole('link', { name: 'Progetti', exact: true }).first().click();
    await page.getByRole('button', { name: 'Importa progetto…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importa progetto' });
    await dropArchive(page, name, bytes);
    await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(message, { timeout: 60_000 });
    // The way out is to choose another file; the import button is gone with the failed one.
    await expect(dialog.getByRole('button', { name: 'Scegli un altro file' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Apri progetto' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Scegli un altro file' }).click();
    await expect(dialog.getByText("Trascina qui l'archivio o scegli un file")).toBeVisible();
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
    // Nothing was created.
    const after = await json<{ items: unknown[] }>(page, '/projects');
    expect(after.items).toHaveLength(before.items.length);
  }

  test('a corrupt file is refused with a clear error', async ({ page }) => {
    await importRejected(
      page,
      'rotto.zip',
      Buffer.concat([readZipHead(), Buffer.from('this is not a zip file at all')]),
      'Questo file non è un archivio Inkadra valido.',
    );
  });

  test('a zip that is not an Inkadra archive is refused too', async ({ page }) => {
    await importRejected(
      page,
      'foto-ferie.zip',
      writeZip([{ name: 'notes.txt', data: Buffer.from('Not a project') }]),
      'Questo file non è un archivio Inkadra valido.',
    );
  });

  test('a file that is not a zip is not even sent', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Progetti', exact: true }).first().click();
    await page.getByRole('button', { name: 'Importa progetto…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importa progetto' });
    let uploads = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/projects/import')) uploads++;
    });
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: 'progetto.pdf', mimeType: 'application/pdf', buffer: png(8, 8) });
    await expect(dialog.getByRole('alert')).toHaveText(
      'Scegli un archivio .zip esportato da Inkadra.',
    );
    await expect(dialog.getByRole('button', { name: 'Importa', exact: true })).toBeDisabled();
    expect(uploads).toBe(0);
  });
});

/** The first bytes of a real zip, so the file looks like one and breaks inside. */
function readZipHead() {
  return writeZip([{ name: 'manifest.json', data: Buffer.from('{}') }]).subarray(0, 40);
}
