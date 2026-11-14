import { feedbackPage, redactFeedback } from '@inkadra/shared';

const LIMITS = { console: 16000, network: 8000 } as const;
const consoleEntries: { at: number; text: string }[] = [];
const networkEntries: { at: number; text: string }[] = [];
function add(list: typeof consoleEntries, text: string) {
  list.push({ at: Date.now(), text: redactFeedback(text).slice(0, 2000) });
  while (list.length > 50 || (list[0]?.at ?? Date.now()) < Date.now() - 600000) list.shift();
}
let connection: (() => { sync: string; flags: string }) | null = null;
export function setFeedbackConnection(read: () => { sync: string; flags: string }) {
  connection = read;
  return () => {
    if (connection === read) connection = null;
  };
}
let installed = false;
/** Collect only warnings/errors and failed request metadata; never bodies or headers. */
export function installFeedbackDiagnostics() {
  if (installed) return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      add(
        consoleEntries,
        `${level} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : '[non-text value]')).join(' ')}`,
      );
      original(...args);
    };
  }
  window.addEventListener('error', (e) =>
    add(
      consoleEntries,
      `error ${e.error?.name ?? 'Error'}: ${e.message}${e.error?.stack ? `\n${e.error.stack}` : ''}`,
    ),
  );
  window.addEventListener('unhandledrejection', (e) =>
    add(
      consoleEntries,
      e.reason instanceof Error
        ? `error ${e.reason.name}: ${e.reason.message}\n${e.reason.stack ?? ''}`
        : `error Unhandled rejection: ${String(e.reason)}`,
    ),
  );
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    const path = new URL(String(url), location.href).pathname;
    this.addEventListener(
      'loadend',
      () => {
        if ((this.status === 0 || this.status >= 400) && !path.includes('/feedback'))
          add(networkEntries, `${method} ${feedbackPage(path)} ${this.status}`);
      },
      { once: true },
    );
    originalOpen.call(this, method, url, async, username, password);
  };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const metadata = `${init?.method ?? (input instanceof Request ? input.method : 'GET')} ${feedbackPage(url.pathname)}`;
    try {
      const result = await original(input, init);
      if (!result.ok && !url.pathname.includes('/feedback'))
        add(networkEntries, `${metadata} ${result.status}`);
      return result;
    } catch (error) {
      if (!url.pathname.includes('/feedback')) add(networkEntries, `${metadata} 0`);
      throw error;
    }
  };
}

/** Name and major version, not the full user agent string: nothing more is needed to reproduce. */
export function browserAndSystem(agent: string): string {
  const browser =
    [
      /(Edg)\/(\d+)/,
      /(OPR)\/(\d+)/,
      /(SamsungBrowser)\/(\d+)/,
      /(Firefox)\/(\d+)/,
      /(Chrome)\/(\d+)/,
      /Version\/(\d+).*(Safari)/,
    ]
      .map((pattern) => agent.match(pattern))
      .find(Boolean) ?? null;
  const name = browser
    ? /^\d/.test(browser[1] ?? '')
      ? `${browser[2]} ${browser[1]}`
      : `${browser[1]} ${browser[2]}`
    : 'Unknown browser';
  const system =
    agent.match(/Windows NT|Android \d+|iPhone OS \d+|iPad|CPU OS \d+|Mac OS X|CrOS|Linux/)?.[0] ??
    'Unknown system';
  return `${name.replace('Edg ', 'Edge ').replace('OPR ', 'Opera ')} · ${system
    .replace('Windows NT', 'Windows')
    .replace('Mac OS X', 'macOS')
    .replace('iPhone OS', 'iOS')
    .replace('CPU OS', 'iPadOS')}`;
}

/** The main script's hashed name changes with every build, without another build step. */
function buildId(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script?.src.match(/-([\w-]{6,})\.js/)?.[1] ?? 'development';
}

export function diagnostics(version: string, language: string, prefill?: string) {
  const recent = (list: typeof consoleEntries) =>
    list
      .filter((e) => e.at > Date.now() - 600000)
      .map((e) => `${new Date(e.at).toTimeString().slice(0, 8)} ${e.text}`);
  const clipped = (lines: string[], limit: number) => lines.join('\n').slice(-limit);
  return {
    environment: redactFeedback(
      [
        `Inkadra ${version} · build ${buildId()}`,
        browserAndSystem(navigator.userAgent),
        `Screen ${screen.width}×${screen.height} · DPR ${devicePixelRatio} · window ${innerWidth}×${innerHeight}`,
        `Theme ${document.documentElement.dataset.theme ?? 'system'} · language ${language}`,
      ].join('\n'),
    ),
    page: feedbackPage(location.pathname),
    console: clipped(
      [...recent(consoleEntries), ...(prefill ? [redactFeedback(prefill)] : [])],
      LIMITS.console,
    ),
    network: clipped(recent(networkEntries), LIMITS.network),
    sync: navigator.onLine ? 'Browser online' : 'Browser offline',
    flags: 'none',
    ...connection?.(),
  };
}
