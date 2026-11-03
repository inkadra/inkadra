import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn } from './perf/seed.ts';

for (const width of [1280, 390]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`address suggestions ${width} ${theme}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 844 });
      const cookie = await signIn(baseURL!, {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      });
      await page.context().addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseURL! };
        }),
      );
      await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
      const project = await (
        await page.request.post('/api/v1/projects', {
          headers: { origin: baseURL! },
          data: { name: 'Address search QA' },
        })
      ).json();
      const doc = createBoardDoc(project.rootBoardId);
      createElement(doc, 'note', { x: 60, y: 60 }, {}, { userId: null });
      await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
      await page.goto(`/p/${project.id}?view=canvas`);
      const shot = async (state: string) => {
        if (process.env.QA08_SHOTS) {
          mkdirSync(process.env.QA08_SHOTS, { recursive: true });
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: join(process.env.QA08_SHOTS, `autocomplete-${width}-${theme}-${state}.png`),
          });
        }
      };
      const open = async () => {
        await page.getByRole('button', { name: 'Mappa', exact: true }).click();
        return page.getByRole('combobox', { name: 'Indirizzo o link di una mappa' });
      };
      let previews = 0;
      page.on('request', (req) => {
        if (req.url().endsWith('/api/v1/map-previews')) previews++;
      });
      const input = await open();
      await input.fill('Via Roma');
      await expect(page.getByRole('option')).toHaveCount(2);
      expect(previews).toBe(0);
      await shot('suggestions');
      if (width === 1280) {
        await input.press('ArrowDown');
        await input.press('Enter');
      } else await page.getByRole('button', { name: 'Via Roma, Sondrio', exact: true }).click();
      const card = page.locator('.card--map');
      await expect(card).toContainText('Via Roma, Sondrio');
      await expect(card.locator('.fcard__img')).toBeVisible({ timeout: 20000 });
      await expect
        .poll(() =>
          card.locator('.fcard__img').evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const saved = await readBoard(baseURL!, cookie, project.rootBoardId);
      const map = [...roots(saved).elements.values()]
        .map(readElement)
        .find((el) => el?.type === 'map');
      expect(map).toMatchObject({
        name: 'Via Roma, Sondrio',
        lat: 46.1699,
        lon: 9.8788,
        address: 'Via Roma',
      });
      expect(previews).toBe(1);
      await shot('preview');
      const again = await open();
      await again.fill('unknown');
      await expect(
        page.getByRole('status').filter({ hasText: 'Nessun luogo trovato' }),
      ).toBeVisible();
      await again.fill('unavailable');
      await expect(page.getByRole('alert')).toContainText('Ricerca non disponibile');
      await shot('error');
      if (width === 1280 && theme === 'dark') {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route('**/api/v1/map-search', async (route) => {
          if (route.request().postDataJSON().query !== 'stale') {
            await route.continue();
            return;
          }
          await gate;
          await route.fulfill({
            json: { items: [{ lat: 0, lon: 0, zoom: 16, name: 'Old result' }] },
          });
        });
        const request = page.waitForRequest(
          (r) => r.url().endsWith('/map-search') && r.postDataJSON().query === 'stale',
        );
        await again.fill('stale');
        await request;
        await again.fill('Via Roma');
        await expect(page.getByRole('option')).toHaveCount(2);
        const response = page.waitForResponse((r) => r.request().postDataJSON()?.query === 'stale');
        release();
        await response;
        await expect(page.getByRole('option')).toHaveText([
          'Via Roma, Milano',
          'Via Roma, Sondrio',
        ]);
      }
      await again.press('Escape');
      await expect(again).toHaveCount(0);
    });
  }
}
