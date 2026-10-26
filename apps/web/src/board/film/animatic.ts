// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement } from '@inkadra/canvas-core';

/** How long a frame without a duration lasts in the animatic preview. */
export const PREVIEW_MS = 1000;
/** Step of the duration handle: dragging or arrows move a block edge by half a second. */
export const DURATION_STEP_MS = 500;
export const MAX_DURATION_MS = 3_600_000;

export interface TimelineEntry {
  frame: FrameElement;
  start: number;
  end: number;
}

/**
 * Frames in storyboard order on one time line. Missing durations preview for one second;
 * frames with an explicit zero duration are left out.
 */
export function animaticTimeline(frames: readonly FrameElement[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let end = 0;
  for (const frame of frames) {
    const length = frame.durationMs ?? PREVIEW_MS;
    if (length <= 0) continue;
    out.push({ frame, start: end, end: end + length });
    end += length;
  }
  return out;
}

/** How long the frames play in the animatic: a frame without a duration counts one second. */
export function estimatedDurationMs(frames: readonly FrameElement[]): number {
  return animaticTimeline(frames).at(-1)?.end ?? 0;
}

/** The entry playing at `ms`; the last one once the time line has ended. */
export function entryAt(timeline: readonly TimelineEntry[], ms: number): TimelineEntry | null {
  return timeline.find((e) => ms < e.end) ?? timeline.at(-1) ?? null;
}

/** 1:05.3: minutes, seconds and tenths. */
export function timecode(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** A duration snapped to the handle step, never below one step nor above an hour. */
export function snapDuration(ms: number): number {
  const snapped = Math.round(ms / DURATION_STEP_MS) * DURATION_STEP_MS;
  return Math.min(MAX_DURATION_MS, Math.max(DURATION_STEP_MS, snapped));
}
