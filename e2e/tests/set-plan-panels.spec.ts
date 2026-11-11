// SPDX-License-Identifier: AGPL-3.0-only
// Panels of the set plan editor as the approved mockup (decision 0116): a setup made before the
// fix counts its lights on the base's circuits and shows the base's title; the first setup is
// renamed on its tab like the others; Elements folds identical lamps into one row.
// Runs after first-run.spec.ts in CI; alone, it signs up.
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import { pushBoardDoc, signIn } from './perf/seed.ts';

const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };
const g = (v: number) => Math.round(v * STROKE_GRID);

test.use({ locale: 'it-IT' });

test('set plan panels: circuits on every setup, the base renamed, identical lamps on one row', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const cookie = await signIn(baseURL!, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL! };
    }),
  );
  await page.goto('/');
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'Cortometraggio · pannelli della pianta' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const root = project.rootBoardId as string;
  const doc = createBoardDoc(root);
  const icon = (id: string, kind: PlanIcon['kind'], x: number, y: number, extra = {}) => ({
    id: `icon${id}`.padEnd(13, 'A'),
    kind,
    color: '#EDD963',
    x: g(x),
    y: g(y),
    ...extra,
  });
  const lamps = [0.3, 0.5, 0.7].map((x, i) => icon(`Lamp${i}`, 'practical', x, 0.3, { watts: 40 }));
  const plan = createElement(
    doc,
    'plan',
    { x: 60, y: 120 },
    {
      w: 480,
      title: 'Tavola calda',
      circuits: [{ id: 'circuitAAAAAA', name: 'Circuito A', amps: 16 }],
      icons: [
        icon('Key', 'fresnel', 0.2, 0.6, { label: 'Chiave', watts: 2000, circuit: 'circuitAAAAAA' }),
        ...lamps,
      ],
    },
    opts,
  );
  // A setup as the builds before decision 0116 made it: no circuits of its own, no title, its
  // light still on the base's circuit.
  createElement(
    doc,
    'plan',
    { x: 60, y: 520 },
    {
      w: 300,
      variantOf: plan.id,
      variant: 'PP Anna',
      circuits: [],
      icons: [
        icon('Key2', 'fresnel', 0.3, 0.6, { label: 'Chiave', watts: 2000, circuit: 'circuitAAAAAA' }),
      ],
    },
    opts,
  );
  await pushBoardDoc(baseURL!, cookie, root, doc);
  await page.goto(`/p/${project.id}/b/${root}?view=canvas`);
  await page.locator(`[data-el="${plan.id}"]`).dblclick();
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  const tabs = editor.getByRole('tablist', { name: 'Setup' });

  await test.step('a setup counts its light on the base circuit and shows the title', async () => {
    await tabs.getByRole('tab', { name: '2 · PP Anna' }).click();
    await expect(editor.getByRole('textbox', { name: 'Titolo della pianta' })).toHaveValue(
      'Tavola calda',
    );
    await editor.getByRole('tab', { name: 'Materiale' }).click();
    const kit = editor.locator('.plan-kit');
    await expect(kit).toContainText('Circuito A · 16 A');
    await expect(kit).toContainText('8,7 A');
    await expect(kit).not.toContainText('Su nessun circuito');
    // The note of what changed sits under the tabs, out of the drawing.
    await expect(editor.locator('.plan-main__column > .plan-setup-note')).toBeVisible();
  });

  await test.step('the first setup is renamed on its tab', async () => {
    await tabs.getByRole('tab', { name: '1 · Base' }).click();
    await tabs.getByRole('tab', { name: '1 · Base' }).dblclick();
    const name = editor.getByRole('textbox', { name: 'Nome del setup' });
    await name.fill('Master');
    await name.press('Enter');
    await expect(tabs.getByRole('tab')).toHaveText(['1 · Master', '2 · PP Anna']);
    // The card keeps the plan's name: a base's setup name stays on its tab.
    await expect(page.locator(`[data-el="${plan.id}"] .plan__title`)).toHaveText('Tavola calda');
  });

  await test.step('Elements folds the three lamps into one row that selects them all', async () => {
    await editor.getByRole('tab', { name: 'Elementi' }).click();
    const row = editor.getByRole('button', { name: /Lampada da tavolo ×3/ });
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await editor.getByRole('tab', { name: 'Proprietà' }).click();
    await expect(editor.getByText('3 elementi selezionati')).toBeVisible();
  });
});
