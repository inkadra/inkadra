// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement, SceneGroup } from '@inkadra/canvas-core';

/** How long a frame without a duration lasts in the animatic preview. */
export const PREVIEW_MS = 1000;
/** Step of the duration handle: dragging or arrows move a block edge by a quarter second. */
export const DURATION_STEP_MS = 250;
export const MAX_DURATION_MS = 3_600_000;
/** Going back within this long of a frame's start goes to the frame before. */
const BACK_GRACE_MS = 500;

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

/**
 * Where one frame forward or back goes: the start of the next frame (the end after the last),
 * or the start of the frame playing, or of the one before when just past its start.
 */
export function frameStep(timeline: readonly TimelineEntry[], ms: number, dir: 1 | -1): number {
  const active = entryAt(timeline, ms);
  if (!active) return 0;
  const i = timeline.indexOf(active);
  if (dir === 1) return timeline[i + 1]?.start ?? active.end;
  const prev = timeline[i - 1];
  return prev && ms - active.start < BACK_GRACE_MS ? prev.start : active.start;
}

export interface SceneSpan {
  /** The scene of the frames, null for frames outside any scene. */
  sceneId: string | null;
  start: number;
  end: number;
}

/** Runs of consecutive frames of one scene: their edges are the scene cuts. */
export function sceneSpans(timeline: readonly TimelineEntry[]): SceneSpan[] {
  const out: SceneSpan[] = [];
  for (const { frame, start, end } of timeline) {
    const sceneId = frame.parent ?? null;
    const last = out.at(-1);
    if (last && last.sceneId === sceneId) last.end = end;
    else out.push({ sceneId, start, end });
  }
  return out;
}

/**
 * Where a frame dropped before or after another goes, as the scene and index `moveFrames`
 * takes (an index among all the scene's frames, the moved one included). Null when there is
 * nothing to do: frames outside a scene have no order to move into, and dropping a frame
 * next to itself leaves it where it is.
 */
export function reorderTarget(
  groups: readonly SceneGroup[],
  movingId: string,
  targetId: string,
  after: boolean,
): { sceneId: string; index: number } | null {
  if (movingId === targetId) return null;
  const group = groups.find((g) => g.frames.some((f) => f.id === targetId));
  if (!group?.scene) return null;
  const at = group.frames.findIndex((f) => f.id === targetId) + (after ? 1 : 0);
  const from = group.frames.findIndex((f) => f.id === movingId);
  if (from !== -1 && (at === from || at === from + 1)) return null;
  return { sceneId: group.scene.id, index: at };
}

/**
 * One place earlier or later on the time line. Next to a scene cut the frame first goes to
 * the end of the scene before (or the start of the scene after), then into it.
 */
export function neighbourTarget(
  groups: readonly SceneGroup[],
  timeline: readonly TimelineEntry[],
  movingId: string,
  dir: 1 | -1,
): { sceneId: string; index: number } | null {
  const i = timeline.findIndex((e) => e.frame.id === movingId);
  const self = timeline[i];
  const other = timeline[i + dir];
  if (!self || !other) return null;
  const sameScene = (other.frame.parent ?? null) === (self.frame.parent ?? null);
  // Same scene: past the neighbour. Across a cut: to the near edge of the other scene.
  const after = dir === 1 ? sameScene : !sameScene;
  return reorderTarget(groups, movingId, other.frame.id, after);
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

/** How far the sound may drift from the picture before it is put back in place. */
export const AUDIO_DRIFT_MS = 200;

/** Where the sound track should be at `ms` of the time line, or null past its end. */
export function audioTime(ms: number, audioDurationMs: number | null): number | null {
  if (audioDurationMs !== null && ms >= audioDurationMs) return null;
  return Math.max(0, ms) / 1000;
}
