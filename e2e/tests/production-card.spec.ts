// SPDX-License-Identifier: AGPL-3.0-only
// The card of the Production board (decision 0123): its next shooting day with the storyboards'
// dots, and its troupe to members. Runs after first-run.spec.ts in CI (the administrator
// exists); alone, it creates one.
// PRODUCTION_CARD_SHOTS=<folder> also saves the screenshots of the pull request there.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addFrame, addScene, createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const shots = process.env.PRODUCTION_CARD_SHOTS;
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
const SIZE = { w: 320, h: 260 };

/** A date `days` from today, as the server reads today (UTC without a project time zone). */
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const block = (type: string, title: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type,
  title,
  start: null,
  duration: 45,
  shotId: null,
  cast: [],
  departments: [],
  ...extra,
});

async function seed(page: Page, baseURL: string, theme: 'light' | 'dark', full: boolean) {
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
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers,
      data: { name: full ? 'Ultimo treno' : 'Progetto nuovo' },
    })
  ).json();
  const root = project.rootBoardId as string;
  const board = async (title: string, kind: string) => {
    const made = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: root, title, kind },
    });
    expect(made.status()).toBe(201);
    return ((await made.json()) as { id: string }).id;
  };
  const doc = createBoardDoc(root);
  // One above the other: both fit a phone.
  const card = (boardId: string, y: number) =>
    createElement(doc, 'board', { x: 0, y }, { boardId, ...SIZE }, opts).id;
  const production = await board('Produzione', 'production');
  const ids = { production: card(production, 0), film: '' };

  if (full) {
    // Two storyboards whose frames the day plans: the card shows their dots, not their documents.
    const storyboard = async (title: string, scenes: number) => {
      const id = await board(title, 'storyboard');
      const sb = createBoardDoc(id);
      const frames = [];
      for (let s = 0; s < scenes; s++) {
        const scene = addScene(sb, { number: String(s + 1) }, opts);
        frames.push(
          addFrame(sb, scene.id, null, { shot: 'ms' }, opts),
          addFrame(sb, scene.id, null, { shot: 'cu' }, opts),
        );
      }
      await pushBoardDoc(baseURL, cookie, id, sb);
      return { id, frames };
    };
    const film = await storyboard('Film', 2);
    const teaser = await storyboard('Teaser', 1);
    ids.film = card(film.id, 280);
    const shot = (sb: typeof film, i: number, label: string, title: string) =>
      block('shot', title, {
        shotId: sb.frames[i]?.id,
        shotBoardId: sb.id,
        shotLabel: label,
      });
    const day = (offset: number, location: string, callTime: string, blocks: unknown[]) =>
      page.request
        .post(`/api/v1/boards/${production}/schedule`, {
          headers,
          data: { date: dateIn(offset), callTime, wrap: null, location, notes: '', blocks },
        })
        .then((res) => expect(res.status()).toBe(201));
    // A day already shot, the next one, and two after it: the card shows the next.
    await day(-3, 'Stazione centrale', '18:30', [block('setup', 'Luci, fumo e pioggia')]);
    await day(2, 'Deposito treni\nVia dei Binari 4', '19:00', [
      block('setup', 'Luci, fumo e pioggia', { start: '19:00' }),
      shot(film, 1, '1B', 'Marta sale sul treno'),
      block('break', 'Cena'),
      shot(teaser, 0, '1A', ''),
      block('scene', 'Il deposito di notte', {
        sceneId: 'scene-0002',
        sceneBoardId: film.id,
        sceneLabel: '2',
      }),
      block('move', 'Spostamento al binario 4'),
    ]);
    await day(4, 'Binario 4', '20:00', []);
    await day(6, 'Deposito treni', '19:00', []);
    for (const [i, [name, role]] of [
      ['Matteo Marangoni', 'Regia'],
      ['Sara Benedetti', 'Direttrice della fotografia'],
      ['Luca Romano', '1° assistente operatore'],
      ['Giulia Testa', 'Fonico di presa diretta'],
      ['Elena Parisi', 'Produzione'],
      ['Bruno Costa', 'Elettricista'],
    ].entries())
      expect(
        (
          await page.request.post(`/api/v1/projects/${project.id}/crew`, {
            headers,
            data: {
              name,
              department: 'Camera',
              role,
              phone: '',
              email: '',
              notes: '',
              pickup: '',
              character: null,
              userId: null,
              onSetContact: false,
              position: i,
            },
          })
        ).status(),
      ).toBe(201);
  }
  await pushBoardDoc(baseURL, cookie, root, doc);
  return { project, ids, production };
}

