import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { buildScriptPdf } from '../../apps/web/src/board/film/screenplay/fixtures/script-pdf.ts';
import { pushBoardDoc, signIn, uploadFile } from './perf/seed.ts';

test('QA a screenplay PDF can be read beyond its first page on the board', async ({
  page,
  baseURL,
}) => {
  const cookie = await signIn(baseURL!, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL! };
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'QA PDF reader' },
  });
  const project = await response.json();
  const assetId = await uploadFile(baseURL!, cookie, project.id, {
    body: Buffer.from(await buildScriptPdf()),
    name: 'screenplay.pdf',
    type: 'application/pdf',
  });
  expect(assetId).toBeTruthy();
  const doc = createBoardDoc(project.rootBoardId);
  createElement(doc, 'file', { x: 60, y: 60 }, { assetId: assetId!, w: 400 }, { userId: null });
  await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await page.locator('.card--file').dblclick();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  if (await viewer.locator('canvas').count())
    await expect(viewer.locator('canvas:not([hidden])')).toBeVisible();
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/04-pdf-reader-first.png` });
  await viewer.getByRole('button', { name: 'Pagina successiva' }).click();
  await expect(viewer.locator('canvas:not([hidden])')).toHaveAttribute('aria-label', /pagina 2 di/);
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/04-pdf-reader-second.png` });
  await viewer.getByRole('button', { name: 'Pagina precedente' }).click();
  await expect(viewer.locator('canvas:not([hidden])')).toHaveAttribute('aria-label', /pagina 1 di/);
});
