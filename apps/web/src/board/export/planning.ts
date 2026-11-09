// SPDX-License-Identifier: AGPL-3.0-only
import type { Schedule, ShootingDay } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { api } from '../../lib/api.ts';
import { castCalls, departmentNotes, plannedWrap } from '../film/call-sheet.ts';
import { clockLabel, clockMinutes, scheduleTimes } from '../film/schedule.ts';
import type { Section } from './compose.ts';

/** What the call sheets and the scene sheets print: the board's shooting days. */
export interface Planning {
  days: ShootingDay[];
}

/** Shooting days of the board; out of reach, there are none. */
export async function loadPlanning(boardId: string): Promise<Planning> {
  const days = await api.get<Schedule>(`/boards/${boardId}/schedule`).then(
    (r) => r.items,
    () => [],
  );
  return { days: [...days].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** A `YYYY-MM-DD` date in the reader's language, read as a calendar date. */
export function calendarDate(date: string, language: string, style: 'short' | 'long'): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(time);
}

/** The call sheet of one shooting day, as on the sheet of the schedule (without pictures). */
export function callSheetSections(
  day: ShootingDay,
  shotLabel: (id: string) => string | undefined,
  t: TFunction,
): Section[] {
  const wrap = plannedWrap(day);
  const info: Section = {
    title: t('callSheet.day'),
    columns: [1, 3],
    rows: [
      [t('callSheet.call'), clockLabel(clockMinutes(day.callTime))],
      [t('callSheet.wrap'), wrap === null ? '' : clockLabel(wrap)],
      ...(day.location.trim() ? [[t('callSheet.location'), day.location.trim()]] : []),
    ],
    empty: '',
  };
  const schedule: Section = {
    title: t('callSheet.schedule'),
    columns: [1.3, 4, 2],
    rows: scheduleTimes(day).map(({ block, start, end }) => {
      const label = block.shotId ? shotLabel(block.shotId) : undefined;
      const title = block.title.trim() || t(`schedule.types.${block.type}`);
      return [
        `${clockLabel(start)} – ${clockLabel(end)}`,
        label ? `${label} · ${title}` : title,
        block.cast.join(', '),
      ];
    }),
    empty: t('callSheet.noBlocks'),
  };
  const cast: Section = {
    title: t('callSheet.cast'),
    columns: [2, 3],
    rows: castCalls(day).map((call) => [call.name, clockLabel(call.start)]),
    empty: t('callSheet.emptyHelp'),
  };
  const departments: Section = {
    title: t('callSheet.departments'),
    columns: [2, 5],
    rows: departmentNotes(day).map((d) => [d.department, d.note]),
    empty: t('callSheet.emptyHelp'),
  };
  const notes: Section = {
    title: t('callSheet.notes'),
    columns: [1],
    rows: day.notes.trim() ? [[day.notes.trim()]] : [],
    empty: t('callSheet.emptyHelp'),
  };
  return [info, schedule, cast, departments, notes];
}
