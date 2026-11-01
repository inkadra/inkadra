// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync } from 'node:fs';
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

// Runs after first-run.spec.ts, on the same instance: the administrator exists.
test.describe.configure({ mode: 'serial' });

const admin = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };
// Set to a folder to keep the screenshots of the cards (dark and light).
const shots = process.env.LINK_CARD_SHOTS;

test('a video plays inside its card, one at a time, and the viewer is one click away', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const base = baseURL as string;
  const cookie = await signIn(base, admin);
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Video nelle card' }),
  });
  const { id: projectId, rootBoardId } = (await created.json()) as {
    id: string;
    rootBoardId: string;
  };

  // A picture to stand in for the thumbnails the link preview would copy.
  await page.setContent(
    '<body style="margin:0;width:640px;height:340px;background:linear-gradient(135deg,#1c2430,#5a6a7a)">',
  );
  await page.setViewportSize({ width: 640, height: 340 });
  const thumbnail = await page.screenshot();
  await page.setViewportSize({ width: 1440, height: 900 });
  const imageAssetId = await uploadFile(base, cookie, projectId, {
    body: thumbnail,
    name: 'thumb.png',
    type: 'image/png',
  });
  if (!imageAssetId) throw new Error('upload failed');
  await waitForAssets(base, cookie, [imageAssetId]);

  const doc = new Y.Doc();
  initBoardDoc(doc, rootBoardId);
  const links = [
    {
      url: 'https://www.youtube.com/watch?v=yMnFHFf43Qg',
      title: 'I built a better Homepod',
      description: 'Another Channel',
    },
    {
      url: 'https://vimeo.com/123456',
      title: 'Beyond the Grid',
      description: 'Studio · 4:21',
    },
    {
      url: 'https://www.instagram.com/reel/C1abc_-9/',
      title: 'Behind the scenes, night shoot',
      description: '@lasttrain',
    },
  ];
  for (const [i, link] of links.entries())
    createElement(
      doc,
      'link',
      { x: 60 + i * 340, y: 80 },
      { w: 300, imageAssetId, ...link },
      { userId: null },
    );
  await pushBoardDoc(base, cookie, rootBoardId, doc);

  // The players are third-party pages: answer for them, and record every request to check
  // that nothing is asked of them before play.
  const requested: string[] = [];
  for (const origin of ['https://www.youtube-nocookie.com', 'https://player.vimeo.com']) {
    await page.route(`${origin}/**`, (route) => {
      requested.push(route.request().url());
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body style="margin:0;background:#000;color:#fff;font:13px sans-serif;display:grid;place-items:center;height:100vh">Player</body>',
      });
    });
  }
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { violations: string[] }).violations = violations;
    document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(e.effectiveDirective),
    );
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await page.goto(`/p/${projectId}/b/${rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();

  const youtube = page.locator('[data-type="link"]', { hasText: 'Homepod' });
  const vimeo = page.locator('[data-type="link"]', { hasText: 'Beyond the Grid' });
  const instagram = page.locator('[data-type="link"]', { hasText: 'night shoot' });
  await expect(page.locator('[data-type="link"]')).toHaveCount(3);

  // Before play there is no iframe and nothing was asked of YouTube or Vimeo.
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(requested).toEqual([]);

  // Instagram: a badge and a link out, never a player.
  await expect(instagram.locator('.card__badge')).toHaveText('Instagram');
  await expect(instagram.locator('a.card__expand')).toHaveAttribute(
    'href',
    'https://www.instagram.com/reel/C1abc_-9/',
  );
  await expect(instagram.locator('.card__play')).toHaveCount(0);

  // Play on the card: the player takes the thumbnail's place in the card.
  await youtube.locator('.card__play').click();
  const player = youtube.locator('.card__embed iframe');
  await expect(player).toHaveAttribute(
    'src',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/yMnFHFf43Qg\?autoplay=1/,
  );
  await expect(youtube.locator('img')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('.viewer')).toHaveCount(0);

  // A second video returns the first to its thumbnail.
  await vimeo.locator('.card__play').click();
  await expect(vimeo.locator('.card__embed iframe')).toHaveAttribute(
    'src',
    /^https:\/\/player\.vimeo\.com\/video\/123456\?dnt=1&autoplay=1/,
  );
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(youtube.locator('iframe')).toHaveCount(0);
  await expect(youtube.locator('.card__play')).toBeVisible();

  if (shots) {
    mkdirSync(shots, { recursive: true });
    await youtube.locator('.card__play').click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      await page.mouse.move(700, 600);
      await page.screenshot({ path: `${shots}/cards-${theme}.png` });
    }
    await vimeo.locator('.card__play').click();
  }

  // Esc returns the playing card to its thumbnail.
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(vimeo.locator('.card__play')).toBeVisible();

  // ↗ stops the card's player and opens the viewer, which plays the same video.
  await youtube.locator('.card__play').click();
  await youtube.locator('.card__embed .card__expand').click();
  await expect(page.locator('.viewer__iframe')).toHaveAttribute(
    'src',
    /youtube-nocookie\.com\/embed\/yMnFHFf43Qg/,
  );
  await expect(youtube.locator('.card__embed')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer__iframe')).toHaveCount(0);

  // The CSP let both players in.
  expect(
    await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
  ).toEqual([]);
});
