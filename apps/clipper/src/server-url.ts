// SPDX-License-Identifier: MPL-2.0

export interface ServerAddress {
  /** Base address without a trailing slash, e.g. `https://inkadra.example.com`. */
  base: string;
  /** Match pattern for chrome.permissions: this origin only. */
  originPattern: string;
}

/**
 * Reads what the person typed as the address of their server. `https://` is assumed when no
 * scheme is given; a path is kept for servers published under a sub-path.
 */
export function parseServerUrl(input: string): ServerAddress | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // The token would travel in clear: plain http only for this computer and the local network.
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return null;
  if (url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return { base: `${url.origin}${path}`, originPattern: `${url.origin}/*` };
}

/** Loopback, private IPv4 ranges and local-only names. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/\.(local|lan|home\.arpa|internal)$/.test(host)) return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
