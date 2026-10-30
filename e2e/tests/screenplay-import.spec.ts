import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const fixtures = new URL('../../apps/web/src/board/film/screenplay/fixtures/', import.meta.url);
let seeded: { projectId: string; storyboardId: string };

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
  seeded = { projectId: project.id, storyboardId: storyboard.id };
});

async function openStoryboard(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.goto(`/p/${seeded.projectId}/b/${seeded.storyboardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
}

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
