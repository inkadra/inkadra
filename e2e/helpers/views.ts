import { type APIRequestContext, expect, type Page } from '@playwright/test';

/**
 * Turns on an optional view of the open board from "Views of this board" in its ⋯ menu: a new
 * board starts with only the view of its kind, a new storyboard with its shot list (decision 0121).
 */
export async function turnOn(page: Page, view: string) {
  await page.getByRole('button', { name: 'Menu della board', exact: true }).click();
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && /\/api\/v1\/boards\/[^/]+$/.test(r.url()),
  );
  await page.getByRole('menuitemcheckbox', { name: view, exact: true }).click();
  expect((await saved).ok()).toBe(true);
}

/** The same through the API, for a board a test makes there. */
export async function setViews(
  request: APIRequestContext,
  origin: string,
  boardId: string,
  views: string[],
) {
  const res = await request.patch(`/api/v1/boards/${boardId}`, {
    headers: { origin },
    data: { views },
  });
  expect(res.ok()).toBe(true);
}

/**
 * A storyboard under the project root with the views a test opens: the film views belong to
 * storyboards, never to the project's root board (decision 0121).
 */
export async function addStoryboard(
  request: APIRequestContext,
  origin: string,
  project: { id: string; rootBoardId: string },
  views: string[] = ['shotlist', 'schedule', 'troupe', 'review'],
  title = 'Storyboard',
): Promise<{ id: string }> {
  const res = await request.post(`/api/v1/projects/${project.id}/boards`, {
    headers: { origin },
    data: { parentBoardId: project.rootBoardId, title, kind: 'storyboard' },
  });
  expect(res.ok()).toBe(true);
  const board = (await res.json()) as { id: string };
  await setViews(request, origin, board.id, views);
  return board;
}

/** `setViews` for a seed that signs in with a cookie of its own. */
export async function setViewsAs(base: string, cookie: string, boardId: string, views: string[]) {
  const res = await fetch(`${base}/api/v1/boards/${boardId}`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ views }),
  });
  if (!res.ok) throw new Error(`views of ${boardId}: ${res.status} ${await res.text()}`);
}
