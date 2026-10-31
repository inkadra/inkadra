import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Phone screenshots of the shell, first-run, auth and settings screens (release 0.6.1), at
 * 390×844 and 360×780, dark and light, on an empty instance:
 *
 *   SHOTS_BASE_URL=http://localhost:3200 SHOTS_OUT=../shots SHOTS_LABEL=after \
 *     pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-mobile.ts
 *
 * Next to the pictures, report.json lists what sticks out of the viewport and the touch
 * targets under 44 px on each screen. SHOTS_CHANNEL=chrome uses the installed Chrome;
 * SHOTS_ONLY=<regex> keeps only the matching screens.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = process.env.SHOTS_OUT ?? 'mobile-shots';
const label = process.env.SHOTS_LABEL ?? 'shot';
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : undefined;
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const sizes = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
] as const;
const themes = ['dark', 'light'] as const;
type Theme = (typeof themes)[number];

interface Finding {
  screen: string;
  size: number;
  theme: Theme;
  overflow: string[];
  smallTargets: string[];
}
const report: Finding[] = [];

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { cookie, origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Elements that leave the viewport sideways, and touch targets under 44 px. */
function inspect() {
  const width = window.innerWidth;
  const name = (el: Element) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  // Inside a container that scrolls or clips sideways, overflow is intended.
  const clipped = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) return true;
    }
    return false;
  };
  const overflow: string[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > width + 1 || r.left < -1) && !clipped(el)) overflow.push(name(el));
  }
  const smallTargets: string[] = [];
  for (const el of document.querySelectorAll(
    'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], input, select, summary',
  )) {
    if (!visible(el) || el.closest('[inert], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.height < 44 || r.width < 24)
      smallTargets.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return {
    overflow: [
      ...(document.scrollingElement && document.scrollingElement.scrollWidth > width
        ? [`document ${document.scrollingElement.scrollWidth}px wide`]
        : []),
      ...overflow.slice(0, 20),
    ],
    smallTargets: smallTargets.slice(0, 40),
  };
}

async function newContext(
  browser: Browser,
  size: (typeof sizes)[number],
  theme: Theme,
  cookie?: string,
) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: theme,
    locale: 'it-IT',
    serviceWorkers: 'block',
  });
  // tsx names the functions it compiles with a __name helper that the page does not have.
  await context.addInitScript({ content: 'window.__name = (fn) => fn;' });
  await context.addInitScript((t) => localStorage.setItem('inkadra.theme', t), theme);
  if (cookie)
    await context.addCookies(
      cookie.split('; ').map((pair) => {
        const at = pair.indexOf('=');
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: base };
      }),
    );
  return context;
}

let failures = 0;
function shooter(page: Page, size: (typeof sizes)[number], theme: Theme) {
  return async (screen: string, prepare: () => Promise<unknown>) => {
    // SHOTS_ONLY=<regex> still runs every step (later ones build on earlier ones) but saves
    // only the matching screens.
    const keep = !only || only.test(screen);
    try {
      await prepare();
      // Fonts, lazy stylesheets and enter transitions.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      if (!keep) return;
      await page.screenshot({
        path: join(out, `${screen}-${label}-${size.width}-${theme}.png`),
        animations: 'disabled',
      });
      report.push({ screen, size: size.width, theme, ...(await page.evaluate(inspect)) });
    } catch (err) {
      failures++;
      console.error(`${screen} ${size.width} ${theme}: ${(err as Error).message.split('\n')[0]}`);
    }
  };
}

