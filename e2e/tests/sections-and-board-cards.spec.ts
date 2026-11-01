// SPDX-License-Identifier: AGPL-3.0-only
// Coloured columns (#307), section headings (#318) and board cards with icon and counts (#322).
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile } from './perf/seed.ts';

const out = process.env.BOARD_ELEMENTS_SHOTS ?? join(tmpdir(), 'inkadra-board-elements');
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };

async function seed(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const headers = { origin: baseURL };
  const created = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Val Bregaglia' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  // A real file for the file cards, so they show its name.
  const assetId =
    (await uploadFile(baseURL, cookie, project.id, {
      body: Buffer.from('Permessi di parcheggio a Loreto, 09:00–18:00.\n'),
      name: 'permessi.txt',
      type: 'text/plain',
    })) ?? '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a1f';

  // Two sub-boards with an icon and some content, as in the approved mockup.
  const sub = async (title: string, icon: object, cards: number, files: number) => {
    const res = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: root, title },
    });
    const board = await res.json();
    expect(
      (await page.request.patch(`/api/v1/boards/${board.id}`, { headers, data: { icon } })).ok(),
    ).toBe(true);
    const doc = createBoardDoc(board.id);
    for (let i = 0; i < cards; i++)
      createElement(doc, 'note', { x: (i % 6) * 260, y: Math.floor(i / 6) * 120 }, {}, opts);
    for (let i = 0; i < files; i++)
      createElement(doc, 'file', { x: i * 260, y: 900 }, { assetId }, opts);
    await pushBoardDoc(baseURL, cookie, board.id, doc);
    return board.id as string;
  };
  const plane = await sub('Aereo', { shape: 'triangle', color: 'teal' }, 6, 3);
  const route = await sub('Itinerario', { shape: 'star', color: 'orange' }, 14, 0);

  const doc = createBoardDoc(root);
  const section = createElement(
    doc,
    'section',
    { x: 60, y: 40 },
    { title: 'Sequenza 1 · La preparazione', w: 640, moveCards: true },
    opts,
  );
  const todo = createElement(doc, 'column', { x: 60, y: 120 }, { title: 'Da fare', w: 210 }, opts);
  for (const text of ['Itinerario sopralluogo', 'Permessi parcheggio', 'Noleggio drone'])
    createElement(doc, 'todo', { x: 0, y: 0 }, { title: text, items: [], parent: todo.id }, opts);
  const info = createElement(
    doc,
    'column',
    { x: 290, y: 120 },
    { title: 'Info KV', color: 'green', w: 210 },
    opts,
  );
  for (const text of ['Partenza 09:15 · Loreto', 'Arrivo Lagunc · 1371 m'])
    createElement(doc, 'todo', { x: 0, y: 0 }, { title: text, items: [], parent: info.id }, opts);
  createElement(doc, 'file', { x: 0, y: 0 }, { assetId, parent: info.id }, opts);
  const planeCard = createElement(doc, 'board', { x: 520, y: 120 }, { boardId: plane }, opts);
  createElement(doc, 'board', { x: 520, y: 210 }, { boardId: route }, opts);
  // Outside the section's width: stays when the heading moves.
  const aside = createElement(doc, 'color', { x: 900, y: 120 }, { hex: '#56CCF2' }, opts);
  await pushBoardDoc(baseURL, cookie, root, doc);

  // The server stores boards shortly after the last edit: wait for the counts the cards show.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/projects/${project.id}/board-counts`);
        const { items } = await res.json();
        return items.find((c: { boardId: string }) => c.boardId === plane)?.fileCount;
      },
      { timeout: 20_000 },
    )
    .toBe(3);
  return {
    cookie,
    project,
    ids: {
      section: section.id,
      todo: todo.id,
      info: info.id,
      planeCard: planeCard.id,
      aside: aside.id,
    },
  };
}

for (const theme of ['dark', 'light'] as const) {
  test(`board elements: coloured columns, section headings, board cards (${theme})`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const { cookie, project, ids } = await seed(page, baseURL!, theme);
    const root = project.rootBoardId as string;
    await page.goto(`/p/${project.id}?view=canvas`);
    const el = (id: string) => page.locator(`[data-el="${id}"]`);

    // Board cards: the target board's icon on its colour, and what it holds.
    await expect(el(ids.planeCard)).toContainText('Aereo');
    await expect(el(ids.planeCard)).toContainText('6 card · 3 file');
    await expect(page.locator('[data-type="board"]', { hasText: 'Itinerario' })).toContainText(
      '14 card',
    );
    await expect(el(ids.info)).toHaveClass(/card--accent-green/);
    await expect(el(ids.info)).toContainText('2 card · 1 file');

    // A column takes its colour from the selection bar.
    await el(ids.todo).locator('.column__head').click();
    await page
      .getByRole('toolbar', { name: 'Azioni sulla selezione' })
      .getByRole('button', { name: 'Arancio' })
      .click();
    await expect(el(ids.todo)).toHaveClass(/card--accent-orange/);
    await expect(el(ids.todo)).toContainText('3 card');
    await page.keyboard.press('Escape');
    await page.mouse.click(1200, 700);
    await page.screenshot({ path: join(out, `desktop-${theme}-board.png`) });

    if (theme === 'dark') {
      const at = async (id: string) => {
        const saved = await readBoard(baseURL!, cookie, root);
        const map = roots(saved).elements.get(id);
        const read = map ? readElement(map) : null;
        return read ? { x: read.x, y: read.y } : null;
      };
      const drag = async (dy: number, alt = false) => {
        const box = (await el(ids.section).boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + box.height / 2);
        if (alt) await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + box.height / 2 + dy / 2, { steps: 4 });
        await page.mouse.move(box.x + 40, box.y + box.height / 2 + dy, { steps: 4 });
        await page.mouse.up();
        if (alt) await page.keyboard.up('Alt');
      };
      // The heading moves the cards under it, not those beside it (snapping may round the
      // distance, the same for all of them).
      await drag(100);
      await expect.poll(async () => (await at(ids.section))?.y).toBeGreaterThan(100);
      const moved = (await at(ids.section))!.y - 40;
      expect(await at(ids.todo)).toEqual({ x: 60, y: 120 + moved });
      expect(await at(ids.planeCard)).toEqual({ x: 520, y: 120 + moved });
      expect(await at(ids.aside)).toEqual({ x: 900, y: 120 });
      // With Alt it moves alone, without snapping.
      await drag(-60, true);
      await expect.poll(async () => (await at(ids.section))?.y).toBeLessThan(40 + moved);
      expect(await at(ids.todo)).toEqual({ x: 60, y: 120 + moved });

      // A new heading comes from the Canvas menu, and the toggle sits in its menu.
      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Titolo di sezione' }).click();
      await page.keyboard.type('Sequenza 2 · Il fiume');
      await page.keyboard.press('Enter');
      const fresh = page.locator('[data-type="section"]', { hasText: 'Sequenza 2' });
      await fresh.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sposta insieme alle card sotto' }).click();
      await fresh.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: 'Sposta solo il titolo' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });
}
