import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { seedSampleProject } from './sample-project.ts';

/**
 * Builds a sample project on an empty instance and takes the screenshots of the README
 * (docs/screenshots/readme), in the dark and the light theme:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e screenshots
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium, and
 * SHOTS_ARGS adds browser flags (`--disable-gpu` where there is no desktop, as over SSH).
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../../docs/screenshots/readme', import.meta.url));

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : process.env.SHOTS_CHANNEL
        ? { channel: process.env.SHOTS_CHANNEL }
        : {}),
    args: process.env.SHOTS_ARGS?.split(' ').filter(Boolean) ?? [],
  });
  const { cookie, project, storyboard } = await seedSampleProject(browser, base);

  mkdirSync(out, { recursive: true });
  const boardUrl = `/p/${project.id}`;
  const storyUrl = `/p/${project.id}/b/${storyboard.id}`;
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      colorScheme: theme,
    });
    await context.addCookies(
      cookie.split('; ').map((c) => {
        const [name, ...value] = c.split('=');
        return { name: name as string, value: value.join('='), url: base };
      }),
    );
    const page = await context.newPage();
    await shoot(page, boardUrl, join(out, `board-${theme}.png`));
    await shoot(page, storyUrl, join(out, `storyboard-${theme}.png`));
    await shoot(page, `${storyUrl}?view=shotlist`, join(out, `shotlist-${theme}.png`));
    await shoot(page, '/', join(out, `home-${theme}.png`));
    await context.close();
  }
  await browser.close();
  console.log(`Screenshots in ${out}`);
}

async function shoot(page: Page, path: string, file: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (path !== '/' && !path.includes('view=')) {
    await page
      .getByTestId('canvas')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await page.keyboard.press('Shift+Digit1');
  }
  await page.waitForTimeout(1500);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file });
  console.log(file);
}

await main();
