// SPDX-License-Identifier: MPL-2.0
import { t } from './i18n.ts';
import type { BoardRef } from './storage.ts';

const CONTEXTS = ['image', 'selection', 'link', 'page'] as const;
const BOARDS_IN_MENU = 5;

export type MenuContext = (typeof CONTEXTS)[number];

/** Board titles are user data, and Chrome reads two things in a menu title. */
export function menuTitle(title: string): string {
  return (
    title
      // A single & marks the access key; && shows one.
      .replaceAll('&', '&&')
      // Chrome replaces every %s with the selection and has no escape for it (see
      // MenuItem::TitleWithReplacement in Chromium): an invisible space breaks the sequence.
      .replaceAll('%s', '%​s')
  );
}

/** One-click items on the last board, then a "Save … to…" parent with the recent boards. */
export function menuItems(boards: BoardRef[]): chrome.contextMenus.CreateProperties[] {
  const recent = boards.slice(0, BOARDS_IN_MENU);
  return CONTEXTS.flatMap((context) => {
    const contexts: [MenuContext] = [context];
    const parentId = `save-to-${context}`;
    return [
      { id: `save-${context}`, title: t(`menu_${context}`), contexts },
      ...(recent.length ? [{ id: parentId, title: t(`menu_${context}_to`), contexts }] : []),
      ...recent.map((board) => ({
        id: `${parentId}:${board.id}`,
        parentId,
        title: menuTitle(board.title),
        contexts,
      })),
    ];
  });
}

/** What a clicked item saves, and where: without a board, the last one. */
export function parseMenuId(
  id: string | number,
): { context: MenuContext; boardId?: string } | null {
  const match = /^save-(?:to-)?(image|selection|link|page)(?::(.+))?$/.exec(String(id));
  return match ? { context: match[1] as MenuContext, boardId: match[2] } : null;
}
