// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts (the administrator exists). Storage limits (decision 0081): the
// space of a person, uploads refused for lack of space and the administrators' pages. The
// limits go back off at the end, whatever happens: the other specs share the instance.
// Set E2E_SHOTS to a folder to also capture every state, phone and desktop, dark and light.
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { signIn, uploadFile } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';

const shots = process.env.E2E_SHOTS;
const admin = { name: 'Giulia Bianchi', email: 'giulia@example.com', password: 'correct-horse-battery' };
const stamp = Date.now();
const member = {
  name: 'Sara Conti',
  email: `storage-limits-${stamp}@example.com`,
  password: 'correct-horse-battery',
};
const KB = 1000;

async function theme(page: Page, value: 'dark' | 'light') {
  await page.evaluate((v) => {
    localStorage.setItem('inkadra.theme', v);
    window.dispatchEvent(new Event('inkadra-theme-change'));
  }, value);
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
}

/** Desktop and phone, dark and light, of what is on screen; nothing without E2E_SHOTS. */
async function shoot(page: Page, name: string, opts: { phone?: boolean; full?: boolean } = {}) {
  if (!shots) return;
  const sizes = opts.phone === false ? ['desktop'] : ['desktop', 'phone'];
  for (const size of sizes) {
    await page.setViewportSize(size === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
    for (const value of ['dark', 'light'] as const) {
      await theme(page, value);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${name}-${size}-${value}.png`, fullPage: opts.full });
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await theme(page, 'dark');
}

async function useCookie(context: BrowserContext, base: string, cookie: string) {
  await context.clearCookies();
  await context.addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
}

test('storage limits: own space, refused uploads, limits and members', async ({ page, baseURL }) => {
  test.setTimeout(shots ? 360_000 : 120_000);
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const call = (cookie: string, method: string, path: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const project = (await (
    await call(adminCookie, 'POST', '/projects', { name: `Last Train ${stamp}` })
  ).json()) as { id: string };
  const memberCookie = await signUpViaInvite(base, adminCookie, project.id, 'editor', member);
  const me = (await (await call(memberCookie, 'GET', '/me')).json()) as { id: string };
  const upload = (bytes: number, name: string) =>
    uploadFile(base, memberCookie, project.id, {
      body: Buffer.alloc(bytes, 7),
      name,
      type: 'application/octet-stream',
    });

  try {
    // Off by default: only what is used.
    await useCookie(page.context(), base, memberCookie);
    await page.goto('/settings?section=account');
    const card = page.locator('.space-card', { hasText: 'Il tuo spazio' });
    await expect(card.getByText('Senza limite')).toBeVisible();
    await expect(card.getByRole('meter')).toHaveCount(0);
    await shoot(page, 'space-unlimited', { phone: false });

    // 850 KB of 1 MB: past the warning share.
    expect((await call(adminCookie, 'PATCH', '/instance/storage-limits', { perUser: 1000 * KB })).ok).toBe(true);
    expect(await upload(850 * KB, 'Sopralluogo_stazione.mov')).not.toBeNull();
    await page.reload();
    await expect(card.getByText('Restano 150 KB')).toBeVisible();
    await expect(card.getByRole('meter')).toHaveAttribute('aria-valuemax', String(1000 * KB));
    await shoot(page, 'space-near');

    // On a board: three files at once, two do not fit.
    await page.goto(`/p/${project.id}?view=canvas`);
    await page.locator('input[type="file"][multiple]').setInputFiles([
      { name: 'Note_luci.txt', mimeType: 'text/plain', buffer: Buffer.alloc(40 * KB, 65) },
      { name: 'Prova_trucco_04.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(300 * KB, 1) },
      { name: 'Plancia_luci.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(140 * KB, 2) },
    ]);
    const dialog = page.getByRole('dialog', { name: 'Non c’è abbastanza spazio' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Abbiamo caricato 1 file su 3; questi 2 non ci stanno:')).toBeVisible();
    await expect(dialog.getByRole('rowheader', { name: 'Prova_trucco_04.mov' })).toBeVisible();
    await shoot(page, 'upload-blocked');
    await dialog.getByRole('button', { name: 'Chiedi più spazio' }).click();
    await expect(dialog.getByText('Abbiamo avvisato gli amministratori.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Chiudi', exact: true }).first().click();
    await expect(dialog).toBeHidden();

    // One file alone: a toast.
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'Sopralluogo_porto.mov',
      mimeType: 'video/quicktime',
      buffer: Buffer.alloc(500 * KB, 3),
    });
    const toast = page.locator('.toast', { hasText: 'Sopralluogo_porto.mov' });
    await expect(toast).toBeVisible();
    await shoot(page, 'upload-toast', { phone: false });
    await toast.getByRole('button', { name: 'Dettagli' }).click();
    await page.getByRole('dialog', { name: 'Non c’è abbastanza spazio' }).getByRole('button', { name: 'Chiudi', exact: true }).first().click();

    // Full: the limit drops under what is used, nothing is deleted.
    await call(adminCookie, 'PATCH', `/instance/members/${me.id}`, { storageLimit: 800 * KB });
    await page.goto('/settings?section=account');
    await expect(card.getByText('Pieno')).toBeVisible();
    await expect(card.getByText('Non puoi caricare altri file.', { exact: false })).toBeVisible();
    await shoot(page, 'space-full');
    await card.getByRole('button', { name: 'Vedi i file più grandi' }).click();
    const files = page.getByRole('dialog', { name: 'I tuoi file più grandi' });
    await expect(files.getByRole('rowheader', { name: /Sopralluogo_stazione\.mov/ })).toBeVisible();
    await shoot(page, 'largest-files');
    await files.getByRole('button', { name: 'Fatto' }).click();

    // Administrators: limits in Storage, the space of each person in Members.
    await call(adminCookie, 'PATCH', `/instance/members/${me.id}`, { storageLimit: null });
    expect((await call(adminCookie, 'PATCH', '/instance/storage-limits', { total: 1100 * KB })).ok).toBe(true);
    await useCookie(page.context(), base, adminCookie);
    await page.goto('/settings?section=workspace');
    const limits = page.locator('.settings-card', { hasText: 'Limiti di spazio' });
    await expect(limits.getByRole('radio', { name: 'Limite', exact: true }).first()).toBeChecked();
    await expect(page.locator('.space-card', { hasText: 'Spazio usato' }).getByRole('meter')).toBeVisible();
    await shoot(page, 'storage-limits', { full: true });

    await page.goto('/settings/team');
    const row = page.locator('.team-table tr', { hasText: member.email });
    await expect(row.getByRole('meter')).toBeVisible();
    await row.getByRole('button', { name: `Azioni per ${member.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Cambia il limite di spazio…' })).toBeVisible();
    await shoot(page, 'members-space', { phone: false });
    await page.getByRole('menuitem', { name: 'Cambia il limite di spazio…' }).click();
    const own = page.getByRole('dialog', { name: `Spazio di ${member.name}` });
    await own.getByRole('radio', { name: 'Limite suo' }).check();
    await shoot(page, 'members-limit-dialog');
    await own.getByRole('button', { name: 'Annulla' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row.getByRole('meter')).toBeVisible();
    if (shots) {
      await row.scrollIntoViewIfNeeded();
      for (const value of ['dark', 'light'] as const) {
        await theme(page, value);
        await page.screenshot({ path: `${shots}/members-space-phone-${value}.png` });
      }
      await theme(page, 'dark');
    }
    await page.setViewportSize({ width: 1280, height: 860 });

    // The instance past its warning share: one Inbox alert, as the Server alerts (a minute).
    if (shots) {
      await expect
        .poll(
          async () => {
            const res = await call(adminCookie, 'GET', '/notifications?limit=20');
            const { items } = (await res.json()) as { items: Array<{ serverAlert?: { kind: string } | null }> };
            return items.some((n) => n.serverAlert?.kind === 'storage_limit');
          },
          { timeout: 120_000, intervals: [5_000] },
        )
        .toBe(true);
      await page.goto('/inbox');
      await expect(page.getByText('Spazio dell’istanza:', { exact: false }).first()).toBeVisible();
      await shoot(page, 'inbox-storage');
    }
  } finally {
    await call(adminCookie, 'PATCH', '/instance/storage-limits', { total: null, perUser: null, warnPercent: 80 });
    await call(adminCookie, 'PATCH', `/instance/members/${me.id}`, { storageLimit: null });
  }
});
