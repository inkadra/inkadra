import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// Runs after first-run.spec.ts: the administrator exists.
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.REPORT_SCREENSHOTS;

test('the export options fill the column, with nothing cut and no gap', async ({
  page,
  baseURL,
}) => {
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
  const project = await post<{ id: string; rootBoardId: string }>('/projects', { name: 'Opzioni' });
  const board = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Sequenza',
  });
  const doc = new Y.Doc();
  initBoardDoc(doc, board.id);
  const scene = addScene(doc, { number: '1', title: 'Apertura' }, { userId: null });
  addFrame(doc, scene.id, null, { action: 'Salita' }, { userId: null });
  await pushBoardDoc(base, cookie, board.id, doc);

  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();

  for (const [name, width, height] of [
    ['wide', 2560, 1271],
    ['laptop', 1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/p/${project.id}/b/${board.id}`);
    await page.getByRole('button', { name: 'Esporta PDF' }).click();
    const dialog = page.getByRole('dialog', { name: /Esporta/ });
    const options = dialog.locator('.export__pdf-options');
    await expect(options).toBeVisible();
    await expect(dialog.locator('.export__canvas')).toBeVisible();
    await page.waitForTimeout(500);
    const fit = await dialog.evaluate((el) => {
      const bottom = (s: string) => (el.querySelector(s) as Element).getBoundingClientRect().bottom;
      return {
        gap: bottom('.export') - bottom('.export__pdf-options'),
        overflow: el.scrollHeight - el.clientHeight,
      };
    });
    expect(fit.gap).toBeLessThan(2);
    expect(fit.overflow).toBeLessThanOrEqual(1);
    await options.locator('label').last().scrollIntoViewIfNeeded();
    await expect(options.locator('label').last()).toBeInViewport();
    if (shots) await page.screenshot({ path: `${shots}/export-fit-${name}.png` });
    await page.keyboard.press('Escape');
  }
});
