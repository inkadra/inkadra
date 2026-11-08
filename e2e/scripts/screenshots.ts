import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';
import { type SampleProject, seedSampleProject } from './sample-project.ts';

/**
 * Builds a sample project on an empty instance and takes the screenshots of the README
 * (docs/screenshots/readme) and of the guide (docs/screenshots/guide), in the dark and the light
 * theme. The instance needs the -media image, and ffmpeg must be on the PATH of this machine:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 pnpm --filter @inkadra/e2e screenshots
 *
 * SHOTS_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium, and
 * SHOTS_ARGS adds browser flags (`--disable-gpu` where there is no desktop, as over SSH).
 *
 * No report is sent: the report dialog stops at its preview.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const readme = fileURLToPath(new URL('../../docs/screenshots/readme', import.meta.url));
const guide = fileURLToPath(new URL('../../docs/screenshots/guide', import.meta.url));
const themes = ['dark', 'light'] as const;
type Theme = (typeof themes)[number];

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : process.env.SHOTS_CHANNEL
        ? { channel: process.env.SHOTS_CHANNEL }
        : {}),
    args: process.env.SHOTS_ARGS?.split(' ').filter(Boolean) ?? [],
  });
  mkdirSync(readme, { recursive: true });
  mkdirSync(guide, { recursive: true });

  // What the first person sees, before the sample project creates the first account.
  for (const theme of themes) {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      colorScheme: theme,
    });
    const page = await context.newPage();
    await settle(page, '/', join(guide, `first-run-${theme}.png`));
    await context.close();
  }

  const sample = await seedSampleProject(browser, base);
  const { project, storyboard } = sample;

  const boardUrl = `/p/${project.id}`;
  const storyUrl = `/p/${project.id}/b/${storyboard.id}`;
  for (const theme of themes) {
    const { page, close } = await open(browser, sample.cookie, theme);
    await shoot(page, boardUrl, join(readme, `board-${theme}.png`));
    await shoot(page, storyUrl, join(readme, `storyboard-${theme}.png`));
    await shoot(page, `${storyUrl}?view=shotlist`, join(readme, `shotlist-${theme}.png`));
    await shoot(page, '/', join(readme, `home-${theme}.png`));
    await close();
  }
  for (const theme of themes) {
    const { page, close } = await open(browser, sample.cookie, theme);
    await shootGuide(page, sample, theme);
    await close();
    await shootPhone(browser, sample, theme);
  }
  await browser.close();
  console.log(`Screenshots in ${readme} and ${guide}`);
}

async function open(browser: Browser, cookie: string, theme: Theme) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    colorScheme: theme,
  });
  await context.addCookies(cookies(cookie));
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

function cookies(cookie: string) {
  return cookie.split('; ').map((c) => {
    const [name, ...value] = c.split('=');
    return { name: name as string, value: value.join('='), url: base };
  });
}

async function shootGuide(page: Page, sample: SampleProject, theme: Theme) {
  const { project, casting, setPlan, planId, storyboard, rushes } = sample;
  const canvas = (board: string) => `/p/${project.id}/b/${board}?view=canvas`;
  const file = (name: string) => join(guide, `${name}-${theme}.png`);

  // The contextual toolbar and the dock.
  await fit(page, canvas(project.rootBoardId));
  await page.locator('.card--note').first().dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await save(page, file('toolbar'));

  // The comments panel.
  await fit(page, canvas(project.rootBoardId));
  await page.locator('.comments-button').click();
  await page.locator('.comments-panel').waitFor();
  await save(page, file('comments'));

  // A frame's panel, then Draw, on the arrow the sample drew over the first frame.
  await fit(page, canvas(storyboard.id));
  await page.locator('.card--frame').first().dblclick();
  await page.locator('.film-panel').waitFor();
  await save(page, file('frame-panel'));
  await page.getByRole('button', { name: 'Draw', exact: true }).last().click();
  await page.locator('.pen').waitFor();
  await save(page, file('draw'));

  // The set plan with the camera selected: both bars.
  await fit(page, canvas(setPlan.id));
  await page.locator(`[data-el="${planId}"]`).dblclick();
  const stage = page.getByRole('dialog').locator('.plan-editor__stage');
  await stage.waitFor();
  const box = await stage.boundingBox();
  if (!box) throw new Error('The plan has no stage');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.78);
  await save(page, file('set-plan'));

  // The character sheet.
  await fit(page, canvas(casting.id));
  await page.locator('.card--character', { hasText: 'Anna' }).dblclick();
  await page.locator('.story-panel').waitFor();
  await save(page, file('character'));

  // A video playing inside its card, paused on a frame so the two themes match. The board holds
  // more than the take: select it and zoom to it.
  await fit(page, canvas(rushes.id));
  await page.locator('.card--file').first().locator('.fcard__footer').click();
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(800);
  await page.locator('.card--file .fcard__play').first().click();
  const video = page.locator('.card--file video').first();
  await video.waitFor();
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 3;
    await new Promise((done) => v.addEventListener('seeked', done, { once: true }));
  });
  await save(page, file('video-card'));

  // Administrators: classifications and reports. The dialog stops at its preview, nothing is sent.
  await settle(page, '/settings?section=classifications', file('classifications'));
  await page.goto('/settings?section=instance');
  await page.getByRole('heading', { name: 'Reports', exact: true }).scrollIntoViewIfNeeded();
  await save(page, file('reports-settings'));

  await fit(page, canvas(project.rootBoardId));
  await page.keyboard.press('Control+Shift+B');
  const form = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await form.getByLabel('Title', { exact: true }).fill('The dock covers the last column');
  await form
    .getByLabel('Description', { exact: true })
    .fill('At 1280 px the dock sits on top of the Palette column until I zoom out.');
  await save(page, file('report-dialog'));
  await form.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preview of what you send', exact: true }).waitFor();
  await save(page, file('report-preview'));
}

async function shootPhone(browser: Browser, sample: SampleProject, theme: Theme) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    colorScheme: theme,
  });
  await context.addCookies(cookies(sample.cookie));
  const page = await context.newPage();
  await page.goto(`/p/${sample.project.id}/b/${sample.rushes.id}?view=canvas`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.locator('.card--file').first().tap();
  await save(page, join(guide, `phone-${theme}.png`));
  await context.close();
}

async function shoot(page: Page, path: string, file: string) {
  if (path !== '/' && !path.includes('view=')) await fit(page, path);
  else await page.goto(path);
  await page.waitForLoadState('networkidle');
  await save(page, file);
}

/** Opens a board and fits its content to the window. */
async function fit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page
    .getByTestId('canvas')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(800);
}

async function settle(page: Page, path: string, file: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await save(page, file);
}

/** Takes the picture with the pointer out of the way, so that nothing shows a hover state. */
async function save(page: Page, file: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(file);
}

await main();
