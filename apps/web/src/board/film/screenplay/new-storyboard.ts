import type { Board } from '@inkadra/shared';
import { queueSeeds } from '../../../routes/seed-queue.tsx';
import { createBoard } from '../../boards.ts';
import type { ImportPlan } from './plan.ts';
import { castName } from './plan.ts';

/** Board title from the script's title page: LAST TRAIN → Last Train. */
export const storyboardTitle = (plan: ImportPlan, fallback: string) =>
  (plan.title ? castName(plan.title) : fallback).slice(0, 200);

/**
 * A storyboard board under `parentId` filled from the plan once it syncs, by the seed queue
 * like the Canvas menu's templates, so it carries on if the person opens it straight away.
 */
export async function createScreenplayStoryboard(
  projectId: string,
  parentId: string,
  plan: ImportPlan,
  fallbackTitle: string,
  userId: string,
): Promise<Board> {
  const board = await createBoard(
    projectId,
    parentId,
    storyboardTitle(plan, fallbackTitle),
    'storyboard',
  );
  queueSeeds([{ boardId: board.id, screenplay: plan, userId }]);
  return board;
}
