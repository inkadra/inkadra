import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const fixtures = new URL('../../apps/web/src/board/film/screenplay/fixtures/', import.meta.url);
let seeded: { projectId: string; storyboardId: string; canvasId: string };

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
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Screenplay import',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Night platform',
  });
  const canvas = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'board',
    title: 'Night canvas',
  });
  seeded = { projectId: project.id, storyboardId: storyboard.id, canvasId: canvas.id };
});

async function signedIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}

async function openBoard(page: Page, boardId: string) {
  await signedIn(page);
  await page.goto(`/p/${seeded.projectId}/b/${boardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
}

const openStoryboard = (page: Page) => openBoard(page, seeded.storyboardId);

async function pick(page: Page, file: string) {
  const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
  await dialog.getByLabel('Scegli un file').setInputFiles({
    name: file,
    mimeType: 'text/plain',
    buffer: await readFile(new URL(file, fixtures)),
  });
  return dialog;
}

test('a Fountain screenplay becomes scenes and frames, undone in one step', async ({ page }) => {
  await openStoryboard(page);
  await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
  const dialog = await pick(page, 'last-train.fountain');
  await expect(dialog.getByText('LAST TRAIN', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/di Nora Vidal · 5 scene · 2 personaggi/)).toBeVisible();
  // The cold open stays out; the rest arrives with a frame per action paragraph.
  await dialog.getByRole('checkbox', { name: /COLD OPEN/ }).uncheck();
  await expect(dialog.getByText('Crea 4 scene e 8 inquadrature.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
  await expect(dialog).toBeHidden();

  for (const [number, tiles] of [
    ['1', 3],
    ['2', 1],
    ['2A', 1],
    ['3A', 3],
  ] as const) {
    const scene = page.getByRole('region', { name: `Scena ${number}`, exact: true });
    await expect(scene.locator('.story__tile')).toHaveCount(tiles);
  }
  const station = page.getByRole('region', { name: 'Scena 1', exact: true });
  await expect(station.getByLabel('Luogo', { exact: true })).toHaveValue('CENTRAL STATION');
  await expect(station.getByLabel('Titolo', { exact: true })).toHaveValue('Central Station');
  await expect(
    page
      .getByRole('region', { name: 'Scena 2', exact: true })
      .getByLabel('Titolo', { exact: true }),
  ).toHaveValue('Guard Booth');
  await expect(station.getByLabel('Interno o esterno')).toHaveAttribute('data-value', 'ext');
  await expect(station.getByLabel('Momento', { exact: true })).toHaveAttribute(
    'data-value',
    'night',
  );
  await expect(station.getByLabel('Sinossi')).toHaveValue(
    'Mara misses the last train and meets Leo.',
  );
  await station.locator('.story__tile-pic').nth(1).click();
  const panel = page.getByRole('complementary', { name: 'Dettagli' });
  await expect(panel.getByLabel('Azione', { exact: true })).toHaveValue(
    /The departures board flips/,
  );
  await expect(panel.getByLabel('Dialogo', { exact: true })).toHaveValue(
    /MARA: \(out of breath\) No\. No, no, no\./,
  );
  await panel.getByRole('button', { name: 'Chiudi i dettagli' }).click();

  // One undo takes the whole import back.
  await page.getByRole('status').getByRole('button', { name: 'Annulla' }).click();
  await expect(page.locator('.story__scene')).toHaveCount(0);
});

test('the sidebar counts the imported frames before the server has stored them', async ({
  page,
}) => {
  await openStoryboard(page);
  const shots = page.getByRole('link', { name: /^Storyboard/ }).first();
  await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
  const dialog = await pick(page, 'last-train.fountain');
  await dialog.getByRole('checkbox', { name: /COLD OPEN/ }).uncheck();
  await expect(dialog.getByText('Crea 4 scene e 8 inquadrature.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
  await expect(dialog).toBeHidden();
  // The server stores a board about two seconds after the last edit: the count cannot wait for it.
  await expect(shots).toHaveAttribute('data-ink-tooltip', /8 inquadrature/, { timeout: 1500 });
  await page.getByRole('status').getByRole('button', { name: 'Annulla' }).click();
  await expect(shots).not.toHaveAttribute('data-ink-tooltip', /8 inquadrature/, { timeout: 1500 });
});

test('a Final Draft screenplay makes a new storyboard named after its title', async ({ page }) => {
  await openStoryboard(page);
  await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
  const dialog = await pick(page, 'last-train.fdx');
  await expect(dialog.getByText(/3 scene · 2 personaggi/)).toBeVisible();
  await dialog.getByRole('radio', { name: 'Una', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Uno nuovo' }).check();
  await expect(dialog.getByText('Crea 3 scene e 3 inquadrature.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importa', exact: true }).click();

  await expect(page).not.toHaveURL(new RegExp(seeded.storyboardId));
  await expect(page.locator('.story__scene')).toHaveCount(3);
  await expect(page.locator('.story__tile')).toHaveCount(3);
  await expect(page.locator('.story__tile-action').first()).toContainText('Rain hammers');
  await expect(page.getByRole('navigation').getByText('Last Train').first()).toBeVisible();
});

test('the import dialog opened from the Canvas toolbar is modal and the board stays out of it', async ({
  page,
}) => {
  await openBoard(page, seeded.canvasId);
  // A note to aim at, then nothing selected.
  // Beside the floating navigation (#333): the canvas runs under it from the window's edge.
  await page.locator('.canvas').dblclick({ position: { x: 300, y: 348 } });
  const note = page.locator('.card--note');
  await expect(note).toHaveCount(1);
  await page.keyboard.type('Binario 9');
  await page.keyboard.press('Escape');
  await page.locator('.canvas').click({ position: { x: 900, y: 600 } });
  const noteBox = (await note.boundingBox())!;
  // Its left edge sticks out of the dialog that opens later, centred over the board.
  const aim = { x: noteBox.x + 8, y: noteBox.y + noteBox.height / 2 };

  const open = async () => {
    await page.locator('.toolbar__btn--canvas').click();
    await page.getByRole('menuitem', { name: 'Storyboard da sceneggiatura…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const dialog = await open();

  // Fixed to the viewport, centred, with the board behind it.
  const box = (await dialog.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(2);
  expect(await dialog.evaluate((d) => d.matches(':modal'))).toBe(true);
  expect(await dialog.evaluate((d) => d.closest('.canvas'))).toBeNull();
  expect(aim.x).toBeLessThan(box.x);

  // Panning the board does not move it, and a double click on it makes no note.
  await page.mouse.move(aim.x, aim.y);
  await page.mouse.wheel(200, 200);
  expect(await dialog.boundingBox()).toEqual(box);
  expect(await note.boundingBox()).toEqual(noteBox);
  await dialog.getByRole('heading', { name: 'Importa una sceneggiatura' }).dblclick();
  await expect(note).toHaveCount(1);
  await expect(dialog).toBeVisible();

  // Cancel is a button press, not the start of a text selection.
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await expect(dialog).toBeHidden();
  await expect(note).toHaveCount(1);
  await expect(page.locator('.card.is-selected')).toHaveCount(0);

  // A click on the board behind the open dialog closes it and selects nothing.
  const again = await open();
  await page.mouse.click(aim.x, aim.y);
  await expect(again).toBeHidden();
  await expect(note).toHaveCount(1);
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
});

/** Original synthetic PDF: a standard Courier screenplay, or an empty image-only stand-in. */
function scriptPdf(textLayer = true, pages = 1): Buffer {
  const rows: Array<[number, number, string]> = [];
  for (let i = 0; i < 5; i++) {
    const y = 740 - i * 130;
    rows.push([
      72,
      y,
      `${i + 1} ${i % 2 ? 'INT.' : 'EST.'} ROOM ${i + 1} - ${i % 2 ? 'NOTTE' : 'GIORNO'} ${i + 1}`,
    ]);
    rows.push([72, y - 28, 'A door opens.']);
    rows.push([220, y - 56, 'ELENA']);
    rows.push([150, y - 70, '(quietly)']);
    rows.push([150, y - 84, 'Hello.']);
  }
  const content = textLayer
    ? rows
        .map(([x, y, text]) => `BT /F1 12 Tf ${x} ${y} Td (${text.replace(/[()]/g, '\\$&')}) Tj ET`)
        .join('\n')
    : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, () => '3 0 R').join(' ')}] /Count ${pages} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function capture294(page: Page, state: string) {
  if (!process.env.SHOTS_294) return;
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${process.env.SHOTS_294}/${state}.png`, animations: 'disabled' });
}

