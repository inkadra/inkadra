import { frameLabels, storyboardOf } from '@inkadra/canvas-core';
import { Element } from '@inkadra/doc-schema';
import type {
  GuestBoard,
  GuestBoardSnapshot,
  GuestElement,
  GuestElementReview,
  GuestPick,
  GuestRole,
  PickValue,
  SetPick,
} from '@inkadra/shared';
import { RequestError } from '../lib/api.ts';

/**
 * Rules of the guest page that do not need React, kept apart so they can be tested. The server
 * decides every permission again; these only choose what to show.
 */

/** Why the page cannot show the board, as the guest may know it. */
export type Stop =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'unavailable'
  | 'no_session'
  | 'rate_limited'
  | 'cookies'
  | 'error';

/** What a failed guest request means for the page. */
export type Failure =
  | { kind: 'stop'; stop: Stop }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'name' }
  | { kind: 'transient' }
  | { kind: 'other' };

export function failureOf(err: unknown): Failure {
  // No answer (offline, Wi-Fi drop, a laptop waking up) or a server error: try again later.
  if (!(err instanceof RequestError) || err.status >= 500) return { kind: 'transient' };
  if (err.status === 429) return { kind: 'stop', stop: 'rate_limited' };
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  switch (reason) {
    case 'password_required':
      return { kind: 'password', wrong: false };
    case 'wrong_password':
      return { kind: 'password', wrong: true };
    case 'name_required':
      return { kind: 'name' };
    case 'expired':
    case 'revoked':
    case 'unavailable':
    case 'no_session':
      return { kind: 'stop', stop: reason };
  }
  if (err.status === 404) return { kind: 'stop', stop: 'not_found' };
  // An unknown reason of a 401 or 403 is a generic error (decision 0013, open enums).
  if (err.status === 401 || err.status === 403) return { kind: 'stop', stop: 'error' };
  return { kind: 'other' };
}

/** Milliseconds a `Retry-After` header asks to wait (seconds or an HTTP date), if any. */
export function retryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** How long after reopening the link a new `no_session` means the cookie was not kept. */
export const COOKIE_CHECK_MS = 60_000;

/**
 * What to do when the server no longer knows the guest's session: open the link again once,
 * but if that just happened the browser does not keep the cookie, and opening again would only
 * create another guest.
 */
export function onNoSession(
  lastReopen: number | null,
  now: number,
  cookiesEnabled = true,
): 'reopen' | 'cookies' {
  if (!cookiesEnabled) return 'cookies';
  return lastReopen !== null && now - lastReopen < COOKIE_CHECK_MS ? 'cookies' : 'reopen';
}

/** How often the session (options, role and boards of the link) is asked again at most. */
export const SESSION_REFRESH_MS = 60_000;

/**
 * Whether a new snapshot calls for asking the session again. Changes to the link are not in
 * the snapshot, but they move its version: a new version with the same content, a board that
 * no longer matches the session, or a session older than a minute.
 */
export function needsSession(
  prev: GuestBoardSnapshot | null,
  next: GuestBoardSnapshot | null,
  session: { boards: readonly GuestBoard[] },
  lastAsked: number,
  now: number,
): boolean {
  if (now - lastAsked >= SESSION_REFRESH_MS) return true;
  if (!next) return false;
  const known = session.boards.find((b) => b.id === next.board.id);
  if (
    !known ||
    known.title !== next.board.title ||
    known.kind !== next.board.kind ||
    known.parentBoardId !== next.board.parentBoardId
  )
    return true;
  if (!prev || prev.board.id !== next.board.id) return false;
  const content = ({ version: _v, generatedAt: _g, ...rest }: GuestBoardSnapshot) => rest;
  return JSON.stringify(content(prev)) === JSON.stringify(content(next));
}

/** Roles the page does not know count as `guest_view`. */
export function knownRole(role: string | null | undefined): GuestRole {
  return role === 'guest_comment' || role === 'guest_approve' ? role : 'guest_view';
}

export interface Rights {
  comments: boolean;
  review: boolean;
  pick: boolean;
  download: boolean;
}

