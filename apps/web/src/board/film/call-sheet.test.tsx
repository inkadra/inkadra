// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseSelect } from '../../test/select.ts';
import { CallSheetModal } from './CallSheetModal.tsx';
import { castCalls, departmentNotes, personalCall, plannedWrap, sheetRows } from './call-sheet.ts';

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
async function mount(days: ShootingDay[], props: { boardId?: string; userId?: string } = {}) {
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
        {...props}
        needed={(d) =>
          d.blocks.length
            ? [
                {
                  key: 'towel',
                  list: 'wardrobe',
                  text: 'Towel',
                  count: 2,
                  scenes: ['3', '5'],
                  done: true,
                  assigneeId: 'u1',
                  items: [],
                },
              ]
            : []
        }
        people={[{ id: 'u1', name: 'Giulia Rossi', image: null, email: null }]}
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
  // What the day's scenes need, with an empty box to tick by hand even when ticked online.
  const needed = paper()?.querySelector('tbody tr:has(.sheet__box)');
  expect(needed?.textContent).toBe('Towel ×2board.todo.lists.wardrobe3, 5Giulia R.');
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
  // Day 2 has no blocks, cast, departments, notes, frames or plans: they say so and stay out.
  expect(host.querySelectorAll('input[role=switch]')).toHaveLength(8);
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
it("finds a linked person's earliest call, matching the name whatever its case", () => {
  const links = [{ castKey: 'anna', userId: 'me' }];
  expect(personalCall(day, links, 'me')).toEqual({ name: 'anna', start: 1200 });
  expect(personalCall(day, links, 'other')).toBeNull();
  expect(personalCall(day, [], 'me')).toBeNull();
});
it('joins shots in a row of one scene and cast, and nothing else', () => {
  const shot = (id: string, cast: string[], shotId: string | null = id) => ({
    ...(day.blocks[0] as ShootingDay['blocks'][number]),
    id,
    start: null,
    shotId,
    cast,
  });
  const labels = new Map([
    ['4a', { label: '4A', scene: '4' }],
    ['4b', { label: '4B', scene: '4' }],
    ['4c', { label: '4C', scene: '4' }],
    ['4d', { label: '4D', scene: '4' }],
    ['3a', { label: '3A', scene: '3' }],
  ]);
  const rows = sheetRows(
    {
      ...day,
      blocks: [
        shot('4a', ['Anna']),
        shot('4b', [' anna ']),
        shot('4c', ['Anna']),
        shot('4d', ['Bob']),
        shot('3a', ['Bob']),
        shot('gone', ['Bob'], 'gone'),
        { ...shot('lunch', [], null), type: 'break' },
      ],
    },
    (id) => (id ? labels.get(id) : undefined),
  );
  expect(rows.map((r) => [r.id, r.first, r.last])).toEqual([
    ['4a', '4A', '4C'],
    ['4d', '4D', undefined],
    ['3a', '3A', undefined],
    ['gone', undefined, undefined],
    ['lunch', undefined, undefined],
  ]);
});
describe('on a phone', () => {
  const answerPath = '/api/v1/boards/board/schedule/day-1/attendance';
  function stubs(attendance: unknown, answered: unknown = {}) {
    vi.stubGlobal(
      'matchMedia',
      () =>
        ({
          matches: true,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    const fetch = vi.fn(async (input: string, init?: RequestInit) =>
      Response.json(init?.method === 'PUT' ? answered : attendance),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  const button = (host: HTMLElement, name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === name);
  const empty = { canManage: false, links: [], responses: [] };
  const mountPhone = async () => {
    const host = await mount([day], { boardId: 'board', userId: 'me' });
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    return host;
  };

  it('leaves the buttons and the own call out for people who are not linked', async () => {
    stubs(empty);
    const host = await mountPhone();
    expect(button(host, 'callSheet.confirm')).toBeUndefined();
    expect(button(host, 'callSheet.decline')).toBeUndefined();
    expect(host.textContent).not.toContain('callSheet.yourCall');
    expect(host.textContent).toContain('callSheet.general');
    expect(host.querySelector('.call-sheet__presence')).toBeNull();
  });
  it('lets a linked person answer, and sends only the status', async () => {
    const fetch = stubs(
      { ...empty, links: [{ castKey: 'bob', userId: 'me' }] },
      { dayId: 'day-1', userId: 'me', status: 'confirmed' },
    );
    const host = await mountPhone();
    expect(host.querySelector('.sheet__phone-own')?.textContent).toContain('Bob');
    await act(async () => button(host, 'callSheet.confirm')?.click());
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toContain(answerPath);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ status: 'confirmed' });
    expect(button(host, 'callSheet.confirm')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[role=status]')?.textContent).toBe('callSheet.answer.confirmed');
  });
  it('shows organisers who answered, and calls no other site for the map link', async () => {
    const fetch = stubs({
      canManage: true,
      links: [{ castKey: 'anna', userId: 'u1' }],
      responses: [{ dayId: 'day-1', userId: 'u1', status: 'confirmed' }],
    });
    const host = await mountPhone();
    const panel = host.querySelector('.call-sheet__presence');
    expect(panel?.textContent).toContain('callSheet.status.confirmed');
    expect(panel?.querySelectorAll('.call-sheet__row')).toHaveLength(2);
    expect(host.querySelector<HTMLAnchorElement>('.sheet__maps')?.href).toBe(
      'https://www.openstreetmap.org/search?query=Station',
    );
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith('/'))).toBe(true);
  });
  it('says so when attendance cannot be loaded, and still shows the sheet', async () => {
    stubs(empty);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    const host = await mountPhone();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('callSheet.presenceError');
    expect(host.querySelector('article')?.textContent).toContain('Station');
  });
});
it('asks the server nothing and adds nothing on a computer', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const host = await mount([day], { boardId: 'board', userId: 'me' });
  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector('.sheet__phone-head, .sheet__rows, .call-sheet__bar')).toBeNull();
});
