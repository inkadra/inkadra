// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { chooseSelect } from '../../test/select.ts';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CallSheetModal } from './CallSheetModal.tsx';
import { castCalls, departmentNotes, plannedWrap } from './call-sheet.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const day: ShootingDay = {
  id: 'day-1',
  projectId: 'project',
  boardId: 'board',
  revision: 2,
  date: '2026-11-02',
  callTime: '18:00',
  wrap: '05:00',
  location: 'Station',
  notes: 'Bring lights',
  blocks: [
    {
      id: 'a',
      type: 'shot',
      title: 'Arrival',
      start: '01:00',
      duration: 30,
      shotId: 'frame',
      cast: [' Anna ', 'Bob'],
      departments: ['Camera: bring lights'],
    },
    {
      id: 'b',
      type: 'setup',
      title: 'Prep',
      start: '20:00',
      duration: 30,
      shotId: null,
      cast: ['anna'],
      departments: [],
    },
    {
      id: 'c',
      type: 'note',
      title: '',
      start: null,
      duration: 30,
      shotId: 'removed',
      cast: [],
      departments: [],
    },
  ],
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(days: ShootingDay[]) {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CallSheetModal
        days={days}
        shots={
          new Map([
            [
              'frame',
              {
                label: '4A',
                action: 'Anna steps off the train',
                scene: '4',
                slugline: 'EXT. PLATFORM',
              },
            ],
          ])
        }
        projectName="Film"
        onClose={() => {}}
      />,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
it('derives the earliest cast block with overnight offsets and case-insensitive deduplication', () => {
  expect(castCalls(day)).toEqual([
    { name: 'anna', start: 1200 },
    { name: 'Bob', start: 1500 },
  ]);
  expect(castCalls({ ...day, blocks: [] })).toEqual([]);
});
it('renders saved data and linked or removed shots, toggles sections and prints the selected day', async () => {
  const print = vi.fn();
  vi.stubGlobal('print', print);
  const host = await mount([
    day,
    { ...day, id: 'day-2', date: '2026-11-03', location: 'Studio', blocks: [] },
  ]);
  const paper = () => host.querySelector('article');
  expect(paper()?.textContent).toContain('Station');
  expect(paper()?.textContent).toContain('4A');
  // The description of a shot is what happens in it, not the block type.
  expect(paper()?.textContent).toContain('Anna steps off the train');
  expect(paper()?.textContent).toContain('EXT. PLATFORM');
  expect(paper()?.textContent).toContain('schedule.missingShot');
  expect(paper()?.textContent).toContain('bring lights');
  expect(paper()?.textContent).toContain('05:00 (+1)');
  const schedule = host.querySelector<HTMLInputElement>('input[role=switch]');
  await act(async () => schedule?.click());
  expect(host.querySelector('.sheet__table--schedule')).toBeNull();
  expect(paper()?.textContent).not.toContain('Anna steps off the train');
  const select = host.querySelector<HTMLButtonElement>('.ink-select');
  await act(async () => {
    if (select) {
      chooseSelect(select, 'day-2');
    }
  });
  expect(paper()?.textContent).toContain('Studio');
  expect(paper()?.textContent).not.toContain('Station');
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'shells.print')?.click(),
  );
  expect(print).toHaveBeenCalledOnce();
  // Day 2 has no blocks, cast, departments or notes: those sections say so and stay out.
  expect(host.querySelectorAll('input[role=switch]')).toHaveLength(5);
  expect(host.textContent).toContain('callSheet.emptyHelp');
  expect(paper()?.textContent).not.toContain('bring lights');
});
it('prints the saved wrap, or the end of the last block when none is saved', () => {
  expect(plannedWrap(day)).toBe(1740);
  // Without a wrap time the day ends with its latest block: 01:00 + 30 min, next morning.
  expect(plannedWrap({ ...day, wrap: null })).toBe(1530);
  expect(plannedWrap({ ...day, callTime: '07:30', wrap: null, blocks: [] })).toBeNull();
  const plain = {
    ...day,
    callTime: '07:30',
    wrap: null,
    blocks: [
      { ...(day.blocks[2] as ShootingDay['blocks'][number]), id: 'x', duration: 45 },
      { ...(day.blocks[2] as ShootingDay['blocks'][number]), id: 'y', duration: 90 },
    ],
  };
  expect(plannedWrap(plain)).toBe(7 * 60 + 30 + 135);
});
it('groups department entries by department, splitting "Department: note"', () => {
  const blocks = day.blocks.map((block) => ({ ...block }));
  (blocks[1] as ShootingDay['blocks'][number]).departments = ['Sound', 'camera: dolly'];
  expect(departmentNotes({ ...day, blocks })).toEqual([
    { department: 'camera', note: 'dolly', start: 1200, blockId: 'b' },
    { department: 'Camera', note: 'bring lights', start: 1500, blockId: 'a' },
    { department: 'Sound', note: '', start: 1200, blockId: 'b' },
  ]);
});
it('shows an empty state and disables printing when there are no accessible shooting days', async () => {
  const host = await mount([]);
  expect(host.querySelector('article')).toBeNull();
  expect(host.querySelector('[role=status]')?.textContent).toBe('schedule.empty');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'shells.print')?.disabled,
  ).toBe(true);
});
