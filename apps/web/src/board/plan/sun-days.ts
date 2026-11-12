// SPDX-License-Identifier: AGPL-3.0-only
import type { ShootingDay } from '@inkadra/shared';

/** A shooting day offered as the sun's date: its number in the shoot and its date. */
export interface SunDay {
  n: number;
  date: string;
}

/**
 * The days the sun's date can be (decision 0119): the shooting days of the board's schedule, the
 * same `GET /boards/:id/schedule` ScheduleView reads, numbered as it numbers them (by date, from
 * 1). When the plan serves scenes, only the days that shoot one of their shots; all of them when it
 * serves none or no day shoots them yet.
 */
export function sunDays(
  days: readonly Pick<ShootingDay, 'date' | 'blocks'>[],
  /** The frames of the plan's scenes; empty when the plan serves no scene. */
  shots: ReadonlySet<string>,
): SunDay[] {
  const all = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d, i) => ({ n: i + 1, date: d.date, blocks: d.blocks }));
  const ofScenes = all.filter((d) => d.blocks.some((b) => b.shotId && shots.has(b.shotId)));
  return (ofScenes.length ? ofScenes : all).map(({ n, date }) => ({ n, date }));
}

/** Eight ways north can point, from the top of the drawing clockwise, for "Up, 0°". */
export const NORTH_WAYS = [
  'up',
  'upRight',
  'right',
  'downRight',
  'down',
  'downLeft',
  'left',
  'upLeft',
] as const;

/** The way north points at `degrees`: the nearest of NORTH_WAYS. */
export function northWay(degrees: number): (typeof NORTH_WAYS)[number] {
  return NORTH_WAYS[
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  ] as (typeof NORTH_WAYS)[number];
}
