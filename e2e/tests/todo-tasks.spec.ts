// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { perfUser, pushBoardDoc, signIn } from './perf/seed.ts';

const out = process.env.TODO_SHOTS ?? join(tmpdir(), 'inkadra-todo304');
const date = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
for (const theme of ['light', 'dark'] as const)
  for (const phone of [false, true]) {
    test(`assigned to-dos and My tasks (${theme}, ${phone ? 'phone' : 'desktop'})`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(90_000);
      mkdirSync(out, { recursive: true });
      const prefix = `${phone ? 'phone' : 'desktop'}-${theme}`;
      if (phone)
        await page.route('**/api/v1/me/notifications/unread-count', (route) =>
          route.fulfill({ json: { unread: 1 } }),
        );
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
      const previous = await (await page.request.get('/api/v1/projects')).json();
      for (const old of previous.items)
        if (/^Spot Aurora (desktop|phone)-(light|dark)$/.test(old.name)) {
          await page.request.patch(`/api/v1/projects/${old.id}`, {
            headers: { origin: baseURL! },
            data: { archived: true },
          });
        }
      const me = await (await page.request.get('/api/v1/me')).json();
      const created = await page.request.post('/api/v1/projects', {
        headers: { origin: baseURL! },
        data: { name: `Spot Aurora ${prefix}` },
      });
      expect(created.ok()).toBe(true);
      const project = await created.json();
      const doc = createBoardDoc(project.rootBoardId);
      const todo = createElement(
        doc,
        'todo',
        { x: 40, y: 60 },
        { title: 'Prima delle riprese', items: [], w: phone ? 300 : 560 },
        { userId: me.id },
      );
      for (const [text, offset] of [
        ['Permessi parcheggio', -1],
        ['Ritirare i rullini', 0],
        ['Batterie camere', 3],
      ] as const) {
        const item = addTodoItem(doc, todo.id, text)!;
        updateTodoItem(doc, todo.id, item, { assigneeId: me.id, dueDate: date(offset) });
      }
      await pushBoardDoc(baseURL!, cookie, project.rootBoardId, doc);
      doc.destroy();
      await page.goto(`/p/${project.id}?view=canvas`);
      const card = page.locator(`[data-el="${todo.id}"]`);
      await expect(card).toContainText('Permessi parcheggio');
      await expect(card.locator('.todo-assignment--danger')).toHaveCount(1);
      await expect(card.locator('.todo-assignment--warning')).toHaveCount(1);
      await page.screenshot({ path: join(out, `${prefix}-chips.png`) });
      await card.getByRole('button', { name: 'Assegna persona', exact: true }).first().click();
      await expect(card.getByRole('combobox')).toBeVisible();
      await card.getByRole('combobox').fill('Giulia');
      await expect(card.getByRole('option')).toBeVisible();
      await page.screenshot({ path: join(out, `${prefix}-people.png`) });
      await card.getByRole('option').click();
      await card
        .getByRole('button', { name: /nov|ott|dic|gen|feb|mar|apr|mag|giu|lug|ago|set|Oggi/ })
        .last()
        .click();
      const field = card.locator('input[type="date"]').first();
      await expect(field).toBeVisible();
      await field.focus();
      await page.screenshot({ path: join(out, `${prefix}-date.png`) });
      await field.fill(date(2));
      await expect
        .poll(
          async () =>
            (await (await page.request.get('/api/v1/me/tasks')).json()).items.filter(
              (i: { projectId: string }) => i.projectId === project.id,
            ).length,
        )
        .toBe(3);
      await page.goto('/');
      const tasks = page.getByRole('region', { name: 'I miei compiti' });
      await expect(
        tasks.locator(`a[href*="/p/${project.id}/"]`).filter({ hasText: 'Permessi parcheggio' }),
      ).toBeVisible();
      await page.screenshot({ path: join(out, `${prefix}-home.png`) });
      const inbox = phone
        ? page.locator('.mobile-bottom-nav').getByRole('button', { name: /^Inbox/ })
        : page.getByRole('button', { name: 'Inbox', exact: true });
      if (phone) await expect(inbox).toHaveAccessibleName('Inbox: 1 non letta');
      await inbox.click();
      await page.getByRole('tab', { name: 'I miei compiti', exact: true }).click();
      await expect(
        page
          .getByRole('region', { name: 'I miei compiti' })
          .locator(`a[href*="/p/${project.id}/"]`)
          .filter({ hasText: 'Permessi parcheggio' }),
      ).toBeVisible();
      await page.screenshot({ path: join(out, `${prefix}-inbox.png`) });
      await page
        .getByRole('region', { name: 'I miei compiti' })
        .locator(`a[href*="/p/${project.id}/"]`)
        .filter({ hasText: 'Permessi parcheggio' })
        .click();
      await expect(card).toBeVisible();
      await expect(card).toHaveClass(/is-selected/);
    });
  }
