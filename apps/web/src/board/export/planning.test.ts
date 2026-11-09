// SPDX-License-Identifier: AGPL-3.0-only
import type { ShootingDay } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { callSheetSections } from './planning.ts';

// Keys with their values, so the tests read what each cell says.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key) as unknown as TFunction;

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
