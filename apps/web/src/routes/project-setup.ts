import type { Board, Project } from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';
import { createBoard } from '../board/boards.ts';

export const PROJECT_TEMPLATES = [
  'production',
  'moodboard',
  'storyboard',
  'shotlist',
  'pitch',
  'blank',
] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];
/** Shared by the Home template cards and the canvas toolbar's Canvas menu. */
export const TEMPLATE_ICONS: Record<ProjectTemplate, IconName> = {
  production: 'scene',
  moodboard: 'image',
  storyboard: 'storyboard',
  shotlist: 'shotlist',
  pitch: 'board',
  blank: 'plus',
};
/**
 * The guided setup's title, shared by the page and the header breadcrumb: only a user without
 * projects gets the welcome one, and none while the projects are loading.
 */
export const onboardingTitle = (projects: readonly Project[] | null | undefined) =>
  projects ? (projects.length === 0 ? 'onboarding.firstTitle' : 'onboarding.title') : null;
export interface SetupBoard {
  key: string;
  kind: 'board' | 'storyboard';
  seed?: 'production' | 'moodboard' | 'storyboard' | 'brief' | 'locations' | 'casting';
}
export const setupBoards = (template: ProjectTemplate): SetupBoard[] => {
  if (template === 'production')
    return [
      { key: 'brief', kind: 'board', seed: 'brief' },
      { key: 'locations', kind: 'board', seed: 'locations' },
      { key: 'casting', kind: 'board', seed: 'casting' },
      { key: 'moodboard', kind: 'board', seed: 'moodboard' },
      { key: 'storyboard', kind: 'storyboard', seed: 'storyboard' },
    ];
  if (template === 'blank') return [];
  if (template === 'shotlist' || template === 'storyboard')
    return [{ key: template, kind: 'storyboard', seed: 'storyboard' }];
  return [
    {
      key: template,
      kind: 'board',
      ...(template === 'moodboard' ? { seed: 'moodboard' as const } : {}),
    },
  ];
};
export interface CreatedSetupBoard {
  board: Board;
  seed?: SetupBoard['seed'];
}

/**
 * Keep successful steps so retry never deliberately creates a second project or board. The
 * boards go under `rootBoardId`: the project's root, or a board inserted on a canvas.
 */
export async function createSetupBoards(
  project: Pick<Project, 'id' | 'rootBoardId'>,
  template: ProjectTemplate,
  created: CreatedSetupBoard[],
  title: (key: string) => string,
) {
  const specs = setupBoards(template);
  for (let i = created.length; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec) continue;
    const board = await createBoard(project.id, project.rootBoardId, title(spec.key), spec.kind);
    created.push({ board, seed: spec.seed });
  }
}
