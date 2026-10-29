import type { Board } from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';
import {
  type CreatedSetupBoard,
  createSetupBoards,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  setupBoards,
  TEMPLATE_ICONS,
} from '../routes/project-setup.ts';
import type { SeedJob } from '../routes/seed-queue.tsx';
import { createBoard } from './boards.ts';

/** A plain board, or one of the project templates of Home and the guided setup. */
export type CanvasTemplate = 'board' | ProjectTemplate;

/** Templates that lay out more than a plain board: Board already covers Blank and Pitch. */
const laidOut = PROJECT_TEMPLATES.filter((t) =>
  setupBoards(t).some((b) => b.seed || b.kind !== 'board'),
);

/**
 * What the toolbar's Canvas menu inserts: a plain board, then every template that makes one
 * board, then those that make a group of boards (inserted as a board holding them).
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplate[] = [
  'board',
  ...laidOut.filter((t) => setupBoards(t).length === 1),
  ...laidOut.filter((t) => setupBoards(t).length > 1),
];

export const canvasTemplateIcon = (t: CanvasTemplate): IconName =>
  t === 'board' ? 'board' : TEMPLATE_ICONS[t];

/** The canvas shortcuts kept from the Board and Storyboard buttons the menu replaced. */
export const CANVAS_KEYS: Partial<Record<CanvasTemplate, string>> = { board: 'B', storyboard: 'S' };

export const canvasTemplateLabel = (t: CanvasTemplate, translate: (key: string) => string) =>
  t === 'board' ? translate('board.types.board') : translate(`onboarding.templates.${t}.name`);

export const isStoryboardTemplate = (t: CanvasTemplate) =>
  t !== 'board' && setupBoards(t).length === 1 && setupBoards(t)[0]?.kind === 'storyboard';

/**
 * The board a Canvas menu entry inserts under `parentId`, and what to lay out in it once it
 * syncs. A template makes its boards as the project setup does (decision 0021): one board
 * becomes the card, a group goes inside a new board named after the template.
 */
export async function createCanvasBoards(
  projectId: string,
  parentId: string,
  template: CanvasTemplate,
  t: (key: string) => string,
  userId: string,
): Promise<{ board: Board; jobs: SeedJob[] }> {
  const specs = template === 'board' ? [] : setupBoards(template);
  const single = specs.length === 1 ? specs[0] : undefined;
  const board = await createBoard(
    projectId,
    parentId,
    template === 'board' ? t('board.board.untitled') : canvasTemplateLabel(template, t),
    single?.kind ?? 'board',
  );
  if (single)
    return { board, jobs: single.seed ? [{ boardId: board.id, seed: single.seed, userId }] : [] };
  if (template === 'board' || specs.length === 0) return { board, jobs: [] };
  const created: CreatedSetupBoard[] = [];
  await createSetupBoards({ id: projectId, rootBoardId: board.id }, template, created, (key) =>
    t(`onboarding.boards.${key}`),
  );
  return {
    board,
    jobs: [
      ...created.map((c) => ({ boardId: c.board.id, seed: c.seed, userId })),
      { boardId: board.id, links: created, userId },
    ],
  };
}