for (const theme of ['dark', 'light'] as const) {
  for (const phone of [false, true]) {
    test(`PDF drop, preloaded preview and undo (${theme}, ${phone ? 'phone' : 'desktop'})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('inkadra.theme', value), theme);
      await signedIn(page);
      // A project of its own: with no storyboard yet, the one made from the drop is the first,
      // and the sidebar's Storyboard row counts its frames.
      const response = await page.request.post('/api/v1/projects', {
        headers: { origin: new URL(page.url()).origin },
        data: { name: 'Screenplay drop' },
      });
      expect(response.ok()).toBe(true);
      const { id: dropProjectId, rootBoardId } = await response.json();
      await page.goto(`/p/${dropProjectId}/b/${rootBoardId}`);
      await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
      if (phone) await page.setViewportSize({ width: 390, height: 844 });
      const dt = await page.evaluateHandle(
        (bytes) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([new Uint8Array(bytes)], 'five-scenes.pdf', { type: 'application/pdf' }),
          );
          return transfer;
        },
        [...scriptPdf()],
      );
      await page
        .locator('.canvas')
        .dispatchEvent('drop', { dataTransfer: dt, clientX: phone ? 75 : 400, clientY: 260 });
      const hint = page.locator('.screenplay-hint');
      await expect(hint).toBeVisible({ timeout: 20_000 });
      // The card shows the PDF once the server has processed it, not the placeholder.
      await expect(page.locator('.card--file').first()).not.toContainText('Elaborazione', {
        timeout: 60_000,
      });
      await capture294(page, `${theme}-${phone ? 'phone' : 'desktop'}-hint`);
      await page.getByRole('button', { name: 'Altre azioni', exact: true }).click();
      await expect(
        page.getByRole('menuitem', { name: 'Crea storyboard da questa sceneggiatura…' }),
      ).toBeVisible();
      await capture294(page, `${theme}-${phone ? 'phone' : 'desktop'}-menu`);
      await page.keyboard.press('Escape');
      await hint.getByRole('button', { name: 'Crea storyboard…', exact: true }).focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
      await expect(dialog.getByText('Crea 5 scene e 5 inquadrature.')).toBeVisible();
      await expect(dialog.locator('.script-import__cast')).toContainText('Elena');
      await capture294(page, `${theme}-${phone ? 'phone' : 'desktop'}-preview`);
      const before = await page.locator('.card--board').count();
      // On the phone the navigation is a drawer, closed here.
      const shots = page.getByRole('link', { name: /^Storyboard/ }).first();
      if (!phone) await expect(shots).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
      await expect(page.locator('.card--board')).toHaveCount(before + 1);
      await expect(page.locator('.card--board').last()).toContainText('5 card');
      // The new storyboard is the project's first: the sidebar counts its frames now, without
      // waiting for the server to store the board.
      if (!phone)
        await expect(shots).toHaveAttribute('data-ink-tooltip', /5 inquadrature/, {
          timeout: 1500,
        });
      await capture294(page, `${theme}-${phone ? 'phone' : 'desktop'}-imported`);
      await page.locator('.toast').getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(page.locator('.card--board')).toHaveCount(before);
      await expect(page.getByRole('link', { name: /^Sceneggiatura/ })).toHaveCount(0);
      if (!phone) await expect(shots).toHaveCount(0);
      await expect(page.locator('.card--file').last()).toBeVisible();
      // Use the existing entry point to verify all PDF errors in the actual worker.
      await page.locator('.toolbar__btn--canvas').click();
      await page.getByRole('menuitem', { name: 'Storyboard da sceneggiatura…' }).click();
      for (const [buffer, error] of [
        [scriptPdf(false), 'Questo PDF non ha un livello di testo'],
        [scriptPdf(true, 301), 'Il PDF supera il limite di 300 pagine.'],
        [Buffer.alloc(5 * 1024 * 1024 + 1), /5 MB/],
        [Buffer.from('%PDF-1.7\nmalformed'), /PDF|leggere|valido/],
      ] as const) {
        await dialog
          .getByLabel('Scegli un file')
          .setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer });
        await expect(dialog.locator('.script-import__drop [role="alert"]')).toContainText(error);
        if (typeof error === 'string' && error.startsWith('Questo'))
          await capture294(page, `${theme}-${phone ? 'phone' : 'desktop'}-no-text`);
      }
      await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    });
  }
}
