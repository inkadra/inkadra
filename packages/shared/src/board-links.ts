// SPDX-License-Identifier: MPL-2.0
import { ElementRef } from './comments.ts';
import { Id } from './common.ts';

/**
 * The in-app address of a board, and of a card on it: `/p/{projectId}/b/{boardId}?el={cardId}`,
 * the address `notificationPath` and the storage overview's `cardId` lead to. A storyboard frame
 * is a card: its address opens the Storyboard view at that frame (decision 0121). Clients write
 * it as the `href` of a note's `link` mark to link a frame; it is a same-origin path, so a link
 * keeps working when the instance moves to another address.
 */
export function boardHref(projectId: string, boardId: string, cardId?: string | null): string {
  const path = `/p/${encodeURIComponent(projectId)}/b/${encodeURIComponent(boardId)}`;
  return cardId ? `${path}?el=${encodeURIComponent(cardId)}` : path;
}

export interface BoardHref {
  projectId: string;
  boardId: string;
  /** The card the board opens at; null for the board itself. */
  cardId: string | null;
}

/** A path as `boardHref` writes it: ids in their own alphabets, nothing to decode. */
const BOARD_PATH = /^\/p\/([0-9A-Za-z-]+)\/b\/([0-9A-Za-z-]+)\/?(?:\?([^#]*))?(?:#.*)?$/;
/**
 * An `http(s)` origin: scheme and host (a name, an IPv4 or a bracketed IPv6 address; a port
 * allowed), no user, path, query or fragment.
 */
const ORIGIN = /^(https?:\/\/(?:[0-9A-Za-z.-]+|\[([0-9A-Fa-f:.]+)\])(?::\d{1,5})?)\/?$/i;
/** Controls, spaces and backslashes: separators that URL parsers read differently. */
const ambiguous = (s: string) =>
  [...s].some((ch) => {
    const c = ch.charCodeAt(0);
    return c <= 0x20 || (c >= 0x7f && c <= 0x9f) || ch === '\\';
  });

/**
 * The board and card an `href` leads to, or null when it is not a board's address: a path as
 * `boardHref` writes it or, given `origin` (the instance's, e.g. `https://ink.example.com`), the
 * same path as an absolute URL on that origin. Other parameters (`thread`, `comment`) are
 * ignored. A note's links are written by any client, so the address must be canonical: no
 * backslashes, controls or spaces, no escapes in the ids, ids that are ids, an `http(s)` origin
 * matched exactly (scheme and host compared without case). It needs no `URL` (React Native's
 * cannot resolve a relative path).
 */
export function parseBoardHref(href: string, origin?: string): BoardHref | null {
  if (ambiguous(href)) return null;
  let path = href;
  if (!href.startsWith('/')) {
    const m = origin === undefined ? null : ORIGIN.exec(origin);
    // A bracketed host must be an IPv6 address ([fd00:::1] is not one).
    const base = m && (m[2] === undefined || isIPv6(m[2])) ? m[1] : null;
    if (!base || href.slice(0, base.length).toLowerCase() !== base.toLowerCase()) return null;
    path = href.slice(base.length);
  }
  const match = BOARD_PATH.exec(path);
  if (!match) return null;
  const [, projectId = '', boardId = '', query = ''] = match;
  const keys = query.split('&').map((p) => p.split('=')[0] as string);
  // The web reads keys decoded (URLSearchParams, the first `el` wins): a key spelled otherwise
  // that decodes to `el` would make two readers pick two cards, so it is refused.
  if (keys.some((k) => k !== 'el' && decodedKey(k) === 'el')) return null;
  const cards = query
    .split('&')
    .filter((p) => p === 'el' || p.startsWith('el='))
    .map((p) => p.slice(3));
  if (cards.length > 1) return null;
  const cardId = cards[0] ?? null;
  if (!Id.safeParse(projectId).success || !Id.safeParse(boardId).success) return null;
  if (cardId !== null && !ElementRef.safeParse(cardId).success) return null;
  return { projectId, boardId, cardId };
}

/** A query key as URLSearchParams decodes it (`+` a space); a malformed escape stays as it is. */
function decodedKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}

const IPV4_PART = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** An IPv6 address as written between brackets (RFC 4291 text forms, no zone). */
function isIPv6(s: string): boolean {
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const groupsOf = (h: string) => (h === '' ? [] : h.split(':'));
  const groups = halves.flatMap(groupsOf);
  let count = groups.length;
  const last = groups[groups.length - 1];
  if (last?.includes('.')) {
    // An embedded IPv4 address ends the address and counts as two groups.
    const parts = last.split('.');
    if (s.endsWith(':') || parts.length !== 4 || !parts.every((p) => IPV4_PART.test(p)))
      return false;
    groups.pop();
    count += 1;
  }
  if (!groups.every((g) => HEX_GROUP.test(g))) return false;
  return halves.length === 2 ? count <= 7 : count === 8;
}
