import { expect, type Locator, type Page, test } from '@playwright/test';
import { captureComments } from '../helpers/comment-screenshots.ts';

async function api(page: Page, path: string, method = 'POST', body: unknown = {}) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

async function setup(
  page: Page,
  card = false,
): Promise<{
  id: string;
  rootBoardId: string;
  elementId: string | null;
  panel: Locator;
  box: Locator;
}> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  const project = await api(page, '/projects', 'POST', { name: 'Comments review regressions' });
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  let elementId: string | null = null;
  if (card) {
    await page.getByTestId('canvas').dblclick({ position: { x: 300, y: 260 } });
    await page.keyboard.type('Review card');
    await page.keyboard.press('Escape');
    const note = page.locator('[data-type="note"]', { hasText: 'Review card' });
    elementId = await note.getAttribute('data-el');
    await expect
      .poll(() =>
        api(page, `/boards/${project.rootBoardId}/elements/${elementId}/review`, 'PUT', {
          status: 'none',
        }).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await note.click();
    await page.getByRole('toolbar').getByRole('button', { name: 'Commenti e revisione' }).click();
  } else await page.getByRole('button', { name: /^Commenti:/ }).click();
  const panel = page.getByRole('complementary', { name: 'Commenti' });
  return {
    ...project,
    elementId,
    panel,
    box: panel.locator('.comment-composer--new').getByRole('combobox'),
  };
}

async function addThread(
  page: Page,
  project: Awaited<ReturnType<typeof setup>>,
  visibility: string,
) {
  const comment = await api(page, `/boards/${project.rootBoardId}/comments`, 'POST', {
    visibility,
    body: 'Original comment',
    ...(project.elementId ? { elementId: project.elementId } : {}),
  });
  await expect(project.panel.getByText('Original comment')).toBeVisible();
  return project.panel.locator(`[data-thread="${comment.id}"]`);
}

test('Enter on the focused send button sends to guests', async ({ page }) => {
  const { panel, box } = await setup(page);
  await box.fill('Sent from the keyboard');
  await panel.getByRole('radio', { name: 'Anche ospiti', exact: true }).check();
  await panel.getByRole('button', { name: 'Invia agli ospiti' }).press('Enter');
  await expect(
    panel.locator('.comment-body').filter({ hasText: 'Sent from the keyboard' }),
  ).toBeVisible();
});

test('Enter on the audience radio cannot send to guests', async ({ page }) => {
  const { panel, box } = await setup(page);
  await box.fill('Do not send with a key');
  await panel.getByRole('radio', { name: 'Team', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('radio', { name: 'Anche ospiti', exact: true })).toBeChecked();
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/comments')) posts++;
  });
  await panel.getByRole('radio', { name: 'Anche ospiti', exact: true }).press('Enter');
  await expect(box).toHaveValue('Do not send with a key');
  await expect(
    panel.locator('.comment-body').filter({ hasText: 'Do not send with a key' }),
  ).toHaveCount(0);
  expect(posts).toBe(0);
  await panel.getByRole('button', { name: 'Invia agli ospiti' }).click();
  await expect(
    panel.locator('.comment-body').filter({ hasText: 'Do not send with a key' }),
  ).toBeVisible();
});

test('an empty composer resets its audience when collapsed', async ({ page }) => {
  const { panel, box } = await setup(page);
  await box.focus();
  await panel.getByRole('radio', { name: 'Anche ospiti', exact: true }).check();
  await panel.getByRole('heading', { name: 'Commenti' }).click();
  await expect(panel.locator('.comment-composer--new')).not.toHaveClass(/is-open/);
  await box.focus();
  await expect(panel.getByRole('radio', { name: 'Team', exact: true })).toBeChecked();
});

test('private replies have no outgoing audience warning', async ({ page }) => {
  const project = await setup(page);
  const thread = await addThread(page, project, 'team');
  await thread.getByRole('button', { name: 'Rispondi', exact: true }).click();
  await expect(thread.locator('.comment-audience')).toHaveCount(0);
});

test('comment action names identify the author', async ({ page }) => {
  const project = await setup(page);
  const thread = await addThread(page, project, 'team');
  await expect(
    thread.getByRole('button', { name: 'Azioni sul commento di Giulia Bianchi' }),
  ).toBeVisible();
});

test('Escape from comment actions restores keyboard focus', async ({ page }) => {
  const project = await setup(page);
  const thread = await addThread(page, project, 'team');
  const button = thread.getByRole('button', { name: /Azioni/ });
  await button.click();
  await page.getByRole('menu').press('Escape');
  await expect(button).toBeFocused();
  await expect(project.panel).toBeVisible();
});

