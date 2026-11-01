import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';

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
  page.getByRole('tab').filter({ hasText: /^(Lavagna|Moodboard|Storyboard|Shot list|Piano riprese|Revisione)$/ });
const filmTabs = ['Storyboard', 'Shot list', 'Piano riprese'];

/** The phone's view switcher: the options it lists. */
async function switcherOptions(page: Page) {
  await page.getByLabel('Vista', { exact: true }).click();
  const list = page.getByRole('listbox');
  const names = await list.getByRole('option').allTextContents();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  return names;
}

/** The share dialog's guest links, opened from the board. */
async function guestLinks(page: Page) {
  await page.getByRole('button', { name: 'Condividi' }).click();
  const dialog = page.getByRole('dialog', { name: /^Condividi/ });
  await dialog.getByRole('tab', { name: 'Link per ospiti' }).click();
  return dialog;
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
  // The header tabs follow the sidebar: the board's own two views only.
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Moodboard']);
  await shoot(page, 'empty-project');

  // The row opens the New board dialog for this project.
  await newBoard.click();
  const dialog = page.getByRole('dialog', { name: 'Nuova board' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A client review link on a board without a storyboard: Review appears at once, without the
  // other film links, and opens the cards of that board.
  const canvas = page.getByTestId('canvas');
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  await canvas.dblclick({ position: { x: 300, y: 250 } });
  await page.keyboard.type('Palette del cliente');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-type="note"]')).toHaveText('Palette del cliente');
  const dialog2 = await guestLinks(page);
  await dialog2.getByRole('button', { name: 'Nuovo link per ospiti' }).click();
  await chooseSelect(dialog2.getByLabel('Chi apre il link'), 'guest_approve');
  await dialog2.getByLabel('Per chi è (facoltativo)').fill('Cliente');
  await dialog2.getByRole('button', { name: 'Crea link per ospiti' }).click();
  const row = dialog2.getByRole('listitem').filter({ hasText: 'Cliente' });
  await expect(row.getByText('Attivo', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog2).toBeHidden();
  await expect(review).toBeVisible();
  await expect(film).toHaveCount(0);
  // Live, like the sidebar: Review joins the header tabs, the film views stay out.
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Revisione', 'Moodboard']);
  await shoot(page, 'review-without-storyboard');
  await review.click();
  await expect(page).toHaveURL(/view=review/);
  const reviewView = page.getByRole('region', { name: 'Revisione', exact: true });
  await expect(reviewView.locator('.client-review__frame')).toHaveCount(1);
  await expect(reviewView.getByText('Palette del cliente').first()).toBeVisible();
  await expect(film).toHaveCount(0);
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Revisione', 'Moodboard']);
  await expect(page.getByRole('tab', { name: 'Revisione', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shoot(page, 'review-view-cards');

  // Revoked, the link no longer keeps Review in the sidebar.
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  const dialog3 = await guestLinks(page);
  const live = dialog3.getByRole('listitem').filter({ hasText: 'Cliente' });
  await live.getByRole('button', { name: 'Revoca' }).click();
  await live.getByRole('button', { name: 'Revoca il link' }).click();
  await expect(live.getByText('Revocato', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog3).toBeHidden();
  await expect(review).toHaveCount(0);
  await expect(viewTabs(page)).toHaveText(['Lavagna', 'Moodboard']);

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
  await expect(viewTabs(page)).toHaveText([
    'Lavagna',
    ...filmTabs,
    'Revisione',
  ]);
  // The project's other boards offer the same tabs: here, the root board.
  await page.goto(`/p/${project.id}`);
  await expect(viewTabs(page)).toHaveText(['Lavagna', ...filmTabs, 'Revisione', 'Moodboard']);
  await page.goBack();
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
    expect(await switcherOptions(page)).toEqual(['Lavagna', 'Moodboard']);
    await shoot(page, 'phone-switcher-empty');
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    // A live client review link brings Review into the drawer.
    const made = await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
      headers: { origin },
      data: { role: 'guest_approve', label: 'Cliente' },
    });
    expect(made.ok()).toBe(true);
    await page.reload();
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
    await expect(drawer.getByRole('link', { name: 'Revisione', exact: true })).toBeVisible();
    await shoot(page, 'phone-review-without-storyboard');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(await switcherOptions(page)).toEqual(['Lavagna', 'Revisione', 'Moodboard']);
    await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
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
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(await switcherOptions(page)).toEqual([
      'Lavagna',
      'Storyboard',
      'Shot list',
      'Piano riprese',
      'Revisione',
    ]);
  });
});
