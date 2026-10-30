import { dark, light } from '@inkadra/ui/tokens';

/** The web app manifest and the offline page, built from the tokens and the translations. */

interface Messages {
  app: { name: string; tagline: string };
  pwa: { offline: { title: string; body: string; retry: string } };
}

export const ICONS = {
  any192: 'icons/icon-192.png',
  any512: 'icons/icon-512.png',
  maskable: 'icons/icon-maskable-512.png',
  apple: 'icons/apple-touch-icon.png',
} as const;

/** The window colour: the background behind the rail, as the page itself paints it. */
export const themeColor = { dark: dark['bg-rail'], light: light['bg-rail'] };

export function webManifest(it: Messages) {
  return {
    id: '/',
    name: it.app.name,
    short_name: it.app.name,
    description: it.app.tagline,
    lang: 'it',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // A manifest has one colour of each; dark is the default theme. index.html sets both.
    background_color: themeColor.dark,
    theme_color: themeColor.dark,
    categories: ['productivity', 'photo'],
    icons: [
      { src: `/${ICONS.any192}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/${ICONS.any512}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/${ICONS.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}

/** public/favicon.svg, in the colours of the theme in use. */
const LOGO =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8.6" fill="var(--tile)"/><rect x="5.3" y="10.7" width="9.3" height="11.6" rx="1.7" fill="var(--ink)"/><rect x="17.4" y="10.7" width="9.3" height="11.6" rx="1.7" fill="var(--ink)" opacity=".55"/></svg>';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A page with no dependencies, kept by the service worker for navigations that cannot reach
 * the server. Both languages are inside; the script picks one as the app does.
 */
export function offlinePage(messages: { it: Messages; en: Messages }) {
  const text = (m: Messages) =>
    Object.fromEntries(Object.entries(m.pwa.offline).map(([k, v]) => [k, escapeHtml(v)]));
  const it = text(messages.it);
  const en = text(messages.en);
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${it.title} · Inkadra</title>
<style>
:root { --bg: ${dark['bg-rail']}; --panel: ${dark['bg-app']}; --border: ${dark['border-default']}; --text: ${dark['text-primary']}; --muted: ${dark['text-secondary']}; --button: ${dark['accent-button']}; --on: ${dark['on-accent']}; --tile: ${dark['logo-tile']}; --ink: ${dark['logo-ink']}; }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg: ${light['bg-rail']}; --panel: ${light['bg-app']}; --border: ${light['border-default']}; --text: ${light['text-primary']}; --muted: ${light['text-secondary']}; --button: ${light['accent-button']}; --on: ${light['on-accent']}; --tile: ${light['logo-tile']}; --ink: ${light['logo-ink']}; } }
:root[data-theme="light"] { --bg: ${light['bg-rail']}; --panel: ${light['bg-app']}; --border: ${light['border-default']}; --text: ${light['text-primary']}; --muted: ${light['text-secondary']}; --button: ${light['accent-button']}; --on: ${light['on-accent']}; --tile: ${light['logo-tile']}; --ink: ${light['logo-ink']}; }
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; background: var(--bg); color: var(--text); font: 400 14px/1.5 Inter, system-ui, sans-serif; }
main { max-width: 360px; margin: 24px; padding: 28px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); text-align: center; }
svg { width: 40px; height: 40px; }
h1 { margin: 16px 0 8px; font-size: 18px; font-weight: 600; }
p { margin: 0 0 20px; color: var(--muted); }
button { padding: 8px 16px; border: 0; border-radius: 8px; background: var(--button); color: var(--on); font: inherit; font-weight: 500; cursor: pointer; }
</style>
</head>
<body>
<main>
${LOGO}
<h1 id="title">${it.title}</h1>
<p id="body">${it.body}</p>
<button id="retry" type="button">${it.retry}</button>
</main>
<div id="messages" hidden data-messages="${escapeHtml(JSON.stringify({ it, en }))}"></div>
<script src="/offline.js"></script>
</body>
</html>
`;
}

export const offlineScript =
  "try {\n  var t = localStorage.getItem('inkadra.theme');\n  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;\n} catch (e) {}\nvar text = JSON.parse(document.getElementById('messages').dataset.messages);\nvar langs = navigator.languages || [navigator.language || ''];\nfor (var i = 0; i < langs.length; i++) {\n  var base = String(langs[i]).slice(0, 2);\n  if (text[base]) {\n    if (base !== 'it') {\n      document.documentElement.lang = base;\n      document.title = text[base].title + ' \u00b7 Inkadra';\n      ['title', 'body', 'retry'].forEach(function (k) { document.getElementById(k).innerHTML = text[base][k]; });\n    }\n    break;\n  }\n}\n// An online event can precede the worker's network recovery. Probe a network-only\n// endpoint before navigating, and retry without depending on another online event.\nvar checking = false;\nvar retryTimer;\nasync function reconnect() {\n  if (checking) return;\n  clearTimeout(retryTimer);\n  var timeout;\n  try {\n    var signal;\n    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {\n      signal = AbortSignal.timeout(3000);\n    } else {\n      var controller = new AbortController();\n      signal = controller.signal;\n      timeout = setTimeout(function () { controller.abort(); }, 3000);\n    }\n    checking = true;\n    var response = await fetch('/api/v1/health', { cache: 'no-store', credentials: 'omit', signal: signal });\n    if (!response.ok) throw new Error('Server unavailable');\n    location.reload();\n  } catch (error) {\n    retryTimer = setTimeout(reconnect, 1000);\n  } finally {\n    clearTimeout(timeout);\n    checking = false;\n  }\n}\ndocument.getElementById('retry').addEventListener('click', reconnect);\nwindow.addEventListener('online', reconnect);\nreconnect();\n";
