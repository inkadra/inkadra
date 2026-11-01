import { expect, type Page, test } from '@playwright/test';
import { chooseSelect } from '../helpers/select.ts';

// Uses the account created by first-run.spec.ts, and creates it when run on its own.
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const shots = process.env.GROUPS_SCREENSHOTS;

async function signIn(page: Page, origin: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin }, data: admin },
  );
  expect(auth.ok()).toBe(true);
}

async function project(page: Page, origin: string, name: string, icon?: object) {
  const res = await page.request.post('/api/v1/projects', {
    headers: { origin },
    data: { name, ...(icon ? { icon } : {}) },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string };
}

/** Light and dark, in the folder the review screenshots go to. */
async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      localStorage.setItem('inkadra.theme', value);
      window.dispatchEvent(new Event('inkadra-theme-change'));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Lets the theme's colour transitions and the drawer's slide finish.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
}

test('projects go into personal groups by dragging, fold and leave a dissolved group', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? '';
  await signIn(page, origin);
  // Screenshots run on an empty instance, with the names of the mockup.
  const stamp = shots ? '' : ` ${Date.now()}`;
  if (shots) {
    await project(page, origin, 'Last Train', { shape: 'circle', color: 'blue' });
    await project(page, origin, 'Val Bregaglia', { shape: 'triangle', color: 'green' });
    const series = await page.request.post('/api/v1/project-groups', {
      headers: { origin },
      data: { name: 'Serie Montagne', color: 'purple' },
    });
    for (const name of ['Ep. 1 · Bernina', 'Ep. 2 · Maloja']) {
      const ep = await project(page, origin, name, { shape: 'hexagon', color: 'purple' });
      await page.request.put(`/api/v1/projects/${ep.id}/group`, {
        headers: { origin },
        data: { groupId: (await series.json()).id },
      });
    }
    // Folded, as the third group of the mockup.
    await page.request.patch(`/api/v1/project-groups/${(await series.json()).id}`, {
      headers: { origin },
      data: { collapsed: true },
    });
  }
  const summer = await project(page, origin, `Spot Aurora · Estate${stamp}`, {
    shape: 'square',
    color: 'orange',
  });
  const christmas = await project(page, origin, `Spot Aurora · Natale${stamp}`, {
    shape: 'square',
    color: 'red',
  });
  await page.goto('/projects');
  const main = page.getByRole('main');
  const sidebar = page.locator('.ink-shell > .ink-sidebar');

  // A new group: name and colour, personal.
  await main.getByRole('button', { name: 'Nuovo gruppo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuovo gruppo' });
  await dialog.getByLabel('Nome del gruppo').fill(`Caffè Aurora${stamp}`);
  await dialog.getByRole('radio', { name: 'Arancione' }).click();
  await expect(dialog).toContainText('Solo per te');
  await shoot(page, 'new-group-dialog');
  await dialog.getByRole('button', { name: 'Crea' }).click();
  await expect(dialog).toBeHidden();
  const section = main.getByRole('region', { name: `Caffè Aurora${stamp}` });
  await expect(section).toContainText('0 progetti');

  // Dragging a card onto the group puts the project in it, on the page and in the sidebar.
  const card = (name: string) =>
    main.locator('.project-card').filter({ has: page.getByRole('heading', { name }) });
  const groupRow = sidebar.getByRole('button', { name: new RegExp(`^Caffè Aurora${stamp}`) });
  await card(`Spot Aurora · Estate${stamp}`).dragTo(groupRow);
  await expect(
    section.getByRole('heading', { name: `Spot Aurora · Estate${stamp}` }),
  ).toBeVisible();
  await expect(section).toContainText('1 progetto');
  await expect(groupRow).toHaveAttribute('aria-expanded', 'true');
  await expect(
    sidebar.locator('.project-group-nav__items').getByRole('link', {
      name: `Spot Aurora · Estate${stamp}`,
    }),
  ).toBeVisible();

  if (shots) {
    // Mid-drag: the card stays as a placeholder and the group lights up in both places.
    const source = card(`Spot Aurora · Natale${stamp}`);
    await source.hover();
    await page.mouse.down();
    const head = section.locator('.project-group-head');
    const box = await groupRow.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
      await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
    }
    await expect(head).toHaveClass(/is-drop/);
    await shoot(page, 'drag-onto-group');
    await page.mouse.up();
    await expect(section).toContainText('2 progetti');
    await shoot(page, 'grouped');
    await section.getByRole('button', { name: `Opzioni gruppo: Caffè Aurora${stamp}` }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await shoot(page, 'group-menu');
    await page.keyboard.press('Escape');
  } else {
    // The keyboard (and phone) way: Move to group… in the project menu.
    await card(`Spot Aurora · Natale${stamp}`)
      .getByRole('button', { name: /^Opzioni progetto/ })
      .click();
    await page.getByRole('menuitem', { name: 'Sposta in gruppo…' }).click();
    const move = page.getByRole('dialog', { name: /^Sposta in gruppo…/ });
    await chooseSelect(move.getByLabel('Gruppo'), { label: `Caffè Aurora${stamp}` });
    await move.getByRole('button', { name: 'Sposta', exact: true }).click();
    await expect(section).toContainText('2 progetti');
  }

  // Folding is remembered on the server.
  await groupRow.click();
  await expect(groupRow).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(
    sidebar.getByRole('button', { name: new RegExp(`^Caffè Aurora${stamp}`) }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    main.getByRole('region', { name: `Caffè Aurora${stamp}` }).locator('.project-card'),
  ).toHaveCount(0);
  await sidebar.getByRole('button', { name: new RegExp(`^Caffè Aurora${stamp}`) }).click();

  if (shots) {
    // Phone: the drawer lists the groups; a long press opens Move to group….
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('navigation', { name: 'Navigazione principale', exact: true })
      .getByRole('button', { name: 'Progetti', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Navigazione', exact: true })).toBeVisible();
    await shoot(page, 'phone-drawer');
    await page.keyboard.press('Escape');
    await card(`Spot Aurora · Estate${stamp}`).getByRole('heading').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Sposta in gruppo…' }).click();
    await shoot(page, 'phone-move-dialog');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Dissolving the group keeps both projects, outside any group.
  await main
    .getByRole('region', { name: `Caffè Aurora${stamp}` })
    .getByRole('button', { name: `Opzioni gruppo: Caffè Aurora${stamp}` })
    .click();
  await page.getByRole('menuitem', { name: 'Sciogli il gruppo' }).click();
  await expect(main.getByRole('region', { name: `Caffè Aurora${stamp}` })).toHaveCount(0);
  await expect(card(`Spot Aurora · Estate${stamp}`)).toBeVisible();
  await expect(card(`Spot Aurora · Natale${stamp}`)).toBeVisible();
  for (const p of [summer, christmas]) {
    const res = await page.request.get(`/api/v1/projects/${p.id}`);
    expect((await res.json()).group).toBeNull();
  }
});
