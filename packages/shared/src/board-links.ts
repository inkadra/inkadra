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

const BOARD_PATH = /^\/p\/([^/?#]+)\/b\/([^/?#]+)\/?$/;

/**
 * The board and card an `href` leads to, or null when it is not a board's address: a path as
 * `boardHref` writes it or, given `origin` (the instance's, e.g. `https://ink.example.com`), the
 * same path as an absolute URL on that origin. Other parameters (`thread`, `comment`) are
 * ignored. The ids are checked, since a note's links are written by any client.
 */
export function parseBoardHref(href: string, origin?: string): BoardHref | null {
  let url: URL;
  try {
    if (href.startsWith('/') && !href.startsWith('//')) url = new URL(href, 'http://localhost');
    else if (origin) {
      url = new URL(href);
      if (url.origin !== new URL(origin).origin) return null;
    } else return null;
  } catch {
    return null;
  }
  const match = BOARD_PATH.exec(url.pathname);
  if (!match) return null;
  let projectId: string;
  let boardId: string;
  try {
    projectId = decodeURIComponent(match[1] as string);
    boardId = decodeURIComponent(match[2] as string);
  } catch {
    return null;
  }
  const cardId = url.searchParams.get('el');
  if (!Id.safeParse(projectId).success || !Id.safeParse(boardId).success) return null;
  if (cardId !== null && !ElementRef.safeParse(cardId).success) return null;
  return { projectId, boardId, cardId };
}
