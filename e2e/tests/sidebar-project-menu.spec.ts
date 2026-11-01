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

/** The server answers board-counts as is; the flag is what a card in client review adds. */
async function reviewing(page: Page, rootBoardId: string, on: boolean) {
  await page.unroute('**/board-counts');
  if (!on) return;
  await page.route('**/board-counts', async (route) => {
    const body = await (await route.fetch()).json();
    for (const item of body.items) if (item.boardId === rootBoardId) item.inReviewCount = 1;
    await route.fulfill({ json: body });
  });
}

test('the sidebar of a project without boards or storyboard, and Add storyboard in its menu', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? '';
  const project = await setup(page, origin);
  const sidebar = page.locator('.ink-shell > .ink-sidebar');
  const openSidebar = () => expect(sidebar).toBeVisible();
  // The row carries the frame count after its name.
  const film = sidebar.getByRole('link', { name: /^Storyboard\b/ });
  const review = sidebar.getByRole('link', { name: 'Revisione', exact: true });

  // No boards, no storyboard: the Board heading has a quiet New board row, and no film links.
  await page.goto(`/p/${project.id}`);
  await openSidebar();
  await expect(sidebar.getByText('Board', { exact: true })).toBeVisible();
  const newBoard = sidebar.getByRole('button', { name: 'Nuova board', exact: true });
  await expect(newBoard).toBeVisible();
  await expect(film).toHaveCount(0);
  await expect(review).toHaveCount(0);
  await shoot(page, 'empty-project');

  // The row opens the New board dialog for this project.
  await newBoard.click();
  const dialog = page.getByRole('dialog', { name: 'Nuova board' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A card in client review keeps Review listed, without the rest of the film links.
  await reviewing(page, project.rootBoardId, true);
  await page.reload();
  await openSidebar();
  await expect(review).toBeVisible();
  await expect(film).toHaveCount(0);
  await shoot(page, 'review-without-storyboard');
  await reviewing(page, project.rootBoardId, false);
  await page.reload();
  await openSidebar();
  await expect(review).toHaveCount(0);

  // Add storyboard… in the project's menu makes one, opens it and lists the film links.
  await sidebar.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
  const item = page.getByRole('menuitem', { name: 'Aggiungi storyboard…' });
  await expect(item).toBeVisible();
  await shoot(page, 'project-menu');
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
  await openSidebar();
  await expect(film).toBeVisible();
  await expect(review).toBeVisible();
  // Only the storyboard exists, listed as a module: the section is still empty.
  await expect(sidebar.getByRole('button', { name: 'Nuova board', exact: true })).toBeVisible();
  await shoot(page, 'with-storyboard');
  const storyboardUrl = page.url();

  // The project has its storyboard: the Projects page menu opens it instead of adding another.
  await page.goto('/projects');
  const card = page.locator('.project-card').filter({
    has: page.getByRole('heading', { name: project.name }),
  });
  await card.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
  await page.getByRole('menuitem', { name: 'Aggiungi storyboard…' }).click();
  await expect(page).toHaveURL(storyboardUrl);
  const boards = await (await page.request.get(`/api/v1/projects/${project.id}/boards`)).json();
  expect(boards.items.filter((b: { kind: string }) => b.kind === 'storyboard')).toHaveLength(1);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('the same states in the drawer', async ({ page, baseURL }) => {
    test.skip(!shots, 'Screenshots only');
    const origin = baseURL ?? '';
    const project = await setup(page, origin);
    await page.goto(`/p/${project.id}`);
    const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigazione', exact: true });
    await expect(drawer.getByRole('button', { name: 'Nuova board', exact: true })).toBeVisible();
    await shoot(page, 'phone-empty-project');
    await drawer.getByRole('button', { name: `Opzioni progetto: ${project.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Aggiungi storyboard…' })).toBeVisible();
    await shoot(page, 'phone-project-menu');
    await page.getByRole('menuitem', { name: 'Aggiungi storyboard…' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.id}/b/`));
    // The drawer closes on the new board, as it does for a link.
    await expect(drawer).toBeHidden();
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await expect(drawer.getByRole('link', { name: 'Revisione', exact: true })).toBeVisible();
    await shoot(page, 'phone-with-storyboard');
  });
});
