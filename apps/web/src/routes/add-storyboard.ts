import type { BoardKind, Project } from '@inkadra/shared';
import { boardPath, createBoard, loadBoards } from '../board/boards.ts';
import type { ProjectMenuItem } from './ProjectAppearance.tsx';

/** The kinds the project ⋯ menu adds under the root (decision 0121). */
type AddedKind = Exclude<BoardKind, 'board'>;

/**
 * Makes a new storyboard or moodboard under the project root and returns its address. A project
 * may hold several (decision 0121): the second is "Storyboard 2", and so on.
 */
export async function addBoard(
  project: Pick<Project, 'id' | 'rootBoardId'>,
  kind: AddedKind,
  t: (key: string) => string,
): Promise<string> {
  const boards = await loadBoards(project.id);
  if (!boards) throw new Error('boards unavailable');
  const name = t(`film.views.${kind}`);
  const n = boards.filter((b) => b.kind === kind).length + 1;
  const board = await createBoard(
    project.id,
    project.rootBoardId,
    n > 1 ? `${name} ${n}` : name,
    kind,
  );
  return boardPath(project.id, board.id, project.rootBoardId);
}

/** "Add storyboard" and "Add moodboard" for the project ⋯ menu; editors only. */
export function addBoardItems(
  project: Project,
  t: (key: string) => string,
  go: (to: string) => void,
  onError?: () => void,
): ProjectMenuItem[] {
  if (project.myRole !== 'owner' && project.myRole !== 'editor') return [];
  return (['storyboard', 'moodboard'] as const).map((kind) => ({
    label: t(kind === 'storyboard' ? 'nav.addStoryboard' : 'nav.addMoodboard'),
    action: () => void addBoard(project, kind, t).then(go, onError),
  }));
}
