// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// The animated switch between a project's views: it only runs on a tab change, the last click
// wins, and the live views underneath stay usable. The rest of the suite runs with reduced motion.
import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';
import { perfUser, signIn } from './perf/seed.ts';

async function openProject(page: Page, baseURL: string, name: string) {
  const cookie = await signIn(baseURL, perfUser);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  const headers = { origin: baseURL };
  const created = await page.request.post('/api/v1/projects', { headers, data: { name } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string; rootBoardId: string };
  const board = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers,
    data: { parentBoardId: project.rootBoardId, title: 'Storyboard', kind: 'storyboard' },
  });
  expect(board.ok()).toBe(true);
  // Counts every transition the page starts, from the first script on.
  await page.addInitScript(() => {
    const start = document.startViewTransition?.bind(document);
    Object.assign(window, { transitions: 0 });
    if (start)
      document.startViewTransition = (update) => {
        (window as unknown as { transitions: number }).transitions++;
        return start(update as ViewTransitionUpdateCallback);
      };
  });
  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  return project;
}

const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { transitions: number }).transitions);

/** Nothing of a switch is left over: no pseudo-elements running, no pill, no leftover overflow. */
async function expectSettled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.effect && 'pseudoElement' in a.effect && a.effect.pseudoElement)
          .some((a) => (a.effect as KeyframeEffect).pseudoElement?.startsWith('::view-transition')),
      ),
    )
    .toBe(false);
  await expect(page.locator('.view-tabs--sliding')).toHaveCount(0);
  // A name left on the views would trap their viewer under the header.
  await expect(page.locator('.view-stage')).toHaveCSS('view-transition-name', 'none');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('only a tab change animates, and fast clicks end on the last view', async ({
    page,
    baseURL,
  }) => {
    await openProject(page, baseURL!, `View tabs ${Date.now()}`);
    expect(await transitions(page)).toBe(0);

    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible();
    expect(await transitions(page)).toBe(0);

    await tab(page, 'Moodboard').click();
    await expect(tab(page, 'Moodboard')).toHaveAttribute('aria-selected', 'true');
    expect(await transitions(page)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.dataset.viewDirection)).toBe(
      'forward',
    );
    await expectSettled(page);

    // Through all six, without waiting; a storyboard's own tabs do not offer the moodboard.
    await tab(page, 'Lavagna').click();
    await tab(page, 'Moodboard').click();
    await tab(page, 'Storyboard').click();
    await tab(page, 'Shot list').click();
    await tab(page, 'Piano riprese').click();
    await tab(page, 'Revisione').click();
    await tab(page, 'Lavagna').click();
    await tab(page, 'Piano riprese').click();
    await expect(tab(page, 'Piano riprese')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('section.schedule')).toBeVisible();
    await expect(page).toHaveURL(/view=schedule/);
    await expect(page.getByTestId('canvas')).toHaveCount(0);
    await expectSettled(page);

    // Several in the same frame: the last one wins.
    await page.evaluate(() => {
      for (const name of ['Revisione', 'Shot list', 'Storyboard']) {
        document.querySelector<HTMLElement>(`[role="tab"][aria-label="${name}"]`)?.click();
      }
    });
    await expect(tab(page, 'Storyboard')).toHaveAttribute('aria-selected', 'true');
    await expectSettled(page);
    await expect(page.locator('.view-stage')).toHaveCSS('opacity', '1');
    await expect(page).not.toHaveURL(/view=/);

    // Browser back leaves the storyboard for the root board at once, with no direction left.
    await page.goBack();
    await expect(page.getByTestId('canvas').or(page.locator('[role="tab"]').first())).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.viewDirection))
      .toBeUndefined();
    await expectSettled(page);
  });

  test('the new view is live during the switch, the old one is only a picture', async ({
    page,
    baseURL,
  }) => {
    await openProject(page, baseURL!, `View tabs live ${Date.now()}`);
    await tab(page, 'Storyboard').click();
    await expect(tab(page, 'Storyboard')).toHaveAttribute('aria-selected', 'true');
    await expectSettled(page);

    // Hold the animations halfway, to look at the page in the middle of a switch.
    const during = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[role="tab"][aria-label="Piano riprese"]')?.click();
      const until = performance.now() + 3000;
      let held: Animation[] = [];
      while (performance.now() < until && held.length === 0) {
        await new Promise(requestAnimationFrame);
        held = document
          .getAnimations()
          .filter((a) =>
            (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition'),
          );
      }
      for (const a of held) a.pause();
      const stage = document.querySelector('.view-stage')?.getBoundingClientRect();
      const hit = stage && document.elementFromPoint(stage.left + stage.width / 2, stage.top + 20);
      const result = {
        held: held.length,
        // The old view is gone from the page; its picture and the new view take no pointer yet.
        hitsOld: !!hit?.closest('.story'),
        oldViews: document.querySelectorAll('.story').length,
        newViews: document.querySelectorAll('section.schedule').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
      for (const a of held) a.finish();
      return result;
    });
    expect(during.held).toBeGreaterThan(0);
    expect(during.hitsOld).toBe(false);
    expect(during.oldViews).toBe(0);
    expect(during.newViews).toBe(1);
    expect(during.overflow).toBe(0);
    await expectSettled(page);
    // Right after, a click reaches the new view.
    await page
      .locator('section.schedule .story__bar')
      .getByRole('button')
      .first()
      .click({ trial: true });
    // Keyboard focus stays on the tab that was chosen.
    await tab(page, 'Shot list').focus();
    await page.keyboard.press('Enter');
    await expect(tab(page, 'Shot list')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Shot list')).toBeFocused();
    await expectSettled(page);
  });

  test('the canvas keeps its view, selection and edits across a switch', async ({
    page,
    baseURL,
  }) => {
    await openProject(page, baseURL!, `View tabs canvas ${Date.now()}`);
    await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
    const canvas = page.getByTestId('canvas');
    await page.keyboard.press('n');
    await page.keyboard.type('Non ancora salvata');
    // Still typing: the tab takes the edit along, and the card comes back selected.
    await tab(page, 'Moodboard').click();
    await expect(tab(page, 'Moodboard')).toHaveAttribute('aria-selected', 'true');
    await expect(canvas).toHaveCount(0);
    await tab(page, 'Lavagna').click();
    await expect(canvas).toBeVisible();
    await expectSettled(page);
    const card = page.locator('.card--free', { hasText: 'Non ancora salvata' });
    await expect(card).toHaveCount(1);
    await card.click();

    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    const world = page.locator('.canvas__world');
    // Leaving while the view has only just stopped: its position is saved after the canvas closed.
    let zoomed = '';
    await expect
      .poll(async () => {
        const before = zoomed;
        zoomed = await world.evaluate((el) => el.style.transform);
        return zoomed === before && zoomed.includes('scale(1.2');
      })
      .toBe(true);

    await tab(page, 'Moodboard').click();
    await expect(canvas).toHaveCount(0);
    await tab(page, 'Lavagna').click();
    await expect(canvas).toBeVisible();
    await expect.poll(() => world.evaluate((el) => el.style.transform)).toBe(zoomed);
    await expect(card).toHaveClass(/is-selected/);
    await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('the view picker switches with the same transition', async ({ page, baseURL }) => {
      await openProject(page, baseURL!, `View tabs phone ${Date.now()}`);
      const picker = page.locator('.mobile-view-switcher');
      // Until the project's boards load no view is current yet, and nothing can animate.
      await expect(picker).toContainText('Lavagna');
      await chooseSelect(picker, 'moodboard');
      await expect(page).toHaveURL(/view=moodboard/);
      // The address can change before the transition starts: count once the picker shows the
      // new view, as the tabs test does with aria-selected.
      await expect(picker).toHaveAttribute('data-value', 'moodboard');
      expect(await transitions(page)).toBe(1);
      await expectSettled(page);
      await chooseSelect(picker, 'canvas');
      await expect(page.getByTestId('canvas')).toBeVisible();
      await expectSettled(page);
    });
  });
});

