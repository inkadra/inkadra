// SPDX-License-Identifier: AGPL-3.0-only
import { FRAME_STATUSES, type FrameStatus } from '@inkadra/doc-schema';

export type ShotDisplayStatus = FrameStatus | 'approved';
export type KanbanColumnKey = 'todo' | 'ready' | 'shot' | 'retake' | 'approved';

export const SHOT_DISPLAY_STATUSES: readonly ShotDisplayStatus[] = [
  ...FRAME_STATUSES,
  'approved',
] as const;

/**
 * Derives the effective production/display status of a frame.
 * Frames with `approved: true` are 'approved'.
 * Otherwise, the frame's production status (or 'draft' if unset) is returned.
 */
export function getFrameStatus(frame: {
  status?: FrameStatus | undefined;
  approved?: boolean | undefined;
}): ShotDisplayStatus {
  if (frame.approved) return 'approved';
  return frame.status ?? 'draft';
}

/**
 * Derives the kanban column a frame belongs to.
 * Columns: 'todo' | 'ready' | 'shot' | 'retake' | 'approved'.
 * 'approved' holds the frames `isApproved` counts (the same rule as the export, PR #112): the
 * shot list flag or an approval in review. Only where the card is shown: the production status
 * stays as it is (decision 0013 keeps the two apart).
 * 'todo' column includes 'draft', 'todo', and undefined when not approved.
 */
export function getFrameKanbanColumn(
  frame: { id: string; status?: FrameStatus | undefined; approved?: boolean | undefined },
  reviews: ReadonlyMap<string, { status: string }>,
): KanbanColumnKey {
  if (isApproved(frame, reviews)) return 'approved';
  const s = frame.status;
  if (s === 'ready' || s === 'shot' || s === 'retake') return s;
  return 'todo';
}

/**
 * Whether a frame counts as approved for the "approved frames only" export (#380): approved in
 * review (decision 0013, as the team sees it) or marked approved in the shot list.
 */
export function isApproved(
  frame: { id: string; approved?: boolean | undefined },
  reviews: ReadonlyMap<string, { status: string }>,
): boolean {
  return !!frame.approved || reviews.get(frame.id)?.status === 'approved';
}
