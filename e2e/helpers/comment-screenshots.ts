import type { Page } from '@playwright/test';

/** Optional QA captures; normal CI only runs the assertions. */
export async function captureComments(page: Page, state: string) {
  const directory = process.env.COMMENTS_SHOTS_DIR;
  if (!directory) return;
  const viewport = page.viewportSize();
  const previous = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${directory}/${theme}-${width}-${state}.png` });
    }
  }
  if (viewport) await page.setViewportSize(viewport);
  await page.evaluate((value) => {
    if (value === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
  }, previous);
}
