// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Settings → Classifications: the storyboard lists are catalogs of the instance, and frames keep
// what they hold. Set E2E_SHOTS to a folder to capture the states of the approved mockup.
import { readFile } from 'node:fs/promises';
import { addFrame, addScene } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { ClassificationCatalogs } from '@inkadra/shared';
import { expect, type Page, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSelect } from '../helpers/select.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null } as const;
const FREE_TEXT = 'Carrello in diagonale';

test.use({ locale: 'it-IT' });

async function pdfText(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  let text = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += `${content.items.map((i) => ('str' in i ? i.str : '')).join(' ')}\n`;
  }
  return text;
}

/** Every combination of the review list: both themes, desktop and phone. */
async function shoot(page: Page, name: string, setup?: () => Promise<void>) {
  if (!shots) return;
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => localStorage.setItem('inkadra.theme', value), theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.locator('.catalogs__group, .catalogs__loading, [role=alert]').first()).toBeVisible();
      await setup?.();
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('frames keep their values while admins change the storyboard lists', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base };
    }),
  );
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `Classificazioni ${Date.now()}`, type: 'short_film' }),
  });
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const doc = createBoardDoc(project.rootBoardId);
  const scene = addScene(doc, { number: '1', title: 'Ponte' }, opts);
  addFrame(doc, scene.id, null, { action: 'Rinominata', shot: 'ms' }, opts);
  addFrame(doc, scene.id, null, { action: 'Archiviata', shot: 'cu', angle: 'dutch' }, opts);
  addFrame(doc, scene.id, null, { action: 'Libera', movement: FREE_TEXT }, opts);
  addFrame(doc, scene.id, null, { action: 'Nuova' }, opts);
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);

  const added = `Totale ${Date.now().toString(36)}`;
  const initial = (await (
    await fetch(`${base}/api/v1/instance/classifications`, { headers })
  ).json()) as ClassificationCatalogs;

  try {
    // The page: five closed catalogs in two groups.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/settings?section=classifications');
    await expect(page.locator('.catalogs__card')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'Storyboard', exact: true })).toBeVisible();
    await shoot(page, '01-closed');

    const openCampo = async () => {
      await page.getByRole('button', { name: /^Campo\b/ }).click();
    };
    const editCampo = async () => {
      await openCampo();
      const names = page.locator('.catalogs__name');
      await names.nth(3).fill('Piano americano');
      await page.locator('.catalogs__row').nth(5).getByRole('button', { name: 'Archivia' }).click();
    };
    await shoot(page, '02-open-edited', editCampo);

    await shoot(page, '03-duplicate', async () => {
      await openCampo();
      await page.locator('.catalogs__name').nth(3).fill('Primo piano');
      await expect(page.getByText('Esiste già un valore con questo nome.')).toBeVisible();
    });

    // The real edit: a rename, an archive and a new value.
    await page.reload();
    await editCampo();
    await expect(page.getByText('Rinominato')).toBeVisible();
    await expect(page.getByText('Modifiche non salvate')).toBeVisible();
    await page.getByRole('button', { name: 'Aggiungi valore' }).click();
    await page.locator('.catalogs__name').last().fill(added);
    await page.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Salvato.');
    await shoot(page, '04-saved', openCampo);

    const saved = (await (
      await fetch(`${base}/api/v1/instance/classifications`, { headers })
    ).json()) as ClassificationCatalogs;
    expect(saved.shotSizes.map((o) => o.id).slice(0, 8)).toEqual(
      initial.shotSizes.map((o) => o.id).slice(0, 8),
    );
    expect(saved.shotSizes.find((o) => o.id === 'ms')?.label).toBe('Piano americano');
    expect(saved.shotSizes.find((o) => o.id === 'cu')?.archived).toBe(true);

    // Shot list: each frame reads its value, and the menu offers only the active ones.
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=shotlist`);
    const row = (text: string) => page.locator('tr', { hasText: text }).first();
    await expect(row('Rinominata')).toContainText('Piano americano');
    await expect(row('Archiviata')).toContainText('Primo piano');
    await expect(row('Archiviata')).toContainText('Inclinata');
    await expect(row('Libera').getByRole('textbox', { name: 'Movimento' })).toHaveValue(FREE_TEXT);

    const menu = row('Nuova').getByRole('combobox', { name: 'Campo', exact: true });
    await menu.click();
    const list = page.getByRole('listbox');
    await expect(list.getByRole('option', { name: 'Piano americano', exact: true })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Altro…', exact: true })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Primo piano', exact: true })).toHaveCount(0);
    await expect(list.getByRole('option', { name: 'Mezza figura', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await chooseSelect(menu, { label: added });
    await expect(row('Nuova')).toContainText(added);

    // The archived value stays on its frame's menu.
    await row('Archiviata').getByRole('combobox', { name: 'Campo', exact: true }).click();
    await expect(page.getByRole('listbox').getByRole('option', { name: 'Primo piano', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    if (shots) {
      await menu.click();
      await page.screenshot({ path: `${shots}/05-frame-menu-1280.png` });
      await page.keyboard.press('Escape');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${shots}/06-shotlist-1280.png` });
    }

    // Export: the same names on paper.
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=storyboard`);
    await page.getByRole('button', { name: 'Esporta PDF' }).click();
    const exporter = page.getByRole('dialog', { name: /Esporta/ });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exporter.getByRole('button', { name: 'Esporta', exact: true }).click(),
    ]);
    const path = info.outputPath('storyboard.pdf');
    await download.saveAs(path);
    const text = await pdfText(path);
    expect(text).toContain('Piano americano');
    expect(text).toContain('Primo piano');
    expect(text).toContain(added);
    expect(text).toContain(FREE_TEXT);

    // Guests: the names come with the link, and no account endpoint is called.
    const link = await fetch(`${base}/api/v1/boards/${project.rootBoardId}/share-links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: 'guest_approve', label: 'Regia' }),
    });
    const { url } = (await link.json()) as { url: string };
    const context = await browser.newContext({ locale: 'it-IT' });
    const guest = await context.newPage();
    const asked: string[] = [];
    guest.on('request', (r) => {
      if (r.url().includes('/instance/classifications')) asked.push(r.url());
    });
    const snapshots: Promise<unknown>[] = [];
    guest.on('response', (r) => {
      if (/\/guest\/links\/[^/]+\/boards\/[^/]+$/.test(new URL(r.url()).pathname) && r.ok())
        snapshots.push(r.json());
    });
    await guest.goto(url);
    const frame = guest.locator('[data-el]', { hasText: 'Rinominata' }).first();
    await expect(frame).toBeVisible({ timeout: 20_000 });
    await frame.click();
    const panel = guest.locator('.film-panel');
    await expect(panel).toContainText('Piano americano');
    if (shots) await guest.screenshot({ path: `${shots}/07-guest-panel-1280.png` });
    expect(asked).toEqual([]);
    // What is stored did not change: a code, not the new name.
    const snapshot = JSON.stringify(await Promise.all(snapshots));
    expect(snapshot).toContain('"shot":"ms"');
    expect(snapshot).not.toContain('"shot":"Piano americano"');
    expect(snapshot).toContain(FREE_TEXT);
    await context.close();

    // The states with no real data behind them.
    if (shots) {
      await page.goto('/settings?section=classifications');
      await shoot(page, '08-empty', async () => {
        await page.getByRole('button', { name: /^Angolazione\b/ }).click();
        const body = page.locator('.catalogs__card', { hasText: 'Angolazione' });
        for (const button of await body.getByRole('button', { name: 'Archivia' }).all())
          await body.getByRole('button', { name: 'Archivia' }).first().click({ noWaitAfter: true }).catch(() => button);
      });
      await page.route('**/api/v1/instance/classifications', (route) =>
        route.request().method() === 'GET' ? route.fulfill({ status: 500, json: {} }) : route.fallback(),
      );
      await shoot(page, '09-error');
      await page.unroute('**/api/v1/instance/classifications');
    }
  } finally {
    // Other specs run on this instance and expect the default names.
    const current = (await (
      await fetch(`${base}/api/v1/instance/classifications`, { headers })
    ).json()) as ClassificationCatalogs;
    const shotSizes = current.shotSizes.map((o) => {
      const before = initial.shotSizes.find((i) => i.id === o.id);
      return before ?? { ...o, archived: true };
    });
    await fetch(`${base}/api/v1/instance/classifications`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...current, shotSizes }),
    });
  }
});