export function rightsOf(session: {
  role: string;
  proofing: boolean;
  allowDownload: boolean;
}): Rights {
  const role = knownRole(session.role);
  return {
    comments: role !== 'guest_view',
    review: role === 'guest_approve',
    pick: session.proofing,
    download: session.allowDownload,
  };
}

/** Pictures can be picked: image cards, and storyboard frames with a picture. */
export function isPicture(el: { type: string; assetId?: unknown }): boolean {
  return (el.type === 'image' || el.type === 'frame') && typeof el.assetId === 'string';
}

/** A guest withdraws only a decision they made and still see (GuestSetElementReview). */
export function canWithdraw(review: GuestElementReview | undefined): boolean {
  return (
    !!review &&
    review.changedBy.isYou &&
    (review.status === 'approved' || review.status === 'changes_requested')
  );
}

/** Statuses the page does not know are shown like `in_review`. */
export function shownStatus(status: string | undefined) {
  if (!status || status === 'none') return 'none' as const;
  if (status === 'approved' || status === 'changes_requested') return status;
  return 'in_review' as const;
}

/** Clicking the current choice again clears it. */
export function togglePick(current: GuestPick | undefined, value: PickValue): SetPick {
  return { pick: current?.pick === value ? null : value };
}

export function toggleStars(current: GuestPick | undefined, stars: number): SetPick {
  return { stars: current?.stars === stars ? null : stars };
}

/** The board path from the board of the link, for the breadcrumb and the board list. */
export function boardPath(boards: readonly GuestBoard[], id: string): GuestBoard[] {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const path: GuestBoard[] = [];
  const seen = new Set<string>();
  let at = byId.get(id);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    path.unshift(at);
    at = at.parentBoardId ? byId.get(at.parentBoardId) : undefined;
  }
  return path;
}

/** Boards in the order of a tree walk from the board of the link, with their depth. */
export function boardTree(
  boards: readonly GuestBoard[],
  top: string,
): Array<{ board: GuestBoard; depth: number }> {
  const children = new Map<string, GuestBoard[]>();
  for (const b of boards) {
    if (!b.parentBoardId) continue;
    children.set(b.parentBoardId, [...(children.get(b.parentBoardId) ?? []), b]);
  }
  const out: Array<{ board: GuestBoard; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (b: GuestBoard, depth: number) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    out.push({ board: b, depth });
    for (const c of children.get(b.id) ?? []) walk(c, depth + 1);
  };
  const root = boards.find((b) => b.id === top);
  if (root) walk(root, 0);
  return out;
}

/** Plain text of ProseMirror JSON, as a note's label. */
export function proseText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  return n.content.map(proseText).filter(Boolean).join(' ');
}

/** A short name for a card, for lists and headings; null when only its type describes it. */
export function cardLabel(el: Record<string, unknown>, max = 60): string | null {
  const pick = (k: string) => (typeof el[k] === 'string' && el[k] ? (el[k] as string) : null);
  const text =
    pick('caption') ??
    pick('title') ??
    pick('label') ??
    (el.type === 'note' ? proseText(el.body).trim() || null : null) ??
    pick('url');
  if (!text) return null;
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * Shot labels for storyboard frames. Prefers the server-provided label sent with each frame
 * (computed on the full document so hidden frames do not shift labels), and falls back to
 * local computation only when absent.
 */
export function shotLabels(elements: readonly GuestElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  const missing: GuestElement[] = [];

  for (const raw of elements) {
    if (raw.type !== 'frame') continue;
    if (typeof raw.label === 'string' && raw.label.trim() !== '') {
      labels.set(raw.id, raw.label.trim());
    } else {
      missing.push(raw);
    }
  }

  // Fall back to local computation when server-provided labels are absent.
  if (missing.length > 0) {
    const parsed: Element[] = [];
    for (const raw of elements) {
      const { body: _body, ...fields } = raw;
      const result = Element.safeParse(fields);
      if (result.success) parsed.push(result.data);
    }
    const computed = frameLabels(storyboardOf(parsed));
    for (const raw of missing) {
      const label = computed.get(raw.id);
      if (label) labels.set(raw.id, label);
    }
  }

  return labels;
}
