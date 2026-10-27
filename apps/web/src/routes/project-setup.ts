import type { Board, Project } from '@inkadra/shared';
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

/** Keep successful steps so retry never deliberately creates a second project or board. */
export async function createSetupBoards(
  project: Project,
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
