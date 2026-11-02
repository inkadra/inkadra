import type { Project } from '@inkadra/shared';
import { boardPath, createBoard, loadBoards } from '../board/boards.ts';
import { storyboardOf } from '../board/views.ts';
import type { ProjectMenuItem } from './ProjectAppearance.tsx';

/** Open the existing storyboard, or create an empty one under the project root. */
export async function addStoryboard(
  project: Pick<Project, 'id' | 'rootBoardId'>,
  t: (key: string) => string,
): Promise<string> {
  const boards = await loadBoards(project.id);
  if (!boards) throw new Error('boards unavailable');
  let id = storyboardOf(boards);
  if (!id) {
    const board = await createBoard(
      project.id,
      project.rootBoardId,
      t('film.views.storyboard'),
      'storyboard',
    );
    id = board.id;
  }
  return boardPath(project.id, id, project.rootBoardId);
}

/** "Add storyboard…" for the project ⋯ menu of the sidebar and the Projects page; editors only. */
export function addStoryboardItem(
  project: Project,
  t: (key: string) => string,
  go: (to: string) => void,
  onError?: () => void,
): ProjectMenuItem[] {
  if (project.myRole !== 'owner' && project.myRole !== 'editor') return [];
  return [
    {
      label: t('nav.addStoryboard'),
      action: () => void addStoryboard(project, t).then(go, onError),
    },
  ];
}
