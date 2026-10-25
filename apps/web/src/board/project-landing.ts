import type { Board, Project } from '@inkadra/shared';

export type ProjectLanding =
  | { kind: 'loading' }
  | { kind: 'board'; boardId: string }
  | { kind: 'shared'; boardId: string }
  | { kind: 'notFound' };

/**
 * What /p/:projectId opens. Members get the root board. People with access to some boards
 * only go to the first board shared with them in that project, which they already see in the
 * sidebar, so nothing above it is revealed (decision 0011); anyone else gets "not found".
 */
export function projectLanding(
  projectId: string,
  projects: Pick<Project, 'id' | 'rootBoardId'>[] | null,
  shared: Pick<Board, 'id' | 'projectId'>[] | null,
): ProjectLanding {
  if (!projects) return { kind: 'loading' };
  const project = projects.find((p) => p.id === projectId);
  if (project) return { kind: 'board', boardId: project.rootBoardId };
  if (!shared) return { kind: 'loading' };
  const entry = shared.find((b) => b.projectId === projectId);
  return entry ? { kind: 'shared', boardId: entry.id } : { kind: 'notFound' };
}
