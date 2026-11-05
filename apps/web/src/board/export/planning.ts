// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import { type ProjectMember, ProjectRole, type Schedule, type ShootingDay } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { api } from '../../lib/api.ts';
import { castCalls, departmentNotes, plannedWrap } from '../film/call-sheet.ts';
import { clockLabel, clockMinutes, scheduleTimes } from '../film/schedule.ts';
import type { Section } from './compose.ts';

type Todo = Extract<Element, { type: 'todo' }>;

/** What the kickoff summary and the call sheet print: the board's shooting days and the people. */
export interface Planning {
  days: ShootingDay[];
  members: ProjectMember[];
}

/**
 * Shooting days of the board and members of the project. Either may be out of reach (a reader
 * with a board grant only cannot list members): the summary then says there is nothing.
 */
export async function loadPlanning(projectId: string, boardId: string): Promise<Planning> {
  const [days, members] = await Promise.all([
    api.get<Schedule>(`/boards/${boardId}/schedule`).then(
      (r) => r.items,
      () => [],
    ),
    api.get<{ items: ProjectMember[] }>(`/projects/${projectId}/members`).then(
      (r) => r.items,
      () => [],
    ),
  ]);
  return { days: [...days].sort((a, b) => a.date.localeCompare(b.date)), members };
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

/**
 * The kickoff summary (#380): shooting dates, people with their roles, the open tasks of the
 * board's to-do cards (#304) and an overview of the schedule. `todos` are the cards the export
 * may show.
 * shortcut: tasks of this board only, like its schedule; a project-wide list needs a server
 * endpoint, worth adding if kickoffs are exported from boards without the to-dos.
 */
export function kickoffSections(
  planning: Planning,
  todos: readonly Todo[],
  t: TFunction,
  language: string,
): Section[] {
  const { days, members } = planning;
  const first = days[0];
  const last = days.at(-1);
  const dates: Section = {
    title: t('export.kickoff.dates'),
    columns: [1],
    rows:
      first && last
        ? [
            [
              t('export.kickoff.period', {
                count: days.length,
                from: calendarDate(first.date, language, 'long'),
                to: calendarDate(last.date, language, 'long'),
              }),
            ],
          ]
        : [],
    empty: t('export.kickoff.noDays'),
  };
  const people: Section = {
    title: t('export.kickoff.people'),
    columns: [2, 3],
    rows: [...members]
      .sort(
        (a, b) =>
          ProjectRole.options.indexOf(a.role) - ProjectRole.options.indexOf(b.role) ||
          a.user.name.localeCompare(b.user.name, language),
      )
      .map((m) => [m.user.name, t(`roles.${m.role}`)]),
    empty: t('export.kickoff.noPeople'),
  };
  const name = (id: string | undefined) =>
    (id && members.find((m) => m.user.id === id)?.user.name) || '';
  const open = todos
    .flatMap((todo) => todo.items.filter((item) => !item.done && item.text.trim()))
    .sort(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.text.localeCompare(b.text, language),
    );
  const tasks: Section = {
    title: t('export.kickoff.tasks'),
    columns: [4, 2, 1.5],
    rows: open.map((item) => [
      item.text,
      name(item.assigneeId),
      item.dueDate ? calendarDate(item.dueDate, language, 'short') : '',
    ]),
    empty: t('export.kickoff.noTasks'),
  };
  const schedule: Section = {
    title: t('export.kickoff.schedule'),
    columns: [1.6, 1.4, 3, 1.2],
    rows: days.map((day) => {
      const wrap = plannedWrap(day);
      const call = clockLabel(clockMinutes(day.callTime));
      return [
        calendarDate(day.date, language, 'short'),
        wrap === null ? call : `${call} – ${clockLabel(wrap)}`,
        day.location.trim(),
        t('export.kickoff.shots', {
          count: day.blocks.filter((block) => block.type === 'shot').length,
        }),
      ];
    }),
    empty: t('export.kickoff.noDays'),
  };
  return [dates, people, tasks, schedule];
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
