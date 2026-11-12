import { type BoardKind, offered, type Project } from '@inkadra/shared';
import { boardPath, createBoard, loadBoards, productionOf } from '../board/boards.ts';
import { RequestError } from '../lib/api.ts';
import type { ProjectMenuItem } from './ProjectAppearance.tsx';

/** The kinds the project ⋯ menu adds under the root (decision 0121). */
type AddedKind = Exclude<BoardKind, 'board'>;

/**
 * Makes a new storyboard or moodboard under the project root and returns its address. A project
 * may hold several (decision 0121): the second is "Storyboard 2", and so on. It holds one
 * Production board (decision 0123): with one, its address; one in the trash comes back.
 */
export async function addBoard(
  project: Pick<Project, 'id' | 'rootBoardId'>,
  kind: AddedKind,
  t: (key: string) => string,
): Promise<string> {
  const boards = await loadBoards(project.id);
  if (!boards) throw new Error('boards unavailable');
  const live = kind === 'production' ? productionOf(boards) : undefined;
  if (live) return boardPath(project.id, live.id, project.rootBoardId);
  const name = t(`film.views.${kind}`);
  const n = kind === 'production' ? 1 : boards.filter((b) => b.kind === kind).length + 1;
  try {
    const board = await createBoard(
      project.id,
      project.rootBoardId,
      n > 1 ? `${name} ${n}` : name,
      kind,
    );
    return boardPath(project.id, board.id, project.rootBoardId);
  } catch (err) {
    // Someone made the Production board a moment ago: open theirs.
    const details = err instanceof RequestError && err.status === 409 ? err.details : null;
    if (details && typeof details === 'object' && 'boardId' in details)
      return boardPath(project.id, String(details.boardId), project.rootBoardId);
    throw err;
  }
}

/**
 * "Add storyboard", "Add moodboard" and "Add Production" for the project ⋯ menu; editors only,
 * and only the kinds of modules that are on for this person (`off`, decision 0121). With a
 * Production board in `boards` (the project's, when loaded), its entry says so and opens it.
 */
export function addBoardItems(
  project: Project,
  t: (key: string) => string,
  go: (to: string) => void,
  off: readonly string[],
  onError?: () => void,
  boards?: Parameters<typeof productionOf>[0],
): ProjectMenuItem[] {
  if (project.myRole !== 'owner' && project.myRole !== 'editor') return [];
  const kinds = (['storyboard', 'moodboard', 'production'] as const).filter((k) =>
    offered(off, 'kinds', k),
  );
  const present = !!productionOf(boards);
  return kinds.map((kind) => ({
    label:
      kind === 'production'
        ? present
          ? `${t('film.views.production')} · ${t('board.canvasMenu.present')}`
          : t('nav.addProduction')
        : t(kind === 'storyboard' ? 'nav.addStoryboard' : 'nav.addMoodboard'),
    action: () => void addBoard(project, kind, t).then(go, onError),
  }));
}
