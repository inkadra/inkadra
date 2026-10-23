import type { ClipboardData } from '@inkadra/canvas-core';

/**
 * Board elements travel through the system clipboard as HTML with the data in an attribute,
 * so copy and paste work between boards and tabs. Other apps get the plain text.
 */
const ATTR = 'data-inkadra-clipboard';

function encode(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export function encodeClipboard(target: DataTransfer, data: ClipboardData) {
  const payload = encode(JSON.stringify(data));
  const text = data.elements
    .map((e) =>
      e.type === 'link' ? e.url : e.type === 'column' ? e.title : e.type === 'color' ? e.hex : '',
    )
    .filter(Boolean)
    .join('\n');
  target.setData('text/html', `<meta ${ATTR}="${payload}">`);
  target.setData('text/plain', text);
}

export function decodeClipboard(source: DataTransfer): ClipboardData | null {
  const html = source.getData('text/html');
  const match = html.match(new RegExp(`${ATTR}="([A-Za-z0-9+/=]+)"`));
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(decode(match[1])) as ClipboardData;
    return data.version === 1 && Array.isArray(data.elements) ? data : null;
  } catch {
    return null;
  }
}
