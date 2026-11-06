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
      .replaceAll('%s', '%\u200Bs')
  );
}

/**
 * One item per context, so Chrome shows it directly instead of nesting it under the extension's
 * name: a "Save … to…" parent with the recent boards, newest first, or a one-click item without
 * boards.
 */
export function menuItems(boards: BoardRef[]): chrome.contextMenus.CreateProperties[] {
  const recent = boards.slice(0, BOARDS_IN_MENU);
  return CONTEXTS.flatMap((context): chrome.contextMenus.CreateProperties[] => {
    const contexts: [MenuContext] = [context];
    if (!recent.length) return [{ id: `save-${context}`, title: t(`menu_${context}`), contexts }];
    const parentId = `save-to-${context}`;
    return [
      { id: parentId, title: t(`menu_${context}_to`), contexts },
      ...recent.map((board) => ({
        id: `${parentId}:${board.id}`,
        parentId,
        // Two boards can share a title: the project tells them apart.
        title: menuTitle(
          board.projectName && recent.some((b) => b !== board && b.title === board.title)
            ? `${board.title} · ${board.projectName}`
            : board.title,
        ),
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