for (const theme of ['light', 'dark'] as const) {
  test(`the Production board's card previews its next day and troupe (${theme})`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const { project, ids, production } = await seed(page, baseURL!, theme, true);
    const el = (id: string) => page.locator(`[data-el="${id}"]`);
    const card = el(ids.production);
    const capture = async (name: string) => {
      if (!shots) return;
      mkdirSync(shots, { recursive: true });
      // A tab click selects the card: the screenshot shows it unselected, whole on a phone.
      await page.keyboard.press('Escape');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      if (page.viewportSize()?.width === 390)
        await page.getByRole('button', { name: 'Adatta alla vista' }).click();
      await page.mouse.move(1, 1);
      const width = page.viewportSize()?.width;
      await page.screenshot({ path: join(shots, `${name}-${width}-${theme}.png`) });
    };
    const open = async () => {
      await page.goto(`/p/${project.id}?view=canvas`);
      await expect(card.locator('.board-card__body')).toBeVisible();
      await expect(page.locator('.board-card [aria-busy=true]')).toHaveCount(0);
    };
    await open();

    // Schedule: the next day, its first five blocks with the storyboards' dots, then the others.
    await expect(card.getByRole('tab')).toHaveText(['Piano riprese', 'Troupe']);
    await expect(card.locator('.board-card__meta')).toHaveText('4 giornate di riprese');
    await expect(card.locator('.board-card__day b')).toContainText('Giorno 2 · ');
    await expect(card.locator('.board-card__day span')).toHaveText(
      'Deposito treni · Convocazione 19:00',
    );
    const blocks = card.locator('.board-card__block');
    await expect(blocks).toHaveCount(5);
    await expect(blocks.locator('.board-card__time')).toHaveText([
      '19:00',
      '19:45',
      '20:30',
      '21:15',
      '22:00',
    ]);
    await expect(blocks.nth(1)).toContainText('1B · Marta sale sul treno');
    await expect(blocks.nth(1).getByRole('img', { name: 'Film' })).toBeVisible();
    await expect(blocks.nth(3).getByRole('img', { name: 'Teaser' })).toBeVisible();
    await expect(blocks.nth(4)).toContainText('Sc. 2 · Il deposito di notte');
    await expect(card.locator('.board-card__more')).toHaveText('+3 giornate');
    // The storyboard's card no longer counts days and people: they are on this one.
    await expect(el(ids.film).getByRole('tab')).not.toContainText(['Piano riprese']);
    await capture('schedule');

    // Troupe: the first four people with their role, then the others.
    await card.getByRole('tab', { name: 'Troupe' }).click();
    await expect(card.locator('.board-card__meta')).toHaveText('6 persone');
    await expect(card.locator('.board-card__person')).toHaveCount(4);
    await expect(card.locator('.board-card__person').first()).toContainText('Matteo Marangoni');
    await expect(card.locator('.board-card__person').first()).toContainText('Regia');
    await expect(card.locator('.board-card__more')).toHaveText('+2 persone');
    await capture('troupe');

    // The chosen tab stays on this device, and opening the card opens that view.
    await page.reload();
    await expect(card.getByRole('tab', { name: 'Troupe' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await card.locator('.board-card__body').dblclick();
    await expect(page).toHaveURL(new RegExp(`/b/${production}\\?view=troupe`));

    if (!shots) return;
    // Someone with a grant on the board but outside the project: the server sends no crew.
    const full = await (await page.request.get(`/api/v1/boards/${production}/preview`)).json();
    const { crew: _crew, crewCount: _count, ...hidden } = full;
    await page.route(`**/api/v1/boards/${production}/preview`, (route) =>
      route.fulfill({ json: hidden }),
    );
    await open();
    await expect(card.locator('.board-card__empty')).toHaveText(
      'La troupe la vedono i membri del progetto.',
    );
    await capture('troupe-hidden');
    await page.unrouteAll({ behavior: 'wait' });

    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await card.getByRole('tab', { name: 'Piano riprese' }).click();
    await expect(card.locator('.board-card__block')).toHaveCount(5);
    await capture('schedule');
    await card.getByRole('tab', { name: 'Troupe' }).click();
    await capture('troupe');
    await page.route(`**/api/v1/boards/${production}/preview`, (route) =>
      route.fulfill({ json: hidden }),
    );
    await open();
    await expect(card.locator('.board-card__empty')).toHaveText(
      'La troupe la vedono i membri del progetto.',
    );
    await capture('troupe-hidden');
    await page.unrouteAll({ behavior: 'wait' });
  });

  test(`the Production board's card says when it is empty (${theme})`, async ({
    page,
    baseURL,
  }) => {
    test.skip(!shots, 'screenshots only');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      const { project, ids } = await seed(page, baseURL!, theme, false);
      const card = page.locator(`[data-el="${ids.production}"]`);
      await page.goto(`/p/${project.id}?view=canvas`);
      const capture = async (name: string) => {
        mkdirSync(shots!, { recursive: true });
        await page.keyboard.press('Escape');
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        if (width === 390) await page.getByRole('button', { name: 'Adatta alla vista' }).click();
        await page.mouse.move(1, 1);
        await page.screenshot({ path: join(shots!, `${name}-${width}-${theme}.png`) });
      };
      await card.getByRole('tab', { name: 'Piano riprese' }).click();
      await expect(card.locator('.board-card__empty')).toHaveText(
        'Ancora nessuna giornata di riprese.',
      );
      await capture('empty-schedule');
      await card.getByRole('tab', { name: 'Troupe' }).click();
      await expect(card.locator('.board-card__empty')).toHaveText('Ancora nessuno in troupe.');
      await capture('empty-troupe');
    }
  });
}
