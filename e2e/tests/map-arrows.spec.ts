// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createArrow, createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out = fileURLToPath(new URL('../../docs/screenshots/0.6-arrows/', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** A relationship map of the fictional short "Ultimo Treno". */
function seed(boardId: string) {
  const doc = createBoardDoc(boardId);
  const opts = { userId: null };
  const note = (x: number, y: number, text: string, color?: string) => {
    const el = createElement(doc, 'note', { x, y }, { w: 200, ...(color ? { color } : {}) }, opts);
    const body = roots(doc).elements.get(el.id)?.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    body.insert(0, [p]);
    return el.id;
  };
  const marta = note(80, 80, 'Marta');
  const leo = note(560, 80, 'Leo');
  const station = note(80, 420, 'Stazione Centrale');
  const cabin = note(560, 420, 'Cabina del guardiano');
  const rects = new Map(
    [marta, leo, station, cabin].map((id) => {
      const el = readElement(roots(doc).elements.get(id)!)!;
      return [id, { x: el.x, y: el.y, w: el.w, h: 60 }];
    }),
  );
  const rectOf = (id: string) => rects.get(id) ?? null;
  const end = (id: string) => ({ elementId: id, ...rectOf(id)! });
  const arrow = (from: string, to: string, fields: Parameters<typeof createArrow>[4]) =>
    createArrow(doc, end(from), end(to), rectOf, fields, opts).id;
  arrow(marta, leo, { label: 'sorella', path: 'curved', heads: 'both' });
  arrow(marta, station, { label: 'aspetta l’ultimo treno', line: 'dashed' });
  arrow(leo, cabin, { label: 'lavora qui' });
  const plain = arrow(station, cabin, {});
  return { doc, plain };
}

async function open(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
    data: { name: 'Ultimo Treno', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  const { doc, plain } = seed(project.rootBoardId);
  await pushBoardDoc(baseURL, cookie, project.rootBoardId, doc);
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);
  await expect(page.locator('.arrows__label')).toHaveCount(3);
  return { cookie, project, plain };
}

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 412, 915],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`arrow labels and styles ${device} ${theme}`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height });
      const { cookie, project, plain } = await open(page, baseURL!, theme);
      await page.screenshot({ path: `${out}/${device}-${theme}-map.png` });

      // Double click the unlabeled arrow: the label is edited on the path.
      const line = page.locator(`[data-el="${plain}"] .arrows__hit`);
      await line.dblclick({ force: true });
      const input = page.getByRole('textbox', { name: 'Etichetta della freccia' });
      await expect(input).toBeFocused();
      await input.fill('di notte');
      await input.press('Enter');
      await expect(page.locator('.arrows__label', { hasText: 'di notte' })).toBeVisible();

      // Selection bar: path, line and ends, all reachable with the keyboard.
      await page.locator('.arrows__label', { hasText: 'di notte' }).click();
      const curve = page.getByRole('button', { name: 'Linea curva' });
      await expect(curve).toHaveAttribute('aria-pressed', 'false');
      await curve.focus();
      await page.keyboard.press('Enter');
      await expect(curve).toHaveAttribute('aria-pressed', 'true');
      await expect(line).toHaveAttribute('d', /Q/);
      await page.getByRole('button', { name: 'Linea tratteggiata' }).click();
      await page.getByRole('button', { name: 'Punte: una' }).click();
      await expect(page.getByRole('button', { name: 'Punte: entrambe' })).toBeVisible();
      await page.screenshot({ path: `${out}/${device}-${theme}-selected.png` });

      // Enter on the selected arrow edits its label; Escape keeps it.
      await page.locator('.canvas').focus();
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('di notte');
      await page.screenshot({ path: `${out}/${device}-${theme}-editing.png` });
      await page.keyboard.press('Escape');

      await expect
        .poll(async () => {
          const saved = await readBoard(baseURL!, cookie, project.rootBoardId);
          const map = roots(saved).elements.get(plain);
          return map ? readElement(map) : null;
        })
        .toMatchObject({ label: 'di notte', path: 'curved', line: 'dashed', heads: 'both' });
      // One project in the sidebar of the next screenshots.
      await page.request.delete(`/api/v1/projects/${project.id}`, {
        headers: { origin: baseURL! },
      });
    });
  }
}
