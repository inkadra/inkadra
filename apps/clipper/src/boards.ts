// SPDX-License-Identifier: MPL-2.0
import type { Board, ProjectRole } from '@inkadra/shared';
import type { InkadraApi } from './api.ts';
import type { BoardOption } from './messages.ts';
import type { BoardRef } from './storage.ts';

/** Roles that may add cards. The server decides with the effective role; this only hides noise. */
const CAN_EDIT: ReadonlySet<ProjectRole> = new Set(['owner', 'editor']);

/**
 * The picker before anything is typed: recent boards, then the root board of every active
 * project (expandable), then boards shared from other projects.
 */
export async function startingBoards(api: InkadraApi, recent: BoardRef[]): Promise<BoardOption[]> {
  const [projects, shared] = await Promise.all([api.projects(), api.sharedBoards()]);
  const options: BoardOption[] = recent.map((b) => ({
    ...b,
    section: 'recent',
    depth: 0,
    expandable: false,
  }));
  for (const p of projects) {
    if (p.archivedAt || !CAN_EDIT.has(p.myRole)) continue;
    options.push({
      id: p.rootBoardId,
      projectId: p.id,
      title: p.name,
      projectName: p.name,
      section: 'project',
      depth: 0,
      expandable: true,
    });
  }
  for (const b of shared) {
    if (!CAN_EDIT.has(b.myRole)) continue;
    options.push({
      id: b.id,
      projectId: b.projectId,
      title: b.title,
      projectName: null,
      section: 'shared',
      depth: 0,
      expandable: true,
    });
  }
  return options;
}

/** Boards below `parentId`, in tree order, indented from depth 1. Only those one can edit. */
export function boardTree(
  boards: Board[],
  parentId: string,
  projectName: string | null,
): BoardOption[] {
  const children = new Map<string | null, Board[]>();
  for (const b of boards) {
    const list = children.get(b.parentBoardId) ?? [];
    list.push(b);
    children.set(b.parentBoardId, list);
  }
  for (const list of children.values())
    list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));

  const out: BoardOption[] = [];
  const visit = (id: string, depth: number) => {
    for (const child of children.get(id) ?? []) {
      // A board one cannot edit is skipped, not its sub-boards: a grant may allow them.
      if (CAN_EDIT.has(child.myRole))
        out.push({
          id: child.id,
          projectId: child.projectId,
          title: child.title,
          projectName,
          section: 'project',
          depth,
          expandable: false,
        });
      visit(child.id, depth + 1);
    }
  };
  visit(parentId, 1);
  return out;
}

export async function childBoards(
  api: InkadraApi,
  parent: { id: string; projectId: string; projectName: string | null },
): Promise<BoardOption[]> {
  return boardTree(await api.projectBoards(parent.projectId), parent.id, parent.projectName);
}

/** Boards whose title, or whose cards, match the words typed. */
export async function searchBoards(api: InkadraApi, query: string): Promise<BoardOption[]> {
  const hits = await api.search(query, 20);
  // Boards matched by title first, then boards that contain matching cards.
  const ordered = [
    ...hits.filter((h) => h.kind === 'board'),
    ...hits.filter((h) => h.kind !== 'board'),
  ];
  const seen = new Set<string>();
  const out: BoardOption[] = [];
  for (const hit of ordered) {
    if (hit.myRole !== undefined && !CAN_EDIT.has(hit.myRole)) continue;
    if (!hit.boardId || seen.has(hit.boardId)) continue;
    seen.add(hit.boardId);
    out.push({
      id: hit.boardId,
      projectId: hit.projectId,
      title: hit.boardTitle ?? hit.projectName,
      projectName: hit.projectName,
      section: 'search',
      depth: 0,
      expandable: false,
    });
  }
  return out;
}
