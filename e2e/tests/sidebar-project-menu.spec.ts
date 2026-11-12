import { expect, type Page, test } from '@playwright/test';
import { addStoryboard } from '../helpers/views.ts';

// Uses the account created by first-run.spec.ts, and creates it when run on its own.
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
// A folder to put light and dark screenshots of the sidebar states in (review only).
const shots = process.env.SIDEBAR_SHOTS;
// The width of the review screenshots; the phone test sets its own.
test.use({ viewport: { width: 1280, height: 800 } });

async function setup(page: Page, origin: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin }, data: admin },
  );
  expect(auth.ok()).toBe(true);
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin },
    data: { name: `Sidebar ${Date.now()}` },
  });
  expect(created.ok()).toBe(true);
  return (await created.json()) as { id: string; name: string; rootBoardId: string };
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      localStorage.setItem('inkadra.theme', value);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
}

/** Leaves no focus ring from the last key press in a screenshot. */
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The view tabs of the board header, by name. */
const viewTabs = (page: Page) =>
  page
    .getByRole('tab')
    .filter({ hasText: /^(Lavagna|Moodboard|Storyboard|Shot list|Piano riprese|Revisione)$/ });

/** The phone's view switcher: the options it lists. */
async function switcherOptions(page: Page, shot: string) {
  await page.getByRole('combobox', { name: 'Vista', exact: true }).click();
  const list = page.getByRole('listbox');
  const names = await list.getByRole('option').allTextContents();
  await shoot(page, shot);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  return names;
}

