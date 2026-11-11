// SPDX-License-Identifier: AGPL-3.0-only
// Outputs of the set plan (decision 0111): the card on the board, the export dialog and its PDF
// sheet with the legend and the power, and the read-only view of a guest.
// Runs after first-run.spec.ts in CI; alone, it signs up.
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFrame, createElement } from '@inkadra/canvas-core';
import { createBoardDoc, STROKE_GRID } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
const g = (v: number) => Math.round(v * STROKE_GRID);

test.use({ locale: 'it-IT' });

async function pdfText(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  let text = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += `${content.items.map((i) => ('str' in i ? i.str : '')).join(' ')}\n`;
  }
  return { text, pages: pdf.numPages };
}

test('set plan outputs: card, PDF sheet with legend and power, guest view', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const cookie = await signIn(baseURL!, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
    }),
  );
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'Cortometraggio · uscite della pianta' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const scene = createElement(
    doc,
    'scene',
    { x: 60, y: 640 },
    { number: '2', title: '', location: 'Tavola calda', setting: 'int', time: 'night' },
    opts,
  );
  const frame = addFrame(doc, scene.id, null, { action: 'Master', lens: '32mm' }, opts);
  const leo = createElement(doc, 'character', { x: 640, y: 120 }, { name: 'Leo' }, opts);
  const icon = (id: string, kind: string, x: number, y: number, extra = {}) => ({
    id: `icon${id}`.padEnd(13, 'A'),
    kind,
    color: '#9DB8F2',
    x: g(x),
    y: g(y),
    ...extra,
  });
  const plan = createElement(
    doc,
    'plan',
    { x: 60, y: 120 },
    {
      w: 480,
      title: 'Bancone',
      sceneIds: [scene.id],
      circuits: [{ id: 'circuitAAAAAA', name: 'Circuito A', amps: 16 }],
      icons: [
        icon('Cam', 'camera', 0.5, 0.85, { label: 'A cam', frameId: frame.id, rotation: 270 }),
        icon('Key', 'fresnel', 0.2, 0.3, {
          label: 'Chiave',
          watts: 2000,
          kelvin: 3200,
          circuit: 'circuitAAAAAA',
          note: 'Lontano dal muro di fondo',
        }),
        icon('Leo', 'actor', 0.5, 0.45, { label: 'vecchio', characterId: leo.id }),
      ],
    },
    opts,
  );
  createElement(
    doc,
    'plan',
    { x: 60, y: 520 },
    { w: 300, variantOf: plan.id, variant: 'Primo piano', icons: [] },
    opts,
  );
  await pushBoardDoc(baseURL!, cookie, root, doc);
  await page.goto(`/p/${project.id}/b/${root}?view=canvas`);

  await test.step('the card shows the counts of the mockup', async () => {
    const card = page.locator(`[data-el="${plan.id}"]`);
    await expect(card.locator('.plan__count')).toHaveText(['2 setup', '1 camera', '1 luce · 2 kW']);
    await expect(card.getByRole('button', { name: 'Scena 2' })).toBeVisible();
  });

  await test.step('the export dialog makes a PDF with the legend and the power', async () => {
    await page.locator(`[data-el="${plan.id}"]`).dblclick();
    const editor = page.getByRole('dialog', { name: 'Pianta del set · Bancone' });
    await editor.getByRole('button', { name: 'Esporta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Esporta la pianta del set' });
    await expect(dialog.getByRole('radio', { name: 'Tutti i 2 della scena 2' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Legenda' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Potenza' })).toBeChecked();
    await expect(dialog.locator('.plan-export__paper')).toHaveAttribute('data-status', 'ready');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Esporta PDF' }).click(),
    ]);
    const file = join(tmpdir(), `plan-${Date.now()}.pdf`);
    await download.saveAs(file);
    const { text, pages } = await pdfText(file);
    // One page per setup.
    expect(pages).toBe(2);
    for (const expected of [
      'SCENA 2',
      'Setup 1 · Base',
      'Setup 2 · Primo piano',
      'A cam',
      '32 mm',
      'Chiave',
      '3200 K',
      // The actor's live name, not the text it holds.
      'Leo',
      'POTENZA A 230 V',
      '2 kW · 8,7 A',
      'Circuito A · 16 A: Chiave',
      'Lontano dal muro di fondo',
      'pagina 1 di 2',
    ])
      expect(text).toContain(expected);
    expect(text).not.toContain('vecchio');
  });

  await test.step('a guest sees the plan, the setups, the legend and the power', async () => {
    const link = await fetch(`${baseURL}/api/v1/boards/${root}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseURL!, cookie },
      body: JSON.stringify({ role: 'guest_approve', label: 'Regia' }),
    });
    expect(link.ok).toBe(true);
    const { url } = (await link.json()) as { url: string };
    const guest = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'it-IT',
    });
    try {
      const view = await guest.newPage();
      await view.goto(url);
      await view.locator(`[data-el="${plan.id}"]`).dblclick();
      const viewer = view.getByRole('dialog', { name: /Pianta del set/ });
      await expect(viewer.getByText('Sola lettura')).toBeVisible();
      await expect(viewer.getByRole('tab')).toHaveText(['1 · Base', '2 · Primo piano']);
      const legend = viewer.getByRole('complementary', { name: 'Legenda' });
      await expect(legend).toContainText('A cam · 32 mm');
      await expect(legend).toContainText('Leo');
      await expect(legend).toContainText('Potenza a 230 V');
      await expect(legend).toContainText('Circuito A · 16 A: Chiave');
      // Pan and zoom: the wheel zooms, a drag moves the sheet.
      const stage = viewer.locator('.plan-view__stage');
      const box = (await stage.boundingBox())!;
      await view.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await view.mouse.wheel(0, -200);
      await expect(viewer.getByRole('button', { name: '110%' })).toBeVisible();
      await viewer.getByRole('tab', { name: '2 · Primo piano' }).click();
      await expect(viewer.getByRole('tab', { name: '2 · Primo piano' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const [download] = await Promise.all([
        view.waitForEvent('download'),
        viewer.getByRole('button', { name: 'PDF' }).click(),
      ]);
      const file = join(tmpdir(), `guest-plan-${Date.now()}.pdf`);
      await download.saveAs(file);
      expect((await pdfText(file)).text).toContain('Setup 2 · Primo piano');
      await viewer.getByRole('button', { name: 'Chiudi' }).click();
      await expect(viewer).toHaveCount(0);
    } finally {
      await guest.close();
    }
  });
});
