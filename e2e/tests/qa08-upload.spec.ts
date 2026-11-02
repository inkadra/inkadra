import { expect, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

test('QA cancellation stops a throttled upload and the panel reports speed and time', async ({
  page,
  baseURL,
}) => {
  if (process.env.QA_THEME)
    await page.addInitScript(
      (theme) => localStorage.setItem('inkadra.theme', theme),
      process.env.QA_THEME,
    );
  const cookie = await signIn(baseURL!, {
    name: 'Giulia',
    email: 'giulia@example.com',
    password: 'correct-horse-battery',
  });
  await page.context().addCookies(
    cookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: baseURL! };
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: 'QA cancellation' },
  });
  const project = await response.json();
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.locator('.canvas')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 2e6,
    uploadThroughput: 200_000,
  });
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(8 * 1024 * 1024)], 'cancel-me.bin'));
    return dt;
  });
  await page
    .locator('.canvas')
    .dispatchEvent('drop', { dataTransfer: transfer, clientX: 400, clientY: 260 });
  const panel = page.locator('.uploads');
  await expect(panel).toBeVisible();
  await expect.soft(panel).toContainText('MB/s', { timeout: 10_000 });
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/03-upload-progress.png` });
  const aborted = page.waitForEvent('requestfailed', {
    predicate: (r) => r.method() === 'PATCH' && r.url().includes('/uploads/'),
  });
  await panel.getByRole('button', { name: 'Annulla' }).click();
  await aborted;
  await expect(panel).toContainText('Annullato');
  if (process.env.QA_SHOTS)
    await page.screenshot({ path: `${process.env.QA_SHOTS}/03-upload-cancelled.png` });
  await cdp.detach();
});
