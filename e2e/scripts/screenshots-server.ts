import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';
import { signIn } from '../tests/perf/seed.ts';

/**
 * Screenshots of Settings → Server (#514), simple and advanced, at 2560×1600, 1280×800 and on a
 * 390 px phone, dark and light. The page reads a week of history that an instance started for
 * the screenshots does not have, so its status and its live values come from a fictional
 * studio below (`demo`, `live`); then the orange states (a failed backup, a disk almost full),
 * the memory near its limit, a problem opened in Advanced from Simple, and frames of the live
 * refresh. One more shot per view (`*-real-*`) shows what this instance itself reports.
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
  '15m': { window: 900, step: 5 },
  '1h': { window: 3600, step: 20 },
  '24h': { window: 86_400, step: 480 },
  '7d': { window: 604_800, step: 3600 },
} as const;

type Variant = 'ok' | 'backup' | 'disk' | 'memory';

/** A fictional studio's server: steady with a busy spell, as on the approved mockup. */
function demo(range: keyof typeof RANGES, now: number, variant: Variant = 'ok') {
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
  const cpu = walk(3, 2, 0.3, 7).map((v, i) => (busy(i) ? v + 4 : v));
  const mem =
    variant === 'memory' ? walk(1.5e9, 0.05e9, 1.4e9, 1.68e9) : walk(3.0e8, 0.2e8, 2.4e8, 4.9e8);
  const rx = walk(2.5e4, 1.5e4, 5e3, 1.2e5);
  const tx = walk(1.5e3, 1e3, 0, 2e4);
  const p95 = walk(300, 40, 200, 420).map((v, i) => (busy(i) ? v + 90 : v));
  const t = (i: number) => new Date(now - (n - 1 - i) * step * 1000).toISOString();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const night = new Date(now);
  night.setHours(3, 0, 0, 0);
  const next = new Date(night.getTime() + 86_400_000);
  const lastNight = new Date(night.getTime() - 86_400_000 + 20 * 3_600_000 + 49 * 60_000);
  const backupFailed = variant === 'backup';
  const diskFull = variant === 'disk';
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
      cpu: { used: 0.36, cores: 4 },
      memory:
        variant === 'memory' ? { used: 1.62e9, limit: 2e9 } : { used: 2.98e8, limit: 33.39e9 },
      network: { in: 2.6e4, out: 1.2e3, todayIn: 10.55e6, todayOut: 926.75e3 },
      responses: { p95: 373, errors: 0.001 },
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
      ...(diskFull
        ? { total: 500e9, free: 34.8e9, used: 465.2e9, monthsLeft: 0.5 }
        : { total: 931e9, free: 519e9, used: 412e9, monthsLeft: 8.1 }),
      originals: 418e9,
      copies: 31e9,
      previews: 9e9,
      growthPerMonth: 64e9,
    },
    backup: {
      enabled: true,
      lastAt: (backupFailed ? lastNight : night).toISOString(),
      lastStatus: backupFailed ? 'failed' : 'ready',
      size: backupFailed ? null : 2.4e9,
      nextAt: next.toISOString(),
      lastSuccessAt: (backupFailed
        ? new Date(lastNight.getTime() - 86_400_000)
        : night
      ).toISOString(),
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
      ...(backupFailed || diskFull
        ? [
            {
              id: backupFailed ? 'backup_failed:nightly' : 'disk_full:/data',
              kind: backupFailed ? 'backup_failed' : 'disk_full',
              severity: 'error',
              role: 'worker',
              firstAt: (backupFailed ? lastNight : new Date(now - 3_600_000)).toISOString(),
              lastAt: (backupFailed ? lastNight : new Date(now - 600_000)).toISOString(),
              count: 1,
              seen: false,
              retry: false,
              technical: backupFailed
                ? 'worker · maintenance · backup\nError: pg_dump exited with code 1: could not write to output file'
                : 'web · storage · /data\n34.8 GB free of 500 GB',
              checkId: null,
              service: null,
              file: null,
              board: null,
            },
          ]
        : []),
      {
        id: 'video_failed:0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a40',
        kind: 'video_failed',
        severity: 'error',
        role: 'worker',
        firstAt: iso(40 * 60_000),
        lastAt: iso(40 * 60_000),
        count: 2,
        seen: false,
        retry: true,
        technical:
          'worker · media-proxies · make\nError: ffmpeg exited with code 1: moov atom not found',
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

/** What the page asks every 2.5 s: the values of now and the newest points, moving. */
function live(range: keyof typeof RANGES, now: number, variant: Variant) {
  const full = demo(range, now, variant);
  const wave = Math.sin(now / 4000);
  const step = RANGES[range].step * 1000;
  const last = Math.floor(now / step) * step;
  const point = (t: number, k: number) => ({
    ...(full.history.at(-1) as (typeof full.history)[number]),
    t: new Date(t).toISOString(),
    cpu: 9 + 6 * Math.sin(t / 7000 + k),
    p95: 340 + 60 * Math.sin(t / 5000 + k),
  });
  return {
    checkedAt: new Date(now).toISOString(),
    range,
    step: RANGES[range].step,
    history: [point(last - step, 1), point(last, 0)],
    now: {
      cpu: { used: 0.36 + 0.3 * wave, cores: 4 },
      memory: { ...full.now.memory, used: Math.round(full.now.memory.used * (1 + 0.04 * wave)) },
      network: { in: 2.5e4 * (1.2 + wave), out: 1.2e3 * (1.2 - wave) },
      p95: Math.round(373 + 40 * wave),
    },
  };
}

type Size = 'large' | 'desktop' | 'phone';
const SIZES: Record<Size, { width: number; height: number }> = {
  large: { width: 2560, height: 1600 },
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

async function open(
  browser: Browser,
  cookie: string,
  theme: 'dark' | 'light',
  size: Size,
  video?: string,
) {
  const phone = size === 'phone';
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: SIZES[size],
    deviceScaleFactor: size === 'large' ? 1 : 2,
    isMobile: phone,
    hasTouch: phone,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    colorScheme: theme,
    reducedMotion: 'reduce',
    ...(video ? { recordVideo: { dir: video, size: SIZES[size] } } : {}),
  });
  await ctx.addCookies(
    cookie.split('; ').map((c) => {
      const [name, ...value] = c.split('=');
      return { name: name as string, value: value.join('='), url: base };
    }),
  );
  return ctx;
}

/** The status and the live values of the fictional studio, in one of its states. */
async function mock(page: Page, variant: Variant) {
  await page.route(/\/api\/v1\/instance\/server\?range=/, (route) => {
    const range = new URL(route.request().url()).searchParams.get('range') as keyof typeof RANGES;
    return route.fulfill({ json: demo(range, Date.now(), variant) });
  });
  await page.route(/\/api\/v1\/instance\/server\/live\?range=/, (route) => {
    const range = new URL(route.request().url()).searchParams.get('range') as keyof typeof RANGES;
    return route.fulfill({ json: live(range, Date.now(), variant) });
  });
}

async function settle(page: Page) {
  await page.locator('.settings-window__body').waitFor();
  await page.locator('.server-status').waitFor();
  await page.waitForTimeout(800);
  await page.mouse.move(0, 0);
}

/** The window at its real size, then the whole page with the window grown to its content. */
async function shots(page: Page, name: string, whole = true) {
  await settle(page);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
  if (!whole) return;
  // The window keeps one height and scrolls inside: grow it to its content for a whole view.
  const body = page.locator('.settings-window__body');
  const height = await body.evaluate((el) => el.scrollHeight + 57);
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height + 48) });
  await page.addStyleTag({
    content: `.settings-window{height:${height}px!important;max-height:none!important}`,
  });
  await page.waitForTimeout(400);
  await page.locator('.settings-window').screenshot({ path: join(out, `${name}-full.png`) });
  console.log(`${name}-full.png`);
}