async function closeAll(page: Page) {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
}

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.SHOTS_CHANNEL || undefined,
    args: process.env.SHOTS_ARGS?.split(' ').filter(Boolean),
  });

  const instance = await (await fetch(`${base}/api/v1/instance`)).json();
  if (instance.setupRequired) {
    for (const size of sizes)
      for (const theme of themes) {
        const context = await newContext(browser, size, theme);
        const page = await context.newPage();
        await shooter(
          page,
          size,
          theme,
        )('02-login-setup', async () => {
          await page.goto(`${base}/login`);
          await page.locator('form').first().waitFor();
        });
        await context.close();
      }
  }

  const cookie = await signIn(base, admin);
  const projects = await call<{ items: Array<{ id: string; name: string; rootBoardId: string }> }>(
    cookie,
    'GET',
    '/projects',
  );
  let project = projects.items.find((p) => p.name === 'Il treno delle sei');
  if (!project) {
    project = await call(cookie, 'POST', '/projects', { name: 'Il treno delle sei' });
    await call(cookie, 'POST', '/projects', {
      name: 'Spot Caffè Aurora — versione lunga per il cliente',
    });
    await call(cookie, 'POST', '/projects', { name: 'Videoclip notturno' });
  }
  const invitation = await call<{ status: string; invitation?: { url: string | null } }>(
    cookie,
    'POST',
    '/invitations',
    { kind: 'link', projectId: project!.id, role: 'editor' },
  );
  const joinPath = invitation.invitation?.url
    ? new URL(invitation.invitation.url).pathname
    : '/join/missing';

  for (const size of sizes)
    for (const theme of themes) {
      // Signed out.
      let context: BrowserContext = await newContext(browser, size, theme);
      let page = await context.newPage();
      let shoot = shooter(page, size, theme);
      await shoot('01-login', async () => {
        await page.goto(`${base}/login`);
        await page.locator('form').first().waitFor();
      });
      await shoot('03-reset-password', async () => {
        await page.goto(`${base}/reset-password?token=sample`);
        await page.locator('form').first().waitFor();
      });
      await shoot('04-join', async () => {
        await page.goto(`${base}${joinPath}`);
        await page.getByRole('heading').first().waitFor();
      });
      await context.close();

      // Signed in.
      context = await newContext(browser, size, theme, cookie);
      page = await context.newPage();
      shoot = shooter(page, size, theme);
      const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
      await shoot('05-home', async () => {
        await page.goto(`${base}/`);
        await nav.waitFor();
      });
      await shoot('06-drawer', async () => {
        await nav.getByRole('button', { name: 'Progetti', exact: true }).click();
        await page.getByRole('dialog', { name: 'Navigazione', exact: true }).waitFor();
      });
      await shoot('07-search', async () => {
        await page
          .getByRole('dialog', { name: 'Navigazione', exact: true })
          .getByRole('button', { name: /Cerca/ })
          .first()
          .click();
        await page.getByPlaceholder(/Cerca progetti/).waitFor();
        await page.getByPlaceholder(/Cerca progetti/).fill('tr');
        await page.waitForTimeout(600);
      });
      await closeAll(page);
      await shoot('08-new-sheet', async () => {
        await page.goto(`${base}/`);
        await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
        await page.getByRole('dialog', { name: 'Crea', exact: true }).waitFor();
      });
      await shoot('09-new-project', async () => {
        await page
          .getByRole('dialog', { name: 'Crea', exact: true })
          .getByRole('button', { name: 'Nuovo progetto', exact: true })
          .click();
        await page.getByRole('dialog').last().waitFor();
      });
      await closeAll(page);
      await shoot('10-new-board', async () => {
        await page.goto(`${base}/`);
        await nav.getByRole('button', { name: 'Nuovo', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'Crea', exact: true });
        await sheet
          .getByRole('button', { name: /^Nuova board/ })
          .first()
          .click();
        await page.getByRole('dialog', { name: 'Nuova board', exact: true }).waitFor();
      });
      await closeAll(page);
      await shoot('11-projects', async () => {
        await page.goto(`${base}/projects`);
        await page.getByText('Il treno delle sei').first().waitFor();
      });
      await shoot('12-project-menu', async () => {
        await page
          .getByRole('button', { name: /^Opzioni progetto: Il treno/ })
          .first()
          .click();
        await page.getByRole('menu').waitFor();
      });
      await shoot('13-project-appearance', async () => {
        await page.getByRole('menuitem', { name: 'Aspetto del progetto' }).click();
        await page.getByRole('dialog').last().waitFor();
      });
      await closeAll(page);
      await shoot('14-project-export', async () => {
        await page.goto(`${base}/projects`);
        await page
          .getByRole('button', { name: /^Opzioni progetto: Il treno/ })
          .first()
          .click();
        await page.getByRole('menuitem', { name: /Esporta progetto/ }).click();
        await page.getByRole('dialog').last().waitFor();
      });
      await closeAll(page);
      await shoot('15-project-import', async () => {
        await page.goto(`${base}/projects`);
        await page
          .getByRole('button', { name: /Importa progetto/ })
          .first()
          .click();
        await page.getByRole('dialog').last().waitFor();
      });
      await closeAll(page);
      await shoot('16-onboarding', async () => {
        await page.goto(`${base}/onboarding`);
        await page.getByRole('heading').first().waitFor();
      });
      await shoot('17-settings', async () => {
        await page.goto(`${base}/settings`);
        await page.locator('dialog.settings-window').waitFor();
      });
      for (const [n, section] of [
        ['18', 'account'],
        ['19', 'preferences'],
        ['20', 'notifications'],
        ['21', 'team'],
        ['22', 'workspace'],
        ['23', 'classifications'],
        ['24', 'providers'],
        ['25', 'registration'],
        ['26', 'backups'],
        ['27', 'instance'],
      ] as const) {
        await shoot(`${n}-settings-${section}`, async () => {
          await page.goto(
            `${base}${section === 'team' ? '/settings/team' : `/settings?section=${section}`}`,
          );
          await page
            .locator('dialog.settings-window h1, dialog.settings-window h2')
            .first()
            .waitFor();
          await page.waitForTimeout(500);
        });
      }
      await shoot('28-select-open', async () => {
        await page.goto(`${base}/settings?section=preferences`);
        await page.locator('dialog.settings-window [aria-haspopup="listbox"]').first().click();
        await page.getByRole('listbox').waitFor();
      });
      await closeAll(page);
      await shoot('29-diagnostics', async () => {
        await page.goto(`${base}/diagnostics`);
        await page.getByRole('heading').first().waitFor();
        await page.waitForTimeout(800);
      });
      await shoot('30-authorize', async () => {
        await page.goto(
          `${base}/authorize?client_id=mobile&redirect_uri=inkadra%3A%2F%2Fauth&code_challenge=abc&code_challenge_method=S256&device_name=Pixel%209`,
        );
        await page.getByRole('heading').first().waitFor();
      });
      await shoot('34-board-header', async () => {
        await page.goto(`${base}/p/${project!.id}`);
        await page.locator('.mobile-view-switcher').waitFor();
        await page.getByTestId('canvas').waitFor();
      });
      await shoot('31-not-found', async () => {
        await page.goto(`${base}/nessuna-pagina`);
        await page.locator('.ink-empty').first().waitFor();
      });
      await context.close();

      // Enrollment gate: the server's answer for an administrator without two-step verification.
      context = await newContext(browser, size, theme, cookie);
      page = await context.newPage();
      shoot = shooter(page, size, theme);
      await page.route('**/api/v1/instance/version', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'forbidden',
              message: 'Set up two-step verification to continue.',
              details: { reason: 'admin_two_factor_required' },
            },
          }),
        }),
      );
      await shoot('32-admin-enrollment', async () => {
        await page.goto(`${base}/`);
        await page.getByRole('alert').first().waitFor();
        await page.waitForTimeout(500);
      });
      await context.close();

      // Error page: a lazy route whose code cannot load.
      context = await newContext(browser, size, theme, cookie);
      page = await context.newPage();
      shoot = shooter(page, size, theme);
      await shoot('33-error', async () => {
        await page.goto(`${base}/`);
        await nav.waitFor().catch(() => {});
        await page
          .getByRole('navigation', { name: 'Navigazione principale', exact: true })
          .waitFor();
        await page.route('**/assets/**', (route) =>
          route.request().resourceType() === 'script' ? route.abort() : route.continue(),
        );
        await page.evaluate((id) => {
          history.pushState({}, '', `/p/${id}`);
          dispatchEvent(new PopStateEvent('popstate'));
        }, project!.id);
        await page.locator('.app-error').first().waitFor({ timeout: 10_000 });
      });
      await context.close();
    }

  writeFileSync(join(out, `report-${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(`${report.length} screenshots in ${out}, ${failures} failed`);
}

await main();