// Decision 0121: the sidebar is a tree of boards, each with the icon of its kind and its views
// under it when it has more than one; the header shows the views of the open board only.
test('the sidebar tree of a project, and Add storyboard and Add moodboard in its menu', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? '';
  const project = await setup(page, origin);
  const sidebar = page.locator('.ink-shell > .ink-sidebar');
  const openSidebar = () => expect(sidebar).toBeVisible();
  const row = (name: string) => sidebar.getByRole('link', { name, exact: true });

  // No boards: the Board heading has a quiet New board row, and no project-wide film rows.
  await page.goto(`/p/${project.id}`);
  await openSidebar();
  await expect(sidebar.getByText('Board', { exact: true })).toBeVisible();
  const newBoard = sidebar.getByRole('button', { name: 'Nuova board', exact: true });
  await expect(newBoard).toBeVisible();
  for (const name of ['Storyboard', 'Shot list', 'Piano riprese', 'Troupe', 'Revisione'])
    await expect(row(name)).toHaveCount(0);
  // A board with one view shows its name and no tabs.
  await expect(viewTabs(page)).toHaveCount(0);
  await shoot(page, 'empty-project');

  // The row opens the New board dialog for this project.
  await newBoard.click();
  const dialog = page.getByRole('dialog', { name: 'Nuova board' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Add storyboard in the project's menu makes one and opens it, with its own views only.
  await sidebar.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Aggiungi moodboard' })).toBeVisible();
  const item = page.getByRole('menuitem', { name: 'Aggiungi storyboard' });
  await shoot(page, 'project-menu');
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
  await openSidebar();
  await expect(viewTabs(page)).toHaveText(['Storyboard', 'Shot list']);
  // Its row, and its two views under it.
  await expect(sidebar.getByRole('link', { name: /^Storyboard/ })).toHaveCount(2);
  // The Shot list row counts the frames, as the Storyboard row does: its name starts with it.
  const shotList = sidebar.getByRole('link', { name: /^Shot list/ });
  await expect(shotList).toBeVisible();
  await shotList.click();
  await expect(page).toHaveURL(/view=shotlist/);
  await expect(page.getByRole('tab', { name: 'Shot list', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shoot(page, 'with-storyboard');
  // The root board keeps its single view.
  await page.goto(`/p/${project.id}`);
  await expect(viewTabs(page)).toHaveCount(0);

  // A second storyboard from the Projects page: a project holds several.
  await page.goto('/projects');
  const card = page.locator('.project-card').filter({
    has: page.getByRole('heading', { name: project.name }),
  });
  await card.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
  await page.getByRole('menuitem', { name: 'Aggiungi storyboard' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
  await expect(row('Storyboard 2')).toBeVisible();
  const boards = await (await page.request.get(`/api/v1/projects/${project.id}/boards`)).json();
  expect(boards.items.filter((b: { kind: string }) => b.kind === 'storyboard')).toHaveLength(2);

  // A moodboard has one view: no tabs.
  await sidebar.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
  await page.getByRole('menuitem', { name: 'Aggiungi moodboard' }).click();
  await expect(row('Moodboard')).toBeVisible();
  await expect(page.locator('.moodboard')).toBeVisible();
  await expect(viewTabs(page)).toHaveCount(0);
  await shoot(page, 'moodboard');

  // Views of this board, in the ⋯ menu of the root board: Moodboard goes on, and its views
  // are listed under the project.
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  const always = page.getByRole('menuitemcheckbox', { name: 'Lavagna' });
  await expect(always).toHaveAttribute('aria-checked', 'true');
  await expect(always).toHaveAttribute('aria-disabled', 'true');
  // The views a board may turn on are switches that show off as well as on.
  const moodboard = page.getByRole('menuitemcheckbox', { name: 'Moodboard' });
  await expect(moodboard).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Revisione' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(moodboard.locator('.ink-switch')).not.toHaveClass(/is-on/);
  await shoot(page, 'views-menu');
  // The keyboard turns it on: the first switch has the focus.
  await expect(moodboard).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Moodboard']);
  await expect(row('Lavagna')).toBeVisible();
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  await expect(moodboard).toHaveAttribute('aria-checked', 'true');
  await expect(moodboard.locator('.ink-switch')).toHaveClass(/is-on/);
  await page.keyboard.press('Escape');
  await blur(page);
  await shoot(page, 'board-with-moodboard');
  // An address that asks for a view that is off opens the board's first view.
  await page.goto(`/p/${project.id}?view=shotlist`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Lavagna', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a scene of a new storyboard gets a set plan without a canvas', async ({ page, baseURL }) => {
  const origin = baseURL ?? '';
  const project = await setup(page, origin);
  const story = await addStoryboard(page.request, origin, project, ['shotlist']);
  await page.goto(`/p/${project.id}/b/${story.id}`);
  await page.locator('.board-state').getByRole('button', { name: 'Nuova scena' }).click();
  const scene = page.locator('[data-story-scene]').first();
  const newPlan = scene.getByRole('button', { name: 'Nuova pianta del set', exact: true });
  await expect(newPlan).toBeVisible();
  await page.mouse.move(0, 0);
  await blur(page);
  await shoot(page, 'scene-new-plan');
  await newPlan.click();
  // It opens in the plan editor on its own, and the scene now opens it.
  const editor = page.getByRole('dialog', { name: /Pianta del set/ });
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveCount(0);
  await expect(editor.getByText('Scena 1', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Fatto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(newPlan).toHaveCount(0);
  await scene.getByRole('button', { name: 'Pianta del set', exact: true }).click();
  await expect(editor).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('the same states in the drawer', async ({ page, baseURL }) => {
    const origin = baseURL ?? '';
    const project = await setup(page, origin);
    await page.goto(`/p/${project.id}`);
    const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigazione', exact: true });
    await expect(drawer.getByRole('button', { name: 'Nuova board', exact: true })).toBeVisible();
    await shoot(page, 'phone-empty-project');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // One view: no picker.
    await expect(page.getByRole('combobox', { name: 'Vista', exact: true })).toHaveCount(0);
    await blur(page);
    await shoot(page, 'phone-board');
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await drawer.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Aggiungi storyboard' })).toBeVisible();
    await shoot(page, 'phone-project-menu');
    await page.getByRole('menuitem', { name: 'Aggiungi storyboard' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
    // The drawer closes on the new board, as it does for a link.
    await expect(drawer).toBeHidden();
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await expect(drawer.getByRole('link', { name: /^Shot list/ })).toBeVisible();
    await shoot(page, 'phone-with-storyboard');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await blur(page);
    await shoot(page, 'phone-storyboard');
    expect(await switcherOptions(page, 'phone-switcher-storyboard')).toEqual([
      'Storyboard',
      'Shot list',
    ]);
    // A moodboard has one view: no picker on the phone either.
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await drawer.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
    await page.getByRole('menuitem', { name: 'Aggiungi moodboard' }).click();
    await expect(page.locator('.moodboard')).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Vista', exact: true })).toHaveCount(0);
    await shoot(page, 'phone-moodboard');
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await expect(drawer.getByRole('link', { name: 'Moodboard', exact: true })).toBeVisible();
    await shoot(page, 'phone-moodboard-drawer');
  });
});
