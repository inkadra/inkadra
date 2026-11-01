// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addTodoItem, createElement, updateElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { perfUser, pushBoardDoc, signIn } from './perf/seed.ts';

// #323: to-do lists typed Costumi / Attrezzeria / Attrezzatura and linked to a scene roll up
// in the shooting day's "Da portare", with one checked state shared with the board.
const out = process.env.NEEDED_SHOTS ?? join(tmpdir(), 'inkadra-needed323');

for (const theme of ['dark', 'light'] as const)
  for (const phone of [false, true]) {
    test(`needed items by shooting day (${theme}, ${phone ? 'phone' : 'desktop'})`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      mkdirSync(out, { recursive: true });
      const prefix = `${phone ? 'phone' : 'desktop'}-${theme}`;
      const cookie = await signIn(baseURL!, perfUser);
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseURL! };
        }),
      );
      await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      await page.setViewportSize(
        phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      const headers = { origin: baseURL! };
      // Menus and sheets fade in: shoot them once their animations are over.
      const shot = async (name: string, fullPage = false) => {
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
              .map((a) => a.finished),
          ),
        );
        await page.screenshot({ path: join(out, name), fullPage });
      };
      const me = await (await page.request.get('/api/v1/me')).json();
      const project = await (
        await page.request.post('/api/v1/projects', {
          headers,
          data: { name: `Il sentiero ${prefix}` },
        })
      ).json();
      const board = await (
        await page.request.post(`/api/v1/projects/${project.id}/boards`, {
          headers,
          data: { parentBoardId: project.rootBoardId, title: 'Storyboard', kind: 'storyboard' },
        })
      ).json();

      const doc = createBoardDoc(board.id);
      const opts = { userId: me.id };
      const scene = (number: string, title: string, x: number) =>
        createElement(doc, 'scene', { x, y: 40 }, { number, title, w: 420 }, opts).id;
      const scenes = {
        s3: scene('3', 'La salita', 40),
        s5: scene('5', 'Il rifugio', 500),
        s8: scene('8', 'La discesa', 960),
      };
      const shots = Object.values(scenes).map(
        (parent) => createElement(doc, 'frame', { x: 0, y: 0 }, { parent }, opts).id,
      );
      const list = (
        sceneId: string,
        kind: 'wardrobe' | 'props' | 'equipment',
        items: Array<[string, { mine?: boolean; done?: boolean }?]>,
        title?: string,
      ) => {
        const id = createElement(
          doc,
          'todo',
          { x: 0, y: 0 },
          { items: [], parent: sceneId, ...(title ? { title } : {}) },
          opts,
        ).id;
        updateElement(doc, id, { list: kind, sceneId });
        for (const [text, flags = {}] of items) {
          const item = addTodoItem(doc, id, text)!;
          updateTodoItem(doc, id, item, {
            done: !!flags.done,
            ...(flags.mine ? { assigneeId: me.id } : {}),
          });
        }
        return id;
      };
      const wardrobe = list(
        scenes.s3,
        'wardrobe',
        [
          ['Giacca a vento rossa', { mine: true }],
          ['Scarponi da trekking ×2'],
          ['Cappello di lana', { mine: true, done: true }],
          ['Asciugamano'],
        ],
        'Serve per la scena',
      );
      list(scenes.s5, 'wardrobe', [['Asciugamano']]);
      list(scenes.s5, 'props', [['Thermos e due tazze di latta', { mine: true }]]);
      list(scenes.s8, 'props', [['Mappa cartacea', { mine: true, done: true }]]);
      list(scenes.s8, 'equipment', [['Pannello LED a batteria']]);
      await pushBoardDoc(baseURL!, cookie, board.id, doc);
      doc.destroy();

      const block = (shotId: string | null, type = 'shot') => ({
        id: randomUUID(),
        type,
        title: '',
        start: null,
        duration: 60,
        shotId,
        cast: [],
        departments: [],
      });
      for (const [date, blocks] of [
        ['2026-11-16', [block(null, 'setup')]],
        ['2026-11-17', shots.map((id) => block(id))],
      ] as const) {
        const day = await page.request.post(`/api/v1/boards/${board.id}/schedule`, {
          headers,
          data: {
            date,
            callTime: '06:30',
            wrap: null,
            location: 'Rifugio, Val di Mello',
            notes: '',
            blocks,
          },
        });
        expect(day.status()).toBe(201);
      }

      // The card shows its kind and scene; its menu picks them.
      await page.goto(`/p/${project.id}/b/${board.id}?view=canvas`);
      const card = page.locator(`[data-el="${wardrobe}"]`);
      await expect(card.locator('.needed-kind')).toHaveText('Costumi');
      await expect(card.locator('.card__todo-scene')).toHaveText('Sc. 3 · La salita');
      if (!phone) {
        await card.getByText('Serve per la scena', { exact: true }).click({ button: 'right' });
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitemradio', { name: 'Costumi' })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await shot(`${prefix}-card-menu.png`);
        await menu.getByRole('menuitem', { name: 'Scena: Sc. 3' }).click();
        await expect(
          page.getByRole('menu').getByRole('menuitemradio', { name: 'Sc. 3 · La salita' }),
        ).toHaveAttribute('aria-checked', 'true');
        await shot(`${prefix}-card-scene.png`);
        await page.keyboard.press('Escape');
      } else {
        // The phone opens the board zoomed out: centre the card and zoom in to read it.
        await page.goto(`/p/${project.id}/b/${board.id}?view=canvas&el=${wardrobe}`);
        // It centres the scene: zoom to 100 % and scroll down to the list below the frame.
        const zoomIn = page.getByRole('button', { name: 'Ingrandisci', exact: true });
        for (let i = 0; i < 8 && !(await page.getByText('100%', { exact: true }).isVisible()); i++)
          await zoomIn.click();
        await page.mouse.move(195, 300);
        await page.mouse.wheel(0, 260);
        await expect(card.getByRole('checkbox', { name: 'Giacca a vento rossa' })).toBeVisible();
        await shot(`${prefix}-card.png`);
      }

      // The day that shoots scenes 3, 5 and 8 lists what they need, duplicates merged.
      await page.goto(`/p/${project.id}/b/${board.id}?view=schedule`);
      await page.locator('.schedule__day-head').nth(1).click();
      const inspector = page.getByRole('complementary', { name: 'Dettagli del giorno di riprese' });
      await inspector.getByRole('tab', { name: /^Da portare/ }).click();
      await expect(inspector.getByRole('tab', { name: /^Da portare/ })).toContainText('7');
      await expect(inspector.locator('.needed__progress')).toContainText('2 di 7 pronti');
      const towel = inspector.locator('li').filter({ hasText: 'Asciugamano' });
      await expect(towel).toContainText('×2');
      await expect(towel).toContainText(phone ? 'Sc. 3, 5' : 'Sc. 3 · 5');
      await shot(`${prefix}-day.png`);
      if (phone) {
        await inspector.getByRole('radio', { name: 'Solo i miei' }).check();
        await expect(inspector.locator('.needed__group li')).toHaveCount(4);
        await shot(`${prefix}-day-mine.png`);
        await inspector.getByRole('radio', { name: 'Tutti' }).check();
      }
      // Ticking here ticks the item on the card: one state, no copy per day.
      await inspector.getByRole('checkbox', { name: 'Giacca a vento rossa' }).check();
      await expect(inspector.locator('.needed__progress')).toContainText('3 di 7 pronti');
      if (phone) await page.getByRole('button', { name: 'Chiudi', exact: true }).click();

      // The call sheet prints the same table, with empty boxes.
      await page.getByRole('button', { name: 'Foglio di lavorazione', exact: true }).click();
      const sheet = page.getByRole('article', { name: 'Anteprima foglio di lavorazione' });
      const table = sheet.locator('.sheet__section').filter({ hasText: 'Da portare' });
      await expect(table.locator('tbody tr')).toHaveCount(7);
      await expect(table.locator('tbody tr').filter({ hasText: 'Asciugamano ×2' })).toContainText(
        '3, 5',
      );
      if (!phone && theme === 'light') {
        await page.emulateMedia({ media: 'print' });
        await shot('call-sheet-print.png', true);
        await page.pdf({ path: join(out, 'call-sheet.pdf'), format: 'A4' });
        await page.emulateMedia({ media: 'screen' });
      }
      await shot(`${prefix}-call-sheet.png`);
      await page.keyboard.press('Escape');

      // The tick is on the card, for everyone and after a reload.
      if (phone) {
        await page.reload();
        await page.locator('.schedule__day-head').nth(1).click();
        await inspector.getByRole('tab', { name: /^Da portare/ }).click();
        await expect(
          inspector.getByRole('checkbox', { name: 'Giacca a vento rossa' }),
        ).toBeChecked();
      } else {
        await page.goto(`/p/${project.id}/b/${board.id}?view=canvas`);
        await expect(card.getByRole('checkbox', { name: 'Giacca a vento rossa' })).toBeChecked();
      }
    });
  }
