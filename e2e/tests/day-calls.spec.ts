import { expect, test } from '@playwright/test';

// Decision 0092: a person's own call, set in the day's Calls tab, reaches the call sheet.
// Uses the account created by first-run.spec.ts, with a project of its own.
test('a call set in the Convocazioni tab is printed on the call sheet', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const headers = { origin: new URL(page.url()).origin };
  const project = await (
    await page.request.post('/api/v1/projects', { headers, data: { name: 'Day calls' } })
  ).json();
  const board = await (
    await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: { parentBoardId: project.rootBoardId, title: 'Spot', kind: 'storyboard' },
    })
  ).json();
  const crew = await page.request.post(`/api/v1/projects/${project.id}/crew/bulk`, {
    headers,
    data: {
      items: [
        { name: 'Ada Neri', role: 'DOP', department: 'Camera', phone: '+39 333 0000001' },
        { name: 'Bruno Sala', role: 'Cast', department: 'Cast', phone: '' },
      ].map((person, position) => ({
        email: '',
        pickup: '',
        notes: '',
        userId: null,
        character: null,
        onSetContact: false,
        position,
        ...person,
      })),
    },
  });
  expect(crew.status()).toBe(201);
  // The calendar opens on today.
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  const day = await page.request.post(`/api/v1/boards/${board.id}/schedule`, {
    headers,
    data: {
      date: today,
      callTime: '07:00',
      wrap: null,
      location: '',
      notes: '',
      blocks: [],
    },
  });
  expect(day.status()).toBe(201);

  await page.goto(`/p/${project.id}/b/${board.id}`);
  await page.getByRole('tab', { name: 'Piano riprese', exact: true }).click();
  const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  const inspector = schedule.getByRole('complementary', { name: 'Dettagli del giorno di riprese' });
  await inspector.getByRole('tab', { name: /^Convocazioni/ }).click();
  // Crew are called by default; cast only when the blocks name them.
  await expect(inspector.getByRole('checkbox', { name: 'Ada Neri convocato oggi' })).toBeChecked();
  await expect(inspector.getByText('Non convocato oggi · Bruno Sala')).toBeVisible();
  // The call shows the day's call until a time is typed.
  const call = inspector.getByLabel('Convocazione di Ada Neri', { exact: true });
  await expect(call).toContainText('07:00');
  await call.click();
  await call.fill('06:15');
  await inspector.getByLabel('Pick-up di Ada Neri', { exact: true }).fill('Hotel Roma');
  await expect(schedule.locator('.schedule__status')).toHaveText(/Salvato alle/);

  await page.reload();
  await schedule.getByRole('radio', { name: 'Giorno', exact: true }).check();
  await schedule.getByRole('button', { name: 'Foglio di lavorazione', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const troupe = sheet.locator('.sheet__table--troupe');
  await expect(troupe).toBeVisible();
  const row = troupe.getByRole('row').filter({ hasText: 'Ada Neri' });
  await expect(row).toContainText('06:15');
  await expect(row).toContainText('Hotel Roma');
  await expect(row).toContainText('+39 333 0000001');
  await expect(troupe).not.toContainText('Bruno Sala');
});
