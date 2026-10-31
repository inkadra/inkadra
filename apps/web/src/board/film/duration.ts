// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement } from '@inkadra/canvas-core';

/** How long a frame without a duration counts in the total: one second. */
const DEFAULT_FRAME_MS = 1000;

/**
 * The running time of the frames in order: a frame without a duration counts one second and a
 * frame with an explicit zero duration counts nothing.
 */
export function estimatedDurationMs(frames: readonly FrameElement[]): number {
  let total = 0;
  for (const frame of frames) total += Math.max(0, frame.durationMs ?? DEFAULT_FRAME_MS);
  return total;
}
