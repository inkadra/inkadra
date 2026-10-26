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
 * 'approved' column shows frames with the new `approved: true` flag.
 * 'todo' column includes 'draft', 'todo', and undefined when not approved.
 */
export function getFrameKanbanColumn(frame: {
  status?: FrameStatus | undefined;
  approved?: boolean | undefined;
}): KanbanColumnKey {
  if (frame.approved) return 'approved';
  const s = frame.status;
  if (s === 'ready' || s === 'shot' || s === 'retake') return s;
  return 'todo';
}
