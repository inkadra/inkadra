// SPDX-License-Identifier: MPL-2.0

import { ElementRef } from './comments.ts';
import { Id, z } from './common.ts';

export const ScheduleTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const TextList = z.array(z.string().trim().min(1).max(120)).max(100);
export const ScheduleBlock = z
  .object({
    id: Id,
    type: z.enum(['setup', 'shot', 'break', 'move', 'note']),
    title: z.string().max(500),
    start: ScheduleTime.nullable().describe('Local clock time; null follows the previous block.'),
    duration: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .describe('Estimated minutes, not shot screen duration.'),
    shotId: ElementRef.nullable(),
    cast: TextList,
    departments: TextList,
  })
  .strict()
  .openapi('ScheduleBlock');
export type ScheduleBlock = z.infer<typeof ScheduleBlock>;
export const ShootingDayInput = z
  .object({
    date: z.iso.date(),
    callTime: ScheduleTime,
    wrap: ScheduleTime.nullable(),
    location: z.string().max(1000),
    notes: z.string().max(10000),
    blocks: z
      .array(ScheduleBlock)
      .max(500)
      .refine(
        (blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length,
        'Block ids must be unique.',
      ),
  })
  .strict()
  .openapi('ShootingDayInput');
export type ShootingDayInput = z.infer<typeof ShootingDayInput>;
export const ShootingDay = z
  .object({
    ...ShootingDayInput.shape,
    id: Id,
    projectId: Id,
    boardId: Id,
    revision: z.number().int().min(1),
  })
  .openapi('ShootingDay');
export type ShootingDay = z.infer<typeof ShootingDay>;
export const UpdateShootingDay = z
  .object({
    ...ShootingDayInput.shape,
    revision: z.number().int().min(1),
  })
  .openapi('UpdateShootingDay');
export const Schedule = z
  .object({ items: z.array(ShootingDay), nextCursor: z.null() })
  .openapi('Schedule');
export type Schedule = z.infer<typeof Schedule>;

/** At most this many calendar days per request across all projects. */
export const MY_SCHEDULE_MAX_DAYS = 62;
export const MyScheduleQuery = z
  .object({
    from: z.iso.date().openapi({ description: 'First local date, included.' }),
    to: z.iso.date().openapi({ description: 'Last local date, included.' }),
  })
  .refine((q) => q.from <= q.to, 'from must not be after to.')
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MY_SCHEDULE_MAX_DAYS,
    `At most ${MY_SCHEDULE_MAX_DAYS} days.`,
  )
  .openapi('MyScheduleQuery');
export type MyScheduleQuery = z.infer<typeof MyScheduleQuery>;
export const PlannedShootingDay = ShootingDay.extend({
  boardTitle: z.string(),
  projectName: z.string(),
}).openapi('PlannedShootingDay');
export type PlannedShootingDay = z.infer<typeof PlannedShootingDay>;
export const MySchedule = z
  .object({ items: z.array(PlannedShootingDay), nextCursor: z.null() })
  .openapi('MySchedule');
export type MySchedule = z.infer<typeof MySchedule>;
