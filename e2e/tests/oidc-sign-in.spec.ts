// SPDX-License-Identifier: AGPL-3.0-only
// Audit F-20: sign-in with an OpenID Connect provider in the browser. Runs in the auth-providers
// project (E2E_AUTH_PROVIDERS=1: scripts/oidc-provider.mjs and the mail sink, OIDC_TRUST_EMAIL
// off), after first-run.spec.ts. A new person joins from an invitation, comes back, and an
// existing account is linked only once its email is verified (docs/self-hosting/sign-in.md).
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';
import { signUpViaInvite } from './support/accounts.ts';
import { linkInMail } from './support/mail.ts';

const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const stamp = Date.now();

/** Clicks the provider's button and signs in on the provider's own page as `who`. */
async function withProvider(page: Page, who: { sub: string; email: string; name: string }) {
  await page.getByRole('button', { name: 'Continua con E2E SSO' }).click();
  await page.getByLabel('Subject').fill(who.sub);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Name').fill(who.name);
  await page.getByRole('button', { name: 'Sign in to the provider' }).click();
}

async function me(page: Page) {
  const res = await page.request.get('/api/v1/me');
  return res.ok() ? ((await res.json()) as { id: string; email: string }) : null;
}

test.beforeEach(() => {
  test.skip(process.env.E2E_AUTH_PROVIDERS !== '1', 'needs E2E_AUTH_PROVIDERS=1');
});

test('OIDC: a new person joins from an invitation and signs in again', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const headers = { cookie: adminCookie, 'content-type': 'application/json', origin: base };
  const name = `OIDC join ${stamp}`;
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  expect(created.ok).toBe(true);
  const project = (await created.json()) as { id: string };
  const invited = await fetch(`${base}/api/v1/invitations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'link', projectId: project.id, role: 'editor' }),
  });
  expect(invited.ok).toBe(true);
  const { invitation } = (await invited.json()) as { invitation: { url: string } };
  const person = { sub: `oidc-new-${stamp}`, email: `olga-${stamp}@example.com`, name: 'Olga Sso' };

  // Registration is by invitation: the provider's button on the invitation page creates the
  // account and accepts the invitation.
  await page.goto(new URL(invitation.url).pathname);
  await withProvider(page, person);
  await expect(page).toHaveURL(new RegExp(`^${base}/`));
  await expect.poll(async () => (await me(page))?.email).toBe(person.email);
  const first = await me(page);
  const projects = (await (await page.request.get('/api/v1/projects')).json()) as {
    items: Array<{ id: string }>;
  };
  expect(projects.items.map((p) => p.id)).toContain(project.id);

  // Back another day: the same subject signs in to the same account from the sign-in page.
  await page.context().clearCookies();
  await page.goto('/login');
  await withProvider(page, person);
  await expect(page.getByRole('heading', { name: /Olga$/ })).toBeVisible();
  expect((await me(page))?.id).toBe(first?.id);
});

test('OIDC: an existing account is linked only once its email is verified', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;
  const adminCookie = await signIn(base, admin);
  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `OIDC link ${stamp}` }),
  });
  expect(created.ok).toBe(true);
  const project = (await created.json()) as { id: string };
  const member = {
    name: 'Lia Link',
    email: `lia-${stamp}@example.com`,
    password: 'correct-horse-battery',
  };
  await signUpViaInvite(base, adminCookie, project.id, 'editor', member);
  const person = { sub: `oidc-link-${stamp}`, email: member.email, name: member.name };

  // A password account's email is not verified: the same address at the provider is refused.
  await page.goto('/login');
  await withProvider(page, person);
  await expect(page).toHaveURL(/\/login\?.*error=account_not_linked/);
  await expect(page.getByText('Esiste già un account con questa email.')).toBeVisible();
  expect(await me(page)).toBeNull();

  // A link by email verifies it.
  await page.getByLabel('Email').fill(member.email);
  await page.getByRole('button', { name: 'Inviami un link' }).click();
  await expect(page.getByText('Controlla la posta')).toBeVisible();
  await page.goto(await linkInMail(member.email, '/api/auth/magic-link/verify'));
  await expect(page.getByRole('heading', { name: /Lia$/ })).toBeVisible();
  const account = await me(page);
  expect(account?.email).toBe(member.email);

  // Now the provider, which marks the address verified, signs in to that same account.
  await page.context().clearCookies();
  await page.goto('/login');
  await withProvider(page, person);
  await expect(page.getByRole('heading', { name: /Lia$/ })).toBeVisible();
  expect((await me(page))?.id).toBe(account?.id);
});
