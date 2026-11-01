import type { Project } from '@inkadra/shared';
import { boardPath, loadBoards } from '../board/boards.ts';
import { createCanvasBoards } from '../board/canvas-templates.ts';
import { storyboardOf } from '../board/views.ts';
import type { ProjectMenuItem } from './ProjectAppearance.tsx';
import { queueSeeds } from './seed-queue.tsx';

/**
 * The project's storyboard, made the way the Canvas menu makes one (a storyboard board under the
 * root, laid out in the background). A project that already has one gets that one: there is
 * a single storyboard per project, and the menu cannot know without loading the boards.
 * Resolves to the address of the board.
 */
export async function addStoryboard(
  project: Pick<Project, 'id' | 'rootBoardId'>,
  t: (key: string) => string,
  userId: string,
): Promise<string> {
  const boards = await loadBoards(project.id);
  if (!boards) throw new Error('boards unavailable');
  let id = storyboardOf(boards);
  if (!id) {
    const created = await createCanvasBoards(
      project.id,
      project.rootBoardId,
      'storyboard',
      t,
      userId,
    );
    queueSeeds(created.jobs);
    id = created.board.id;
  }
  return boardPath(project.id, id, project.rootBoardId);
}

/** "Add storyboard…" for the project ⋯ menu of the sidebar and the Projects page; editors only. */
export function addStoryboardItem(
  project: Project,
  t: (key: string) => string,
  userId: string,
  go: (to: string) => void,
  onError?: () => void,
): ProjectMenuItem[] {
  if (project.myRole !== 'owner' && project.myRole !== 'editor') return [];
  return [
    {
      label: t('nav.addStoryboard'),
      action: () => void addStoryboard(project, t, userId).then(go, onError),
    },
  ];
}
