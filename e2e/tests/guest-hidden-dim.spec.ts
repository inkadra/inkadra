// SPDX-License-Identifier: AGPL-3.0-only
// Cards hidden from guests read quieter for editors (#30): a dashed edge and the grey app
// surface, never opacity on text, so nothing compounds inside a hidden column and every text
// token keeps its WCAG AA contrast.
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, type Locator, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn } from './perf/seed.ts';

function write(doc: Y.Doc, id: string, text: string) {
  const body = roots(doc).elements.get(id)?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  body.insert(0, [p]);
}

/** The opacity the text really gets: the product of its own and every ancestor's. */
function effectiveOpacity(text: Locator) {
  return text.evaluate((el) => {
    let value = 1;
    for (let node: Element | null = el; node; node = node.parentElement)
      value *= Number(getComputedStyle(node).opacity);
    return Math.round(value * 100) / 100;
  });
}

test('a card hidden from guests reads quieter without dimming its text, also inside a hidden column', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const cookie = await signIn(base, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { origin: base },
      data: { name: 'Hidden from guests' },
    })
  ).json();
  const doc = createBoardDoc(project.rootBoardId);
  const o = { userId: null };
  const shown = createElement(doc, 'note', { x: 24, y: 150 }, { w: 260 }, o);
  write(doc, shown.id, 'Shown to guests');
  const hidden = createElement(doc, 'note', { x: 320, y: 150 }, { w: 260, guestHidden: true }, o);
  write(doc, hidden.id, 'Hidden note');
  const column = createElement(
    doc,
    'column',
    { x: 620, y: 150 },
    { title: 'Hidden column', w: 280, guestHidden: true },
    o,
  );
  const inner = createElement(doc, 'note', { x: 0, y: 0 }, { parent: column.id }, o);
  write(doc, inner.id, 'Inside the hidden column');
  await pushBoardDoc(base, cookie, project.rootBoardId, doc);
  await page.goto('/');
  await page.evaluate(
    (id) => localStorage.setItem(`inkadra.viewport.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
    project.rootBoardId,
  );
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}?view=canvas`);

  const card = (id: string) => page.locator(`[data-el="${id}"]`);
  await expect(card(inner.id).getByText('Inside the hidden column')).toBeVisible();
  expect(await effectiveOpacity(card(shown.id).getByText('Shown to guests'))).toBe(1);
  expect(await effectiveOpacity(card(hidden.id).getByText('Hidden note'))).toBe(1);
  expect(await effectiveOpacity(card(inner.id).getByText('Inside the hidden column'))).toBe(1);
  expect(await effectiveOpacity(card(column.id).getByText('Hidden column', { exact: true }))).toBe(
    1,
  );
  for (const id of [hidden.id, column.id, inner.id])
    await expect(card(id)).toHaveCSS('border-top-style', 'dashed');
  await expect(card(shown.id)).toHaveCSS('border-top-style', 'solid');
  const surface = (id: string) => card(id).evaluate((el) => getComputedStyle(el).backgroundColor);
  const appBg = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--ink-bg-app)';
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  expect(await surface(hidden.id)).toBe(appBg);
  expect(await surface(inner.id)).toBe(appBg);
  expect(await surface(shown.id)).not.toBe(appBg);
  // E2E_SHOTS: a folder for the two themes of the board, to review the dimming.
  const shots = process.env.E2E_SHOTS;
  if (!shots) return;
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((v) => {
      localStorage.setItem('inkadra.theme', v);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.mouse.move(5, 500);
    await page.screenshot({ path: `${shots}/hidden-column-${theme}.png` });
  }
});
