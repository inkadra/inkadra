// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// Decision 0136: an administrator adds a kind of to-do list in Settings → Classifications, and a
// scene's To bring offers it. Set E2E_SHOTS to a folder outside the repository for screenshots.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const shots = process.env.E2E_SHOTS;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
type Option = { id: string; label: string; archived: boolean };

test.use({ locale: 'it-IT' });

/** Both themes, desktop and phone, without a leftover hover or focus. */
async function shoot(page: Page, name: string, setup: () => Promise<void>) {
  if (!shots) return;
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => localStorage.setItem('inkadra.theme', value), theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await setup();
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("a kind added in Settings is offered by a scene's To bring", async ({ page, baseURL }) => {
  test.setTimeout(shots ? 600_000 : 120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base };
    }),
  );
  const kind = `Trucco ${Date.now().toString(36)}`;
  try {
    await page.goto('/settings?section=classifications');
    await expect(page.getByRole('heading', { name: 'Produzione', exact: true })).toBeVisible();
    const card = page.locator('.catalogs__card', { hasText: 'Tipi di lista' });
    await expect(card.locator('.catalogs__chip')).toHaveText([
      'Costumi',
      'Attrezzeria',
      'Attrezzatura',
    ]);
    await card.getByRole('button', { name: /^Tipi di lista/ }).click();
    await card.getByRole('button', { name: 'Aggiungi valore' }).click();
    await page.keyboard.type(kind);
    await page.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Salvato' })).toBeVisible();
    await shoot(page, '01-settings', async () => {
      const card = page.locator('.catalogs__card', { hasText: 'Tipi di lista' });
      await card.getByRole('button', { name: /^Tipi di lista/ }).click();
      await expect(card.locator('.catalogs__name')).toHaveCount(4);
      await card.scrollIntoViewIfNeeded();
    });

    // A storyboard with a scene, whose To bring offers the new kind after the defaults.
    const project = (await (
      await page.request.post('/api/v1/projects', {
        headers: { origin: base },
        data: { name: 'Salt Line', type: 'short_film' },
      })
    ).json()) as { id: string; rootBoardId: string };
    const board = (await (
      await page.request.post(`/api/v1/projects/${project.id}/boards`, {
        headers: { origin: base },
        data: { parentBoardId: project.rootBoardId, title: 'Storyboard', kind: 'storyboard' },
      })
    ).json()) as { id: string };
    await page.goto(`/p/${project.id}/b/${board.id}`);
    await page.getByRole('button', { name: 'Nuova scena', exact: true }).first().click();
    const scene = page.getByRole('region', { name: 'Scena 1', exact: true });
    await expect(scene).toBeVisible();
    const open = async () => {
      await page
        .getByRole('region', { name: 'Scena 1', exact: true })
        .getByRole('button', { name: /^Da portare per la scena 1/ })
        .click();
    };
    await open();
    const popup = page.getByRole('dialog', { name: 'Da portare per la scena 1' });
    await popup.getByRole('button', { name: 'Aggiungi lista' }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Costumi',
      'Attrezzeria',
      'Attrezzatura',
      kind,
    ]);
    await page.getByRole('menuitem', { name: kind }).click();
    await page.keyboard.type('Anna');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fondotinta');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(popup.getByRole('heading', { name: kind })).toBeVisible();
    await expect(popup.getByRole('checkbox', { name: 'Fondotinta' })).toBeVisible();
    await shoot(page, '02-to-bring', async () => {
      await open();
      await expect(popup.getByRole('checkbox', { name: 'Fondotinta' })).toBeVisible();
    });
  } finally {
    // Other specs expect the three defaults in the menus: the kind, now used, is archived.
    const current = (await (
      await fetch(`${base}/api/v1/instance/classifications`, { headers })
    ).json()) as { todoLists: Option[] };
    await fetch(`${base}/api/v1/instance/classifications`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...current,
        todoLists: current.todoLists.map((o) => (o.label === kind ? { ...o, archived: true } : o)),
      }),
    });
  }
});
