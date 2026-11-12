import { expect, type Page, test } from '@playwright/test';

// Uses the account created by first-run.spec.ts, and creates it when run on its own.
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
// A folder to put light and dark screenshots of the sidebar states in (review only).
const shots = process.env.SIDEBAR_SHOTS;

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
  await expect(row('Shot list')).toBeVisible();
  await row('Shot list').click();
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

  // Views of this board, in the ⋯ menu of the root board: Moodboard goes on, and its views
  // are listed under the project.
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  const always = page.getByRole('menuitemcheckbox', { name: 'Lavagna' });
  await expect(always).toHaveAttribute('aria-checked', 'true');
  await expect(always).toHaveAttribute('aria-disabled', 'true');
  await shoot(page, 'views-menu');
  await page.getByRole('menuitemcheckbox', { name: 'Moodboard' }).click();
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Moodboard']);
  await expect(row('Lavagna')).toBeVisible();
  // An address that asks for a view that is off opens the board's first view.
  await page.goto(`/p/${project.id}?view=shotlist`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Lavagna', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await drawer.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Aggiungi storyboard' })).toBeVisible();
    await shoot(page, 'phone-project-menu');
    await page.getByRole('menuitem', { name: 'Aggiungi storyboard' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
    // The drawer closes on the new board, as it does for a link.
    await expect(drawer).toBeHidden();
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await expect(drawer.getByRole('link', { name: 'Shot list', exact: true })).toBeVisible();
    await shoot(page, 'phone-with-storyboard');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(await switcherOptions(page, 'phone-switcher-storyboard')).toEqual([
      'Storyboard',
      'Shot list',
    ]);
  });
});
