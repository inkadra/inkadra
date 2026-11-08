import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Screenshots of Settings → Server (#514), simple and advanced, desktop and phone, dark and
 * light. The page reads a week of history that an instance started for the screenshots does
 * not have, so its status comes from a fictional studio below (`demo`); one more shot per view
 * (`*-live-*`) shows what this instance itself reports.
 *
 *   SHOTS_BASE_URL=http://localhost:3514 pnpm --filter @inkadra/e2e exec tsx scripts/screenshots-server.ts
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out =
  process.env.SHOTS_OUT ??
  fileURLToPath(new URL('../../docs/screenshots/0.9.0-server-page', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { cookie, origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const RANGES = {
  '15m': { window: 900, step: 10 },
  '1h': { window: 3600, step: 20 },
  '24h': { window: 86_400, step: 480 },
  '7d': { window: 604_800, step: 3600 },
} as const;

/** A fictional studio's server: steady with a busy spell, as on the approved mockup. */
function demo(range: keyof typeof RANGES, now: number) {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const { window, step } = RANGES[range];
  const n = Math.floor(window / step);
  const walk = (start: number, amp: number, lo: number, hi: number) => {
    let v = start;
    return Array.from({ length: n }, () => {
      v = Math.min(hi, Math.max(lo, v + (rnd() - 0.5) * amp));
      return v;
    });
  };
  const busy = (i: number) => i > n * 0.62 && i < n * 0.82;
  const cpu = walk(30, 12, 4, 80).map((v, i) => (busy(i) ? Math.min(92, v + 28) : v));
  const mem = walk(1.8e9, 0.1e9, 1.2e9, 3.2e9);
  const rx = walk(1.8e6, 1e6, 0.1e6, 7e6);
  const tx = walk(0.5e6, 0.4e6, 0.05e6, 2.5e6);
  const p95 = walk(110, 30, 60, 380).map((v, i) => (busy(i) ? v + 110 : v));
  const t = (i: number) => new Date(now - (n - 1 - i) * step * 1000).toISOString();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const night = new Date(now);
  night.setHours(3, 0, 0, 0);
  const next = new Date(night.getTime() + 86_400_000);
  const ok = (id: string, detail: string | null = null) => ({
    id,
    status: 'ok',
    since: iso(2000),
    detail,
  });
  return {
    checkedAt: iso(0),
    version: '0.9.0',
    image: 'media',
    startedAt: iso(6 * 86_400_000 + 4 * 3_600_000),
    range,
    step,
    history: cpu.map((c, i) => ({
      t: t(i),
      cpu: c,
      memory: Math.round(mem[i] ?? 0),
      in: rx[i] ?? null,
      out: tx[i] ?? null,
      p95: p95[i] ?? null,
      errors: 0.001,
      people: 7,
    })),
    events: [{ t: t(Math.round(n * 0.64)), kind: 'videos', count: 3 }],
    now: {
      cpu: { used: 1.36, cores: 4 },
      memory: { used: 1.9e9, limit: 4e9 },
      network: { in: 2.25e6, out: 0.5e6, todayIn: 21e9, todayOut: 6e9 },
      responses: { p95: 120, errors: 0.001 },
    },
    processes: [
      {
        role: 'collab',
        host: 'c1',
        startedAt: iso(6 * 86_400_000),
        lastSeenAt: iso(2000),
        status: 'ok',
        cpu: 0.08,
        memory: 286e6,
      },
      {
        role: 'web',
        host: 'w1',
        startedAt: iso(6 * 86_400_000),
        lastSeenAt: iso(1000),
        status: 'ok',
        cpu: 0.24,
        memory: 412e6,
      },
      {
        role: 'worker',
        host: 'k1',
        startedAt: iso(2 * 86_400_000),
        lastSeenAt: iso(3000),
        status: 'ok',
        cpu: 1.04,
        memory: 1.2e9,
      },
    ],
    services: [
      ok('web'),
      { ...ok('collab'), since: iso(2000) },
      { ...ok('worker'), since: iso(3000) },
      ok('database', 'PostgreSQL 18.1'),
      ok('queue', 'Valkey 9.0.0'),
      ok('configuration'),
    ],
    storage: {
      driver: 'local',
      location: '/data',
      total: 931e9,
      free: 519e9,
      used: 412e9,
      originals: 318e9,
      copies: 71e9,
      previews: 23e9,
      growthPerMonth: 64e9,
      monthsLeft: 8.1,
    },
    backup: {
      enabled: true,
      lastAt: night.toISOString(),
      lastStatus: 'ready',
      size: 2.4e9,
      nextAt: next.toISOString(),
    },
    database: { version: 'PostgreSQL 18.1', size: 1.1e9, connections: 14 },
    encoder: { backend: 'vaapi', label: 'VAAPI (Intel)' },
    queues: [
      { id: 'proxies', waiting: 3, active: 2, failed24h: 1 },
      { id: 'media', waiting: 0, active: 1, failed24h: 0 },
      { id: 'office', waiting: 0, active: 0, failed24h: 0 },
      { id: 'transfers', waiting: 0, active: 0, failed24h: 0 },
      { id: 'email', waiting: 0, active: 0, failed24h: 0 },
      { id: 'maintenance', waiting: 0, active: 0, failed24h: 0 },
    ],
    transcodes: {
      active: [
        {
          assetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
          name: 'Scena_12_take3.mov',
          progress: 62,
          secondsLeft: 38,
          speed: 2.4,
          source: 'prores 2160p',
          target: 'h264 1080p',
        },
        {
          assetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11',
          name: 'Sopralluogo_Torino_drone.mp4',
          progress: 18,
          secondsLeft: 130,
          speed: 1.6,
          source: 'hevc 2880p',
          target: 'h264 1080p',
        },
      ],
      waiting: 3,
      readyToday: 41,
      failedToday: 1,
      averageSeconds: 160,
    },
    presence: {
      people: 7,
      peak: 12,
      boards: [
        {
          boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
          title: 'Storyboard · Scena 12',
          projectName: 'Spot di Natale',
          since: iso(42 * 60_000),
          count: 3,
          people: [
            { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a31', name: 'Giulia Bianchi', image: null },
            { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a32', name: 'Marco Rossi', image: null },
            { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a33', name: 'Sara Conti', image: null },
          ],
        },
        {
          boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a21',
          title: 'Moodboard luci',
          projectName: 'Corto “La soglia”',
          since: iso(18 * 60_000),
          count: 2,
          people: [
            { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a34', name: 'Luca Ferri', image: null },
            { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a35', name: 'Elena Galli', image: null },
          ],
        },
        {
          boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a22',
          title: 'Piano di lavorazione',
          projectName: 'Videoclip Marte',
          since: iso(6 * 60_000),
          count: 1,
          people: [{ id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a36', name: 'Paolo Neri', image: null }],
        },
        {
          boardId: null,
          title: null,
          projectName: null,
          since: iso(2 * 60_000),
          count: 1,
          people: [],
        },
      ],
    },
    checks: [
      'public_url_https',
      'public_url_matches_request',
      'database',
      'queue',
      'data_dir_writable',
      'storage',
      'video_encoding',
    ].map((id) => ({ id, status: 'ok', expected: null, actual: null })),
    problems: [
      {
        id: 'video_failed:0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a40',
        kind: 'video_failed',
        severity: 'error',
        role: 'worker',
        firstAt: iso(40 * 60_000),
        lastAt: iso(40 * 60_000),
        count: 1,
        seen: false,
        retry: true,
        technical:
          'worker · media-proxies · make\nError: ffmpeg exited with code 1: Invalid data found when processing input',
        checkId: null,
        service: null,
        file: 'DJI_0412.MP4',
        board: 'Sopralluoghi',
      },
      {
        id: 'email_failed:email:notifications:3f2a',
        kind: 'email_failed',
        severity: 'warning',
        role: 'worker',
        firstAt: iso(26 * 3_600_000),
        lastAt: iso(19 * 3_600_000),
        count: 4,
        seen: false,
        retry: true,
        technical: 'worker · email · notifications\nError: SMTP timeout after 10000 ms',
        checkId: null,
        service: null,
        file: null,
        board: null,
      },
    ],
    alerts: { enabled: true, email: true },
  };
}

async function open(browser: Browser, cookie: string, theme: 'dark' | 'light', phone: boolean) {
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await ctx.addCookies(
    cookie.split('; ').map((c) => {
      const [name, ...value] = c.split('=');
      return { name: name as string, value: value.join('='), url: base };
    }),
  );
  return ctx;
}

/** The window at its real size, then the whole page with the window grown to its content. */
async function shots(page: Page, name: string) {
  await page.locator('.settings-window__body').waitFor();
  await page.waitForTimeout(800);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
  // The window keeps one height and scrolls inside: grow it to its content for a whole view.
  const body = page.locator('.settings-window__body');
  const height = await body.evaluate((el) => el.scrollHeight + 57);
  const size = page.viewportSize() ?? { width: 1280, height: 860 };
  await page.setViewportSize({ width: size.width, height: height + 48 });
  await page.addStyleTag({
    content: `.settings-window{height:${height}px!important;max-height:none!important}`,
  });
  await page.waitForTimeout(400);
  await page.locator('.settings-window').screenshot({ path: join(out, `${name}-full.png`) });
  console.log(`${name}-full.png`);
}

async function main() {
  const browser = await chromium.launch(
    process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {},
  );
  const cookie = await signIn(base, account);
  // No tutorial pill or welcome over the page.
  await call(cookie, 'PATCH', '/me/preferences', {
    tutorialHints: false,
    tutorialsSeen: ['welcome', 'server'],
  });
  mkdirSync(out, { recursive: true });
  for (const view of ['simple', 'advanced'] as const) {
    await call(cookie, 'PATCH', '/me/preferences', { serverView: view });
    for (const theme of ['dark', 'light'] as const)
      for (const phone of [false, true]) {
        const ctx = await open(browser, cookie, theme, phone);
        const page = await ctx.newPage();
        await page.route(/\/api\/v1\/instance\/server\?range=/, (route) => {
          const range = new URL(route.request().url()).searchParams.get(
            'range',
          ) as keyof typeof RANGES;
          return route.fulfill({ json: demo(range, Date.now()) });
        });
        await page.goto('/settings?section=server');
        await shots(page, `server-${view}-${phone ? 'phone' : 'desktop'}-${theme}`);
        await ctx.close();
      }
    const ctx = await open(browser, cookie, 'dark', false);
    const page = await ctx.newPage();
    await page.goto('/settings?section=server');
    await shots(page, `server-${view}-live-desktop-dark`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
