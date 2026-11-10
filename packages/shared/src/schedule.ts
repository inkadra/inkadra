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
    notes: z
      .string()
      .max(2000)
      .optional()
      .describe('A highlighted note on the call sheet. Missing reads as empty.'),
  })
  .strict()
  .openapi('ScheduleBlock');
export type ScheduleBlock = z.infer<typeof ScheduleBlock>;
/** One crew member's call on a shooting day; only the exceptions to the day's call are stored. */
export const DayCall = z
  .object({
    crewMemberId: Id,
    call: ScheduleTime.nullable().describe("Null follows the day's call."),
    pickup: z
      .string()
      .max(1000)
      .nullable()
      .describe("Null follows the crew member's usual pick-up."),
    absent: z
      .boolean()
      .optional()
      .describe(
        'True: not called this day. False: called even when the default says otherwise. Missing: crew are called, cast only when named in the blocks.',
      ),
  })
  .strict()
  .openapi('DayCall');
export type DayCall = z.infer<typeof DayCall>;
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
    calls: z
      .array(DayCall)
      .max(500)
      .refine(
        (calls) => new Set(calls.map((c) => c.crewMemberId)).size === calls.length,
        'One call per crew member.',
      )
      .optional()
      .describe(
        'Per-person calls, for project members only. Missing on input keeps the stored calls; missing on output reads as none.',
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
    updatedBy: z.object({ id: Id, name: z.string() }).nullable().optional(),
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
/** One atomic edit, including creating or removing a date during drag/undo. */
export const EditSchedule = z
  .object({
    changes: z
      .array(
        z
          .object({
            id: Id,
            revision: z.number().int().min(0),
            input: ShootingDayInput.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Day ids must be unique.',
      ),
  })
  .strict()
  .openapi('EditSchedule');
export type EditSchedule = z.infer<typeof EditSchedule>;
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

export function clockMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Start and end of each block in minutes from the shooting date, including overnight. */
export function scheduleTimes(day: Pick<ShootingDayInput, 'callTime' | 'blocks'>) {
  const call = clockMinutes(day.callTime);
  let cursor = call;
  return day.blocks.map((block) => {
    let start = block.start === null ? cursor : clockMinutes(block.start);
    if (block.start !== null && start < call) start += 1440;
    const end = start + block.duration;
    cursor = end;
    return { block, start, end };
  });
}

/** Cast names are free text; the same person matches whatever the case or surrounding spaces. */
export const castNameKey = (name: string) => name.trim().toLowerCase();

export const CastLink = z
  .object({
    castKey: z.string().openapi({ description: 'The cast name after castNameKey.' }),
    userId: Id,
  })
  .openapi('CastLink');
export type CastLink = z.infer<typeof CastLink>;
export const SetCastLink = z
  .object({
    name: z.string().trim().min(1).max(120),
    userId: Id.nullable().openapi({ description: 'The account to link; null removes the link.' }),
  })
  .strict()
  .openapi('SetCastLink');
export type SetCastLink = z.infer<typeof SetCastLink>;

export const AttendanceStatus = z.enum(['confirmed', 'declined']).openapi('AttendanceStatus');
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;
export const DayAttendance = z
  .object({ dayId: Id, userId: Id, status: AttendanceStatus })
  .openapi('DayAttendance');
export type DayAttendance = z.infer<typeof DayAttendance>;
export const SetDayAttendance = z
  .object({ status: AttendanceStatus })
  .strict()
  .openapi('SetDayAttendance');
export type SetDayAttendance = z.infer<typeof SetDayAttendance>;
export const ScheduleAttendance = z
  .object({
    canManage: z.boolean().openapi({ description: 'The caller can edit the schedule.' }),
    links: z.array(CastLink).openapi({
      description: "Every link for people who can edit the schedule, else the caller's own.",
    }),
    responses: z.array(DayAttendance).openapi({
      description: "Every response for people who can edit the schedule, else the caller's own.",
    }),
  })
  .openapi('ScheduleAttendance');
export type ScheduleAttendance = z.infer<typeof ScheduleAttendance>;
