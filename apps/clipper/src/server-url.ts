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
  if (url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return { base: `${url.origin}${path}`, originPattern: `${url.origin}/*` };
}
