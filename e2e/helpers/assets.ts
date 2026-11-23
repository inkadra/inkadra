import type { BrowserContext, Page } from '@playwright/test';

/**
 * Answers `POST /assets/lookup` as an older server does (404), so the app asks each file on
 * `GET /assets/{id}`. For tests that fake the metadata of one file on that route.
 */
export const singleAssetRoute = (target: Page | BrowserContext) =>
  target.route('**/api/v1/assets/lookup', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } }),
  );
