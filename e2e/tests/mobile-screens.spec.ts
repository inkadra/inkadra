import { expect, type Locator, type Page, test } from '@playwright/test';

// The smallest phone width the app supports. Uses the account created by first-run.spec.ts,
// and creates it when run on its own.
test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** Nothing on the page is wider than the screen. */
async function fitsWidth(page: Page) {
  const width = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}

/** A finger-sized target: 44 px tall at least. */
async function touchSized(target: Locator) {
  const box = await target.boundingBox();
  expect(box, await target.evaluate((el) => el.outerHTML.slice(0, 80))).not.toBeNull();
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
}

test('phone screens fit 360 px with finger-sized targets', async ({ page, baseURL }) => {
  // Signed out: the sign-in form.
  const instance = await (await page.request.get('/api/v1/instance')).json();
  if (instance.setupRequired) {
    const created = await page.request.post('/api/auth/sign-up/email', {
      headers: { origin: baseURL! },
      data: admin,
    });
    expect(created.ok()).toBe(true);
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await fitsWidth(page);
  for (const field of [page.getByLabel('Email'), page.getByLabel('Password')])
    await touchSized(field);
  await touchSized(page.getByRole('button', { name: 'Accedi', exact: true }));
  // Installed on iOS, the app opens standalone under its own name.
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/,
  );
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();

  // Home: a one-row header, and a bottom bar of five equal tabs.
  await fitsWidth(page);
  const header = page.locator('.ink-shell > .ink-header');
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57);
  // The drawer opens from Projects in the bottom bar only.
  await expect(header.getByRole('button', { name: 'Navigazione', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  const tabs = nav.getByRole('button');
  await expect(tabs).toHaveCount(5);
  const sizes = await tabs.evaluateAll((all) =>
    all.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    }),
  );
  for (const size of sizes) {
    expect(Math.round(size.height)).toBeGreaterThanOrEqual(44);
    expect(size).toEqual(sizes[0]);
  }
  // New is a tab like the others: no filled block behind its label.
  expect(
    await nav
      .getByRole('button', { name: 'Nuovo', exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');

  // The drawer: a close icon in its title row.
  await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigazione', exact: true });
  const close = drawer.getByRole('button', { name: 'Chiudi navigazione', exact: true });
  await expect(close).toBeFocused();
  await touchSized(close);
  await close.click();
  await expect(drawer).toBeHidden();

  // New project: the dialog fits the screen and its actions stay in reach while the form scrolls.
  await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Crea', exact: true });
  await sheet.getByRole('button', { name: 'Nuovo progetto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuovo progetto', exact: true });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(box.y + box.height).toBeLessThanOrEqual(780);
  const create = dialog.getByRole('button', { name: 'Crea progetto', exact: true });
  await expect(create).toBeInViewport();
  await touchSized(create);
  await touchSized(dialog.getByLabel('Nome del progetto'));
  await dialog.getByLabel('Nome del progetto').fill(`Phone ${Date.now()}`);
  // A project with nothing else to set up opens straight away.
  await create.click();
  await expect(page).toHaveURL(/\/p\//);

  // A board: back, the view picker, share, comments and the menu on one 56 px row.
  await expect(page.locator('.mobile-view-switcher')).toBeVisible();
  const headerBox = (await header.boundingBox())!;
  expect(headerBox.height).toBeLessThanOrEqual(57);
  for (const control of [
    header.getByRole('button', { name: 'Indietro', exact: true }),
    page.locator('.mobile-view-switcher'),
    header.locator('.board-share'),
    header.locator('.comments-button'),
    header.locator('#board-header-menu'),
  ]) {
    const b = (await control.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(b.y + b.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
  }
  await fitsWidth(page);

  // Settings: full-screen pages with 44 px controls.
  for (const path of ['/settings', '/settings?section=account', '/settings/team']) {
    await page.goto(path);
    const settings = page.locator('dialog.settings-window');
    await expect(settings.locator('h2').first()).toBeVisible();
    await fitsWidth(page);
    await touchSized(settings.getByRole('button', { name: 'Chiudi impostazioni', exact: true }));
    for (const button of await settings.locator('.ink-btn:visible').all()) await touchSized(button);
  }

  // Not found: a real button back home.
  await page.goto('/nessuna-pagina');
  await touchSized(page.getByRole('link', { name: 'Torna alla home', exact: true }));
});
