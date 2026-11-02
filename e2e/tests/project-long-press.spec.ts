// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
// QA 2026-11-02 round 2, R2-07: holding a project in the phone drawer opens its menu.
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

test('a long press on a project in the drawer opens its menu, a tap opens the project', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL as string;
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    { headers: { origin }, data: admin },
  );
  expect(auth.ok()).toBe(true);
  const stamp = Date.now();
  const name = `Pressione ${stamp}`;
  const created = await page.request.post('/api/v1/projects', {
    headers: { origin },
    data: { name },
  });
  expect(created.ok()).toBe(true);
  const group = await page.request.post('/api/v1/project-groups', {
    headers: { origin },
    data: { name: `Gruppo ${stamp}`, color: 'orange' },
  });
  expect(group.ok()).toBe(true);

  const openDrawer = () =>
    page
      .getByRole('navigation', { name: 'Navigazione principale', exact: true })
      .getByRole('button', { name: 'Progetti', exact: true })
      .click();
  await page.goto('/');
  await openDrawer();
  const drawer = page.getByRole('dialog', { name: 'Navigazione', exact: true });
  await expect(drawer).toBeVisible();
  const link = drawer.getByRole('link', { name });
  // Earlier specs leave many projects in the list: the new one may be below the fold.
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  if (!box) throw new Error('project link missing');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Real touches through the DevTools protocol, as in touch-gestures.spec.ts.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchEnd', points: Array<{ x: number; y: number }>) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, id: 1 })),
    });

  await touch('touchStart', [at]);
  await page.waitForTimeout(800);
  await expect(page.getByRole('menuitem', { name: 'Sposta in gruppo…' })).toBeVisible();
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  // The lift did not follow the link.
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(page.getByRole('menuitem', { name: 'Sposta in gruppo…' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Sposta in gruppo…' })).toHaveCount(0);
  // A short tap still opens the project.
  if (!(await drawer.isVisible())) await openDrawer();
  await link.tap();
  await expect(page).toHaveURL(/\/p\//);
});
