import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

// Exercise the actual styles without needing accounts, notifications or backend services.
const styles = [
  '../../packages/ui/src/tokens.css',
  '../../packages/ui/src/styles.css',
  '../../apps/web/src/notifications/notifications.css',
  '../../apps/web/src/routes/mobile-shell.css',
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

async function render(page: Page, theme: string, fixed = true) {
  await page.setContent(`
    <html data-theme="${theme}"><head><style>${styles}</style></head><body>
      <div style="position:relative; margin:48px 0 0 262px; height:600px">
        <div class="notifications${fixed ? ' notifications--fixed' : ''}">
          <div class="notifications__list-pane">
            <header class="notifications__head"><h2>Inbox</h2></header>
            <div class="notifications-filter-tabs">
              <button class="notifications-filter-tab is-active">All</button>
            </div>
            <div class="notifications__list-container">
              <div class="notification is-selected is-unread">
                <button class="notification__open notification__open--drawer">
                  <span class="notification__body">
                    <span class="notification__line"><strong>Alex</strong> commented</span>
                    <span class="notification__pill">Storyboard</span>
                    <span class="notification__excerpt">Please review this frame.</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
          ${
            fixed
              ? `<div class="notifications__detail-pane"><div class="inbox-detail">
                  <header class="inbox-detail__head">Conversation</header>
                  <div class="inbox-detail__body">
                    <div class="inbox-detail__card-section">Frame context</div>
                    <div class="inbox-detail__conversation">
                      <div class="inbox-detail__message-body">Please review this frame.</div>
                      <div class="inbox-detail__composer">
                        <textarea class="inbox-detail__composer-textarea">A reply</textarea>
                      </div>
                    </div>
                  </div>
                </div></div>`
              : ''
          }
        </div>
      </div>
    </body></html>`);
}

async function contrast(page: Page, foreground: string, background: string) {
  return page.evaluate(
    ({ foreground, background }) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
        return channels.reduce((sum, value, index) => {
          const c = value / 255;
          return (
            sum +
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]!
          );
        }, 0);
      };
      const fg = luminance(getComputedStyle(document.querySelector(foreground)!).color);
      const bg = luminance(getComputedStyle(document.querySelector(background)!).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    },
    { foreground, background },
  );
}

for (const theme of ['light', 'dark']) {
  test(`inbox fills the desktop viewport and has readable ${theme} surfaces`, async ({ page }) => {
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await render(page, theme);
      await expect(page.locator('.notifications')).toHaveCSS('position', 'fixed');
      expect(await page.locator('.notifications').boundingBox()).toEqual({
        // A floating surface (#333): after the collapsed navigation's logo button, over the
        // header, 12 px from the window edges.
        x: 66,
        y: 12,
        width: width - 66 - 12,
        height: 900 - 24,
      });
      await expect(page.locator('.notifications__detail-pane')).toBeVisible();
      const body = page.locator('.inbox-detail__body');
      expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      for (const [fg, bg] of [
        ['.notification__line strong', '.notifications__list-pane'],
        ['.notification__excerpt', '.notification__open'],
        ['.notifications-filter-tab.is-active', '.notifications__list-pane'],
        ['.inbox-detail__message-body', '.inbox-detail'],
        ['.inbox-detail__composer-textarea', '.inbox-detail__composer'],
      ]) {
        expect(await contrast(page, fg!, bg!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test(`mobile inbox fits above navigation in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await render(page, theme);
    expect(await page.locator('.notifications').boundingBox()).toEqual({
      // Between the phone header and the bottom navigation.
      x: 0,
      y: 56,
      width: 390,
      height: 844 - 56 - 64,
    });
    await expect(page.locator('.notifications__detail-pane')).toBeHidden();
    expect((await page.locator('.notifications__list-pane').boundingBox())?.width).toBe(390);
  });

  test(`bell popover stays anchored and contains its list in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await render(page, theme, false);
    const popover = page.locator('.notifications');
    await expect(popover).toHaveCSS('position', 'absolute');
    expect((await popover.boundingBox())?.width).toBe(380);
    expect(await popover.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
}
