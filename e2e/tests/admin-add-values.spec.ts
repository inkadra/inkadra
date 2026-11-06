import { addFrame, addScene } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
const shots = process.env.REPORT_SCREENSHOTS;

test('an administrator adds tags and shot values from the frame panel', async ({
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
  const project = await post<{ id: string; rootBoardId: string }>('/projects', {
    name: 'Valori nuovi',
  });
  const storyboard = await post<{ id: string }>(`/projects/${project.id}/boards`, {
    parentBoardId: project.rootBoardId,
    kind: 'storyboard',
    title: 'Sequenza',
  });
  const doc = new Y.Doc();
  initBoardDoc(doc, storyboard.id);
  const scene = addScene(doc, { number: '1', title: 'Apertura' }, { userId: null });
  addFrame(doc, scene.id, null, { action: 'Salita' }, { userId: null });
  await pushBoardDoc(base, cookie, storyboard.id, doc);

  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.goto(`/p/${project.id}/b/${storyboard.id}`);
  await page.locator('.story__tile').first().click();

  const tags = page.getByRole('textbox', { name: 'Aggiungi un tag' });
  await tags.fill('Tramonto');
  await tags.press('Enter');
  await expect(page.locator('.tag-editor .tag-chip', { hasText: 'Tramonto' })).toBeVisible();

  const movement = page.locator('.film-field', { hasText: 'Movimento' });
  const picker = movement.locator('.ink-select');
  await picker.click();
  await page.getByRole('option', { name: 'Altro…' }).click();
  await movement.locator('input').fill('Drone in salita');
  await movement.locator('input').press('Enter');
  await expect(picker).toHaveText(/Drone in salita/);
  await expect(movement.locator('input')).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/admin-values.png` });

  const saved = await fetch(`${base}/api/v1/instance/classifications`, {
    headers: { cookie, origin: base },
  }).then((r) => r.json());
  expect(saved.tags.map((o: { label: string }) => o.label)).toContain('Tramonto');
  expect(saved.shotMovements.map((o: { label: string }) => o.label)).toContain('Drone in salita');
});
