import { chooseSelect } from '../../test/select.ts';
// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CallSheetModal } from './CallSheetModal.tsx';
import { castCalls } from './call-sheet.ts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
        labels={new Map([['frame', '4A']])}
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
  expect(paper()?.textContent).toContain('schedule.missingShot');
  expect(paper()?.textContent).toContain('Camera: bring lights');
  expect(paper()?.textContent).toContain('05:00 (+1)');
  const schedule = host.querySelector<HTMLInputElement>('input[type=checkbox]');
  await act(async () => schedule?.click());
  expect(paper()?.textContent).not.toContain('4A');
  const .ink-select = host.querySelector('.ink-select');
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
  expect(host.querySelectorAll('input:disabled')).toHaveLength(5);
});
it('shows an empty state and disables printing when there are no accessible shooting days', async () => {
  const host = await mount([]);
  expect(host.querySelector('article')).toBeNull();
  expect(host.querySelector('[role=status]')?.textContent).toBe('schedule.empty');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'shells.print')?.disabled,
  ).toBe(true);
});
