// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { ProjectMember, ShootingDay } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { callSheetSections, kickoffSections } from './planning.ts';

type Todo = Extract<Element, { type: 'todo' }>;

// Keys with their values, so the tests read what each cell says.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key) as unknown as TFunction;

const user = (id: string, name: string) => ({ id, name, image: null });
const member = (id: string, name: string, role: ProjectMember['role']): ProjectMember => ({
  user: user(id, name),
  role,
  addedAt: '2026-10-01T10:00:00.000Z',
});

const day = (date: string, extra: Partial<ShootingDay> = {}): ShootingDay => ({
  id: `day-${date}`,
  projectId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
  boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11',
  revision: 1,
  date,
  callTime: '07:00',
  wrap: '19:00',
  location: 'Rifugio',
  notes: '',
  blocks: [],
  ...extra,
});

const todo = (items: Todo['items']): Todo =>
  ({ id: 'todo0001', type: 'todo', x: 0, y: 0, w: 200, items }) as unknown as Todo;

describe('kickoff summary', () => {
  it('lists dates, people by role, open tasks by due date and the schedule', () => {
    const planning = {
      days: [
        day('2026-11-10', {
          blocks: [
            {
              id: 'b1',
              type: 'shot',
              title: 'Arrivo',
              start: null,
              duration: 60,
              shotId: 'frame0001',
              cast: [],
              departments: [],
            },
          ],
        }),
        day('2026-11-12', { wrap: null }),
      ],
      members: [
        member('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20', 'Zoe Bianchi', 'editor'),
        member('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a21', 'Anna Rossi', 'owner'),
      ],
    };
    const todos = [
      todo([
        { id: 'item0001', text: 'Permessi', done: false },
        {
          id: 'item0002',
          text: 'Sopralluogo',
          done: false,
          assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20',
          dueDate: '2026-11-08',
        },
        { id: 'item0003', text: 'Già fatto', done: true },
      ]),
    ];
    const [dates, people, tasks, schedule] = kickoffSections(planning, todos, t, 'it-IT');
    expect(dates?.rows).toHaveLength(1);
    expect(dates?.rows[0]?.[0]).toContain('"count":2');
    expect(people?.rows).toEqual([
      ['Anna Rossi', 'roles.owner'],
      ['Zoe Bianchi', 'roles.editor'],
    ]);
    expect(tasks?.rows.map((row) => row[0])).toEqual(['Sopralluogo', 'Permessi']);
    expect(tasks?.rows[0]?.[1]).toBe('Zoe Bianchi');
    expect(tasks?.rows[1]?.slice(1)).toEqual(['', '']);
    expect(schedule?.rows).toHaveLength(2);
    expect(schedule?.rows[0]?.[1]).toBe('07:00 – 19:00');
    expect(schedule?.rows[0]?.[3]).toBe('export.kickoff.shots{"count":1}');
    // Without a wrap time or blocks there is only the call.
    expect(schedule?.rows[1]?.[1]).toBe('07:00');
  });

  it('says there is nothing when the board has no plan, people or tasks', () => {
    const sections = kickoffSections({ days: [], members: [] }, [], t, 'it-IT');
    expect(sections.map((s) => s.rows.length)).toEqual([0, 0, 0, 0]);
    expect(sections.map((s) => s.empty)).toEqual([
      'export.kickoff.noDays',
      'export.kickoff.noPeople',
      'export.kickoff.noTasks',
      'export.kickoff.noDays',
    ]);
  });
});

describe('call sheet pages', () => {
  it('prints the day, its blocks with their shots, the cast calls and the departments', () => {
    const sections = callSheetSections(
      day('2026-11-10', {
        notes: 'Pranzo al sacco',
        blocks: [
          {
            id: 'b1',
            type: 'setup',
            title: '',
            start: null,
            duration: 30,
            shotId: null,
            cast: [],
            departments: ['Camera: dolly'],
          },
          {
            id: 'b2',
            type: 'shot',
            title: 'Arrivo',
            start: null,
            duration: 60,
            shotId: 'frame0001',
            cast: ['Marta'],
            departments: [],
          },
        ],
      }),
      (id) => (id === 'frame0001' ? '1A' : undefined),
      t,
    );
    const [info, schedule, cast, departments, notes] = sections;
    expect(info?.rows).toEqual([
      ['callSheet.call', '07:00'],
      ['callSheet.wrap', '19:00'],
      ['callSheet.location', 'Rifugio'],
    ]);
    expect(schedule?.rows).toEqual([
      ['07:00 – 07:30', 'schedule.types.setup', ''],
      ['07:30 – 08:30', '1A · Arrivo', 'Marta'],
    ]);
    expect(cast?.rows).toEqual([['Marta', '07:30']]);
    expect(departments?.rows).toEqual([['Camera', 'dolly']]);
    expect(notes?.rows).toEqual([['Pranzo al sacco']]);
  });
});
