import type { BrowserContext, Page } from '@playwright/test';

/**
 * Leaves these files (all, without ids) out of the real `POST /assets/lookup` answers, as the
 * server does for a file it cannot show: the app then asks each of them on
 * `GET /assets/{id}`, where a test fakes its metadata. Register it after any route that
 * matches the lookup URL too: Playwright runs the latest route first.
 */
export const omitFromLookup = (target: Page | BrowserContext, ids?: string[]) =>
  target.route('**/api/v1/assets/lookup', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const { items } = (await response.json()) as { items: { id: string }[] };
    await route.fulfill({
      response,
      json: { items: ids ? items.filter((a) => !ids.includes(a.id)) : [] },
    });
  });