test('unknown review statuses cannot be overwritten', async ({ page }) => {
  const project = await setup(page, true);
  await api(page, `/boards/${project.rootBoardId}/elements/${project.elementId}/review`, 'PUT', {
    status: 'approved',
  });
  await page.route(`**/api/v1/boards/${project.rootBoardId}/reviews`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items = data.items.map((item: { elementId: string }) =>
      item.elementId === project.elementId ? { ...item, status: 'future_status' } : item,
    );
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await page.locator('[data-type="note"]').click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Commenti e revisione' }).click();
  await project.panel.getByRole('button', { name: /^Revisione:/ }).click();
  await expect(project.panel.getByRole('button', { name: 'Aggiorna la revisione' })).toHaveCount(0);
  await expect(
    project.panel.getByRole('button', { name: 'Cronologia', exact: true }),
  ).toBeVisible();
});

for (const action of ['Annulla', 'Aggiorna la revisione']) {
  test(`review details close after ${action}`, async ({ page }) => {
    const { panel } = await setup(page, true);
    const toggle = panel.getByRole('button', { name: /^Revisione:/ });
    await toggle.click();
    await panel.getByRole('button', { name: action, exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(panel.getByRole('button', { name: 'Aggiorna la revisione' })).toBeVisible();
  });
}

test('failed sends keep the error within the composer width', async ({ page }) => {
  const { panel, box } = await setup(page);
  await page.route('**/api/v1/boards/*/comments', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'failure' } })
      : route.continue(),
  );
  await box.fill('Keep this draft');
  await panel.getByRole('button', { name: 'Commenta', exact: true }).click();
  const error = panel.locator('.comment-composer--new [role="alert"]');
  await expect(error).toBeVisible();
  const bounds = await error.boundingBox();
  const field = await box.boundingBox();
  expect(bounds!.width).toBeGreaterThan(field!.width - 10);
  await expect(box).toHaveValue('Keep this draft');
  await captureComments(page, 'send-error');
});

test('editing a public comment warns and requires the send button', async ({ page }) => {
  const project = await setup(page);
  const thread = await addThread(page, project, 'everyone');
  await thread.getByRole('button', { name: /Azioni/ }).click();
  await page.getByRole('menuitem', { name: 'Modifica', exact: true }).click();
  await expect(thread.locator('.comment-composer .comment-audience')).toBeVisible();
  const box = thread.getByRole('combobox');
  await box.fill('Changed public text');
  await box.press('ControlOrMeta+Enter');
  await expect(box).toHaveValue('Changed public text');
  await expect(thread.getByRole('combobox')).toBeVisible();
  await thread.getByRole('button', { name: 'Salva' }).click();
  await expect(thread.getByText('Changed public text', { exact: true })).toBeVisible();
});

test('guest-link replies state the exact link audience', async ({ page }) => {
  const project = await setup(page);
  const original = await api(page, `/boards/${project.rootBoardId}/comments`, 'POST', {
    visibility: 'everyone',
    body: 'Link comment',
  });
  await page.route(`**/api/v1/boards/${project.rootBoardId}/comments?**`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items = data.items.map((item: { id: string }) =>
      item.id === original.id
        ? { ...item, shareLinkId: 'fixture-link', shareLinkLabel: 'Cliente' }
        : item,
    );
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Commenti:/ }).click();
  const thread = project.panel.locator(`[data-thread="${original.id}"]`);
  await thread.getByRole('button', { name: 'Rispondi', exact: true }).click();
  await expect(
    thread.getByText('Anche gli ospiti del link “Cliente” leggono questa risposta.'),
  ).toBeVisible();
  await expect(thread.locator('.review-tag--out')).toHaveText('Solo il link “Cliente”');
  await captureComments(page, 'link-reply');
});

test('review chip and note remain fixed while discussions scroll', async ({ page }) => {
  const project = await setup(page, true);
  await api(page, `/boards/${project.rootBoardId}/elements/${project.elementId}/review`, 'PUT', {
    status: 'changes_requested',
    note: 'Keep this decision visible',
  });
  for (let index = 0; index < 12; index++)
    await api(page, `/boards/${project.rootBoardId}/comments`, 'POST', {
      elementId: project.elementId,
      body: `Discussion ${index}`,
    });
  const note = project.panel.locator('.review-note-preview');
  await expect(note).toBeVisible();
  await expect(project.panel.locator('.comment-thread')).toHaveCount(12);
  const before = await note.boundingBox();
  const body = project.panel.locator('.comments-panel__body');
  await expect
    .poll(() =>
      body.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return node.scrollTop;
      }),
    )
    .toBeGreaterThan(100);
  const after = await note.boundingBox();
  expect(after!.y).toBe(before!.y);
  await expect(project.panel.getByRole('button', { name: /^Revisione:/ })).toBeInViewport();
  await captureComments(page, 'many-fixed-note');
});
