import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addTodoItem, createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { chromium, expect, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const out = process.env.QA08_SHOTS;

for (const width of [1280, 390]) {
  for (const theme of ['dark', 'light'] as const) {
    for (const kind of ['note', 'todo', 'character', 'microphone', 'map', 'plan'] as const) {
      test(`QA08 ${kind} ${width} ${theme}`, async ({ page, baseURL }) => {
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
        const me = await (await page.request.get('/api/v1/me')).json();
        await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
        const response = await page.request.post('/api/v1/projects', {
          headers: { origin: baseURL! },
          data: { name: `QA08 ${kind}` },
        });
        const project = await response.json();
        const doc = createBoardDoc(project.rootBoardId);
        const type = kind === 'microphone' ? 'note' : kind;
        const at = { x: 80, y: 80 };
        const opts = { userId: null };
        const el =
          type === 'todo'
            ? createElement(doc, 'todo', at, { items: [], w: 380 }, opts)
            : type === 'character'
              ? createElement(doc, 'character', at, { name: 'QA Tools' }, opts)
              : type === 'map'
                ? createElement(
                    doc,
                    'map',
                    at,
                    { name: 'QA Tools', lat: 45.4642, lon: 9.19, zoom: 16 },
                    opts,
                  )
                : type === 'plan'
                  ? createElement(doc, 'plan', at, { title: 'QA Tools' }, opts)
                  : createElement(doc, 'note', at, { w: 380 }, opts);
        if (kind === 'todo') {
          addTodoItem(doc, el.id, 'Preparare il set');
          addTodoItem(doc, el.id, 'Controllare le luci');
        }
        await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
        if (kind === 'map')
          await page.route('**/api/v1/instance', async (route) => {
            const response = await route.fetch();
            const data = await response.json();
            data.maps.geocoding = false;
            await route.fulfill({ response, json: data });
          });
        await page.goto(`/p/${project.id}?view=canvas`);
        const card = page.locator(`[data-el="${el.id}"]`).first();
        await expect(card).toBeVisible({ timeout: 20000 });
        const shot = async (state: string) => {
          if (out) {
            mkdirSync(out, { recursive: true });
            await page.screenshot({ path: join(out, `${kind}-${width}-${theme}-${state}.png`) });
          }
        };
        await shot('initial');
        if (kind === 'microphone') {
          const policy = await page.evaluate(() =>
            (
              document as Document & { featurePolicy: { allowsFeature: (s: string) => boolean } }
            ).featurePolicy.allowsFeature('microphone'),
          );
          expect(policy).toBe(true);
          if (width === 1280 && theme === 'dark') {
            await page.evaluate(() => {
              const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              navigator.mediaDevices.getUserMedia = (constraints) => {
                (window as unknown as Record<string, unknown>).micRequested = true;
                return original(constraints);
              };
            });
            expect(
              await page.evaluate(
                async () =>
                  (await navigator.permissions.query({ name: 'microphone' as PermissionName }))
                    .state,
              ),
            ).toBe('prompt');
            await page.getByRole('button', { name: 'Nota vocale', exact: true }).click();
            await expect
              .poll(() =>
                page.evaluate(() => (window as unknown as Record<string, unknown>).micRequested),
              )
              .toBe(true);
            // Only after the unmodified permission path has been called, provide a fake device.
            const fakeBrowser = await chromium.launch({
              args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
            });
            try {
              const context = await fakeBrowser.newContext({
                storageState: await page.context().storageState(),
                viewport: { width, height: 844 },
              });
              const recording = await context.newPage();
              await recording.goto(`${baseURL}/p/${project.id}?view=canvas`);
              await recording.getByRole('button', { name: 'Nota vocale', exact: true }).click();
              await expect(recording.locator('.voicenote__time')).not.toHaveText('0:00');
              if (out) await recording.screenshot({ path: join(out, 'microphone-recording.png') });
              await recording.getByRole('button', { name: 'Salva', exact: true }).click();
              await expect(recording.locator('.voicenote')).toHaveCount(0);
              await expect(recording.locator('.card--file')).toBeVisible();
            } finally {
              await fakeBrowser.close();
            }
          }
        } else if (kind === 'note') {
          await card.dblclick();
          const editor = card.locator('.tiptap');
          await editor.fill('Primo secondo terzo');
          await expect(editor).toHaveCSS('box-shadow', 'none');
          const inline = card.locator('.tiptap');
          await expect(inline).toHaveText('Primo secondo terzo');
          const word = await inline.evaluate((element) => {
            const node = element.querySelector('p')!.firstChild!;
            const range = document.createRange();
            range.setStart(node, 6);
            range.setEnd(node, 13);
            const rect = range.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          });
          // Native word selection exercises the reporter's path and the editor's DOM observer.
          await page.mouse.dblclick(word.x, word.y);
          await expect
            .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
            .toBe('secondo');
          await page
            .getByRole('button', { name: 'Dimensione, liste e allineamento', exact: true })
            .click();
          await page.getByRole('button', { name: 'H1', exact: true }).click();
          await expect(inline.locator('h1')).toHaveText('secondo');
          await expect(inline.locator('p')).toHaveText(['Primo ', ' terzo']);
        } else if (kind === 'todo') {
          await card.dblclick();
          await expect(card.locator('.todo-assignment__person')).toHaveCount(0);
          await card.locator('.card__todo-list .card__inline-input').first().focus();
          await expect(card.locator('.todo-assignment__person')).toHaveCount(1);
          await card.locator('.card__todo-list .card__inline-input').first().press('End');
          await card.locator('.card__todo-list .card__inline-input').first().press('@');
          await expect(card.locator('.todo-assignment__picker')).toBeVisible();
          await card.locator('.todo-assignment__picker input').press('Escape');
          await expect(card.locator('.todo-assignment__picker')).toHaveCount(0);
          await card.locator('.card__todo-list .card__inline-input').first().focus();
          await card.locator('.card__todo-list .card__inline-input').first().press('End');
          await expect(card.locator('.card__todo-hint')).toHaveCount(1);
          await page.mouse.move(0, 0);
          await shot('editing');
          // The controls of the active item must not eat its text.
          await expect(card.locator('.todo-assignment__person')).toBeVisible();
          expect(
            await card
              .locator('.card__todo-list .card__inline-input')
              .first()
              .evaluate((el) => el.scrollWidth <= el.clientWidth),
          ).toBe(true);
          await card.getByRole('button', { name: 'Assegna persona', exact: true }).click();
          await page
            .locator('.todo-assignment__picker')
            .getByRole('option')
            .filter({ hasText: me.name })
            .click();
          await expect(card.locator('.todo-assignment__picker')).toHaveCount(0);
          await card.locator('input[type=date]').fill('2026-11-12');
          await expect(card.locator('input[type=date]')).toHaveValue('2026-11-12');
          await card.getByRole('button', { name: me.name, exact: true }).click();
          await page.locator('.canvas').click({ position: { x: width - 30, y: 600 } });
          await expect(card.locator('.todo-assignment__picker')).toHaveCount(0);
        } else if (kind === 'character') {
          await card.dblclick();
          await page.locator('.story-panel input[type=file]').setInputFiles({
            name: 'portrait.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              await page.evaluate(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 128;
                canvas.height = 160;
                const ctx = canvas.getContext('2d')!;
                ctx.fillStyle = '#677568';
                ctx.fillRect(0, 0, 128, 160);
                ctx.fillStyle = '#c4c0ae';
                ctx.beginPath();
                ctx.arc(64, 55, 28, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillRect(30, 90, 68, 70);
                return canvas.toDataURL('image/png').split(',')[1]!;
              }),
              'base64',
            ),
          });
          await expect(page.locator('.story-panel .story-picture img')).toBeVisible({
            timeout: 20000,
          });
          await expect
            .poll(
              () =>
                page
                  .locator('.story-panel .story-picture img')
                  .evaluate((img) => (img as HTMLImageElement).naturalWidth),
              { timeout: 20000 },
            )
            .toBeGreaterThan(0);
          await shot('photo-loaded');
          if (width === 1280) await page.locator('.canvas').click({ position: { x: 500, y: 650 } });
          else await page.getByRole('button', { name: 'Chiudi la scheda', exact: true }).click();
          await expect(page.locator('.story-panel')).toHaveCount(0);
        } else if (kind === 'plan') {
          await card.dblclick();
          await page.getByRole('button', { name: 'Testo (T)', exact: true }).click();
          await page.locator('.plan-editor__stage').click({ position: { x: 100, y: 100 } });
          await page
            .getByRole('textbox', { name: 'Testo sul disegno', exact: true })
            .fill('Uscita');
          await page
            .getByRole('textbox', { name: 'Testo sul disegno', exact: true })
            .press('Enter');
          await expect(page.locator('.plan-editor__stage')).toHaveClass(/--select/);
          await page
            .locator('.plan-editor__stage text')
            .filter({ hasText: /^Uscita$/ })
            .click();
          const field = page.getByRole('textbox', { name: 'Testo sul disegno', exact: true });
          await field.fill('Ingresso');
          await expect(
            page.locator('.plan-editor__stage text').filter({ hasText: 'Ingresso' }),
          ).toBeVisible();
          await shot('editing');
          await page.locator('.plan-editor__stage').click({ position: { x: 200, y: 200 } });
          await expect(field).toHaveCount(0);
        } else {
          await card.dblclick();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(page.locator('.viewer')).toHaveCount(0);
          await expect(page.locator('.map-dialog .leaflet-container')).toBeVisible();
          await page.getByRole('button', { name: 'Chiudi la mappa' }).click();
          await page.getByRole('button', { name: 'Mappa', exact: true }).click();
          const address = page.getByRole('combobox', { name: 'Indirizzo o link di una mappa' });
          await address.fill('Via Roma, Milano');
          await address.press('Enter');
          await expect(page.getByRole('alert')).toContainText('non è configurata');
          await shot('search-error');
          await address.press('Escape');
          await card.dblclick();
        }
        await page.mouse.move(0, 0);
        await shot('after');
      });
    }
  }
}