test('the keyboard walks the view tabs and only Enter or Space opens a view', async ({
  page,
  baseURL,
}) => {
  await openProject(page, baseURL!, `View tabs keys ${Date.now()}`);
  const tabs = page.getByRole('tablist', { name: 'Vista' }).getByRole('tab');
  const names = await tabs.evaluateAll((all) => all.map((t) => t.getAttribute('aria-label')));
  const first = names[0] ?? '';
  const last = names.at(-1) ?? '';
  // One tab stop, on the open view's tab, whose view is the panel.
  await expect(tab(page, 'Lavagna')).toHaveAttribute('tabindex', '0');
  await expect(tabs.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  const panel = page.getByRole('tabpanel', { name: 'Lavagna' });
  await expect(panel).toHaveCount(1);
  await tab(page, 'Lavagna').focus();
  await page.keyboard.press('End');
  await expect(tab(page, last)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, first)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, last)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, first)).toBeFocused();
  // Walking opened nothing.
  await expect(tab(page, 'Lavagna')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  await tab(page, 'Moodboard').focus();
  await page.keyboard.press('Enter');
  await expect(tab(page, 'Moodboard')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Moodboard')).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Moodboard' })).toHaveCount(1);
});

test('reduced motion switches at once, without a transition', async ({ page, baseURL }) => {
  await openProject(page, baseURL!, `View tabs reduced ${Date.now()}`);
  await tab(page, 'Moodboard').click();
  await expect(tab(page, 'Moodboard')).toHaveAttribute('aria-selected', 'true');
  expect(await transitions(page)).toBe(0);
  await expect(page.locator('.view-tabs--sliding')).toHaveCount(0);
});
