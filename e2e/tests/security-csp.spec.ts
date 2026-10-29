import { expect, test } from '@playwright/test';

// Uses the account created by first-run.spec.ts. The server sends its Content-Security-Policy
// report-only, and the browser still raises `securitypolicyviolation` for every breach.
test('Home and a board load without Content-Security-Policy violations', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
    );
  });
  const violations = () =>
    page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);

  const headers = (await page.goto('/login'))?.headers() ?? {};
  expect(
    headers['content-security-policy'] ?? headers['content-security-policy-report-only'],
  ).toContain("script-src 'self'");
  await page.getByLabel('Email').fill('giulia@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  expect(await violations()).toEqual([]);

  const origin = new URL(page.url()).origin;
  const project = await (
    await page.request.post('/api/v1/projects', { headers: { origin }, data: { name: 'CSP' } })
  ).json();
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
  expect(await violations()).toEqual([]);
});