async function main() {
  const browser = await chromium.launch({
    ...(process.env.SHOTS_CHANNEL ? { channel: process.env.SHOTS_CHANNEL } : {}),
    args: (process.env.SHOTS_ARGS ?? '').split(' ').filter(Boolean),
  });
  const cookie = await signIn(base, account);
  // No tutorial pill or welcome over the page.
  await call(cookie, 'PATCH', '/me/preferences', {
    tutorialHints: false,
    tutorialsSeen: ['welcome', 'server'],
  });
  mkdirSync(out, { recursive: true });
  const view = async (serverView: 'simple' | 'advanced') =>
    call(cookie, 'PATCH', '/me/preferences', { serverView });
  const page = async (
    theme: 'dark' | 'light',
    size: Size,
    variant: Variant = 'ok',
    video?: string,
  ) => {
    const ctx = await open(browser, cookie, theme, size, video);
    const p = await ctx.newPage();
    await mock(p, variant);
    await p.goto('/settings?section=server');
    return { ctx, p };
  };
  const only = process.env.SHOTS_ONLY;
  for (const v of ['simple', 'advanced'] as const) {
    await view(v);
    if (!only || only === 'views')
      for (const theme of ['dark', 'light'] as const)
        for (const size of ['large', 'desktop', 'phone'] as const) {
          const { ctx, p } = await page(theme, size);
          await shots(p, `server-${v}-${size}-${theme}`, size !== 'large');
          await ctx.close();
        }
    // Orange: the backup of last night failed; the disk almost full.
    if (!only || only === 'states')
      for (const theme of ['dark', 'light'] as const) {
        const { ctx, p } = await page(theme, 'desktop', 'backup');
        await shots(p, `server-${v}-orange-backup-${theme}`);
        await ctx.close();
        const disk = await page(theme, v === 'simple' ? 'phone' : 'desktop', 'disk');
        await shots(disk.p, `server-${v}-orange-disk-${theme}`);
        await disk.ctx.close();
      }
  }
  await view('advanced');
  if (!only || only === 'states')
    for (const theme of ['dark', 'light'] as const) {
      const { ctx, p } = await page(theme, 'desktop', 'memory');
      await settle(p);
      await p.locator('[data-tour="server-health"]').screenshot({
        path: join(out, `server-advanced-memory-limit-${theme}.png`),
      });
      console.log(`server-advanced-memory-limit-${theme}.png`);
      await ctx.close();
    }
  // From Simple, a problem opened in the error log of Advanced; the account keeps Simple.
  await view('simple');
  if (!only || only === 'states')
    for (const theme of ['dark', 'light'] as const)
      for (const size of ['desktop', 'phone'] as const) {
        const { ctx, p } = await page(theme, size, 'backup');
        await settle(p);
        await p.getByRole('button', { name: /Dettagli tecnici in Avanzata: Un video/ }).click();
        await p.locator('.server-log__found').waitFor();
        await p.waitForTimeout(600);
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(out, `server-deeplink-${size}-${theme}.png`) });
        console.log(`server-deeplink-${size}-${theme}.png`);
        await ctx.close();
      }
  // The live refresh: frames 3 s apart and a short video of Advanced.
  await view('advanced');
  if (!only || only === 'live') {
    const videos = join(out, 'video');
    const { ctx, p } = await page('dark', 'desktop', 'ok', videos);
    await settle(p);
    for (let i = 0; i < 5; i++) {
      await p.locator('[data-tour="server-health"]').screenshot({
        path: join(out, `server-live-frame-${i + 1}.png`),
      });
      console.log(`server-live-frame-${i + 1}.png`);
      await p.waitForTimeout(3000);
    }
    await ctx.close();
  }
  for (const v of ['simple', 'advanced'] as const) {
    if (only) break;
    await view(v);
    const ctx = await open(browser, cookie, 'dark', 'desktop');
    const p = await ctx.newPage();
    await p.goto('/settings?section=server');
    await shots(p, `server-${v}-real-desktop-dark`, false);
    await ctx.close();
  }
  await view('simple');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
