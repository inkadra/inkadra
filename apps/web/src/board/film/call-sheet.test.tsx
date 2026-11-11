// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { CrewMember, ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { chooseSelect } from '../../test/select.ts';
import { BoardStore } from '../store.ts';
import { CallSheetModal } from './CallSheetModal.tsx';
import {
  castCalls,
  dayAddress,
  departmentNotes,
  hasSceneNumbers,
  keyTimes,
  locationsOfDay,
  personalCall,
  plannedWrap,
  serveLines,
} from './call-sheet.ts';
import { sunOfDay } from './day-calls.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { confirmed?: number; total?: number }) =>
      o?.total === undefined ? key : `${key}:${o.confirmed}/${o.total}`,
    i18n: { language: 'en' },
  }),
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
async function mount(
  days: ShootingDay[],
  props: {
    boardId?: string;
    userId?: string;
    canManage?: boolean;
    canLinkCast?: boolean;
    store?: BoardStore;
    crew?: CrewMember[];
  } = {},
) {
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
  // The first toggle is the crew's, off without a roster: Programma is found by its label.
  const schedule = [...host.querySelectorAll('.call-sheet__row')]
    .find(
      (row) => row.querySelector('.call-sheet__row-label')?.textContent === 'callSheet.schedule',
    )
    ?.querySelector<HTMLInputElement>('input[role=switch]');
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
describe('on a phone', () => {
  const answerPath = '/api/v1/boards/board/schedule/day-1/attendance';
  function stubs(attendance: unknown, answered: unknown = {}, phone = true) {
    vi.stubGlobal(
      'matchMedia',
      () =>
        ({
          matches: phone,
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
    // The day's times are said once, in the key-times row, not again above it.
    expect(host.querySelector('.sheet__phone-head')?.textContent).not.toMatch(/\d:\d\d/);
    expect(host.querySelector('.sheet__times dt')?.textContent).toBe('callSheet.call');
    expect(host.querySelector('.call-sheet__presence')).toBeNull();
  });
  it('lets a linked person answer, and sends only the status', async () => {
    const fetch = stubs(
      { ...empty, links: [{ castKey: 'bob', userId: 'me' }] },
      { dayId: 'day-1', userId: 'me', status: 'confirmed' },
    );
    const host = await mountPhone();
    expect(host.querySelector('.sheet__phone-own')?.textContent).toMatch(
      /callSheet\.yourCall · Bob\d+:\d\d/,
    );
    await act(async () => button(host, 'callSheet.confirm')?.click());
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toContain(answerPath);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ status: 'confirmed' });
    expect(button(host, 'callSheet.confirm')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[role=status]')?.textContent).toBe('callSheet.answer.confirmed');
  });
  it('lists the troupe with a call button each, and takes your call from your crew row', async () => {
    stubs(empty);
    const person = (n: number, extra: Partial<CrewMember>): CrewMember => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      projectId: 'project',
      name: `Person ${n}`,
      role: '',
      department: 'Elettricisti',
      phone: '',
      email: '',
      pickup: '',
      notes: '',
      userId: null,
      character: null,
      onSetContact: false,
      position: n,
      revision: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      ...extra,
    });
    const me = person(1, { name: 'Ugo', role: 'Gaffer', userId: 'me', phone: '+39 1111111' });
    const boss = person(2, {
      name: 'Bea',
      role: 'AD',
      phone: '+39 333 123 4567',
      onSetContact: true,
    });
    const host = await mount(
      [{ ...day, calls: [{ crewMemberId: me.id, call: '17:15', pickup: 'Hotel' }] }],
      { boardId: 'board', userId: 'me', crew: [me, boss] },
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    expect(host.querySelector('.sheet__phone-own')?.textContent).toContain(
      'callSheet.yourCall · Gaffer17:15',
    );
    expect(host.querySelector('.sheet__phone-own')?.textContent).toContain('callSheet.pickupAt');
    const rows = [...host.querySelectorAll('.sheet__phone-person')];
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      'Ugo callSheet.you',
      'Bea',
    ]);
    // Your own row has no button; the others dial only the digits.
    expect(rows[0]?.querySelector('a')).toBeNull();
    const dial = rows[1]?.querySelector('a');
    expect(dial?.getAttribute('href')).toBe('tel:+393331234567');
    expect(dial?.getAttribute('aria-label')).toBe('callSheet.callPerson');
    expect(host.textContent).toContain('callSheet.onSetContact');
  });
  it('shows no troupe, phones or pick-ups without the roster', async () => {
    stubs(empty);
    const host = await mountPhone();
    expect(host.querySelector('.sheet__table--troupe, .sheet__phone-troupe')).toBeNull();
    expect(host.textContent).not.toContain('callSheet.onSetContact');
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
  it("opens the day's own map link under a scene's place that has none", async () => {
    stubs(empty);
    const doc = new Y.Doc();
    const scene = createElement(
      doc,
      'scene',
      { x: 0, y: 0 },
      { title: 'Scogliera', number: '1', location: 'Scogliera' },
      { userId: null },
    );
    const frame = createElement(
      doc,
      'frame',
      { x: 0, y: 0 },
      { parent: scene.id },
      { userId: null },
    );
    const store = new BoardStore(doc);
    const mapUrl = 'https://www.openstreetmap.org/#map=16/40.1046/18.5196';
    const host = await mount(
      [
        {
          ...day,
          location: `Faro di Punta Palascia, Otranto ${mapUrl}`,
          blocks: [{ ...day.blocks[0]!, shotId: frame.id }],
        },
      ],
      { boardId: 'board', userId: 'me', store },
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    // The day's place is its own Address line (decision 0095), before the scene's place, and
    // its one Maps button opens the day's map link.
    const places = [...host.querySelectorAll('.sheet__place')].map((p) => p.textContent);
    expect(places[0]).toContain('Faro di Punta Palascia');
    expect(places[1]).toContain('Scogliera');
    const maps = host.querySelectorAll<HTMLAnchorElement>('.sheet__maps');
    expect(maps).toHaveLength(1);
    expect(maps[0]?.href).toBe(mapUrl);
    store.destroy();
  });
  it('keeps the status region in place before the first answer', async () => {
    stubs({ ...empty, links: [{ castKey: 'bob', userId: 'me' }] });
    const host = await mountPhone();
    expect(host.querySelector('.call-sheet__answer [role=status]')?.textContent).toBe('');
  });
  it('says so when attendance cannot be loaded, and still shows the sheet', async () => {
    stubs(empty);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    const host = await mountPhone();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('callSheet.presenceError');
    expect(host.querySelector('article')?.textContent).toContain('Station');
  });
});
it('asks the server nothing and adds nothing on a computer, unless the person organises', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const host = await mount([day], { boardId: 'board', userId: 'me' });
  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector('.call-sheet__presence, .sheet__rows, .call-sheet__bar')).toBeNull();
});
describe('the presence panel on a computer', () => {
  const organiser = {
    canManage: true,
    links: [
      { castKey: 'anna', userId: 'u1' },
      { castKey: 'bob', userId: 'u1' },
    ],
    responses: [{ dayId: 'day-1', userId: 'u1', status: 'confirmed' }],
  };
  const open = async (days = [day], canLinkCast = true) => {
    const host = await mount(days, {
      boardId: 'board',
      userId: 'u1',
      canManage: true,
      canLinkCast,
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    return host;
  };
  const stub = (handler: (init?: RequestInit) => Response | Promise<Response>) => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => handler(init));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const accounts = (host: HTMLElement) => [
    ...host.querySelectorAll<HTMLButtonElement>('.call-sheet__person .ink-select'),
  ];

  it('counts people, not names, and leaves the phone parts and the buttons out', async () => {
    stub(() => Response.json(organiser));
    const host = await open();
    expect(host.querySelector('.call-sheet__presence h3')?.textContent).toContain(
      'callSheet.presenceCount:1/1',
    );
    expect(host.querySelector('.sheet__phone-head, .sheet__rows, .sheet__maps')).toBeNull();
    expect(host.querySelector('.call-sheet__answers')).toBeNull();
    // The panel is outside the sheet: the preview and the print have nothing new.
    expect(host.querySelector('article .call-sheet__presence')).toBeNull();
  });
  it('names an account the list does not show instead of leaving the choice blank', async () => {
    stub(() => Response.json({ ...organiser, links: [{ castKey: 'anna', userId: 'ghost' }] }));
    const host = await open();
    expect(accounts(host)[0]?.textContent).toContain('callSheet.otherAccount');
    expect(accounts(host)[1]?.textContent).toContain('callSheet.noAccount');
  });
  it('shows the accounts without a choice to schedule editors who cannot edit the crew', async () => {
    stub(() => Response.json(organiser));
    const host = await open([day], false);
    expect(accounts(host)).toHaveLength(0);
    const rows = host.querySelectorAll('.call-sheet__presence .call-sheet__row');
    expect(rows[0]?.textContent).toContain('Giulia Rossi');
  });
  it('disables a choice until its request returns', async () => {
    let finish = () => {};
    stub((init) =>
      init?.method === 'PUT'
        ? new Promise((resolve) => {
            finish = () => resolve(new Response(null, { status: 204 }));
          })
        : Response.json({ ...organiser, links: [] }),
    );
    const host = await open();
    const select = accounts(host)[0] as HTMLButtonElement;
    await act(async () => chooseSelect(select, 'u1'));
    expect(accounts(host)[0]?.disabled).toBe(true);
    expect(accounts(host)[1]?.disabled).toBe(false);
    await act(async () => {
      finish();
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(accounts(host)[0]?.disabled).toBe(false);
    expect(accounts(host)[0]?.textContent).toContain('Giulia Rossi');
  });
  it('forgets a failed choice when the day changes', async () => {
    stub((init) =>
      init?.method === 'PUT'
        ? new Response('{}', { status: 500 })
        : Response.json({ ...organiser, links: [] }),
    );
    const host = await open([day, { ...day, id: 'day-2', date: '2026-11-03' }]);
    await act(async () => {
      chooseSelect(accounts(host)[0] as HTMLButtonElement, 'u1');
      await new Promise((resolve) => setTimeout(resolve));
    });
    const alert = () => host.querySelector('.call-sheet__presence [role=alert]');
    expect(alert()?.textContent).toBe('callSheet.saveError');
    await act(async () => {
      chooseSelect(host.querySelector('.ink-select') as HTMLButtonElement, 'day-2');
    });
    expect(alert()).toBeNull();
  });
});

it('computes key times with overnight offsets, omitting unavailable slots', () => {
  expect(keyTimes(day)).toEqual([
    { key: 'call', time: 1080 },
    { key: 'ready', time: 1500 },
    { key: 'cameraWrap', time: 1260 },
    { key: 'crewWrap', time: 1740 },
  ]);
  expect(keyTimes({ ...day, wrap: null, blocks: [] })).toEqual([{ key: 'call', time: 1080 }]);
  const blocks = [
    { ...day.blocks[0]!, start: null },
    { ...day.blocks[0]!, id: 'break', type: 'break' as const, shotId: null, start: null },
  ];
  expect(keyTimes({ ...day, blocks })).toContainEqual({ key: 'pause', time: 1110 });
});

it('resolves ordered locations, numbers and Serve lines by scene identity', () => {
  // Minimal fixtures: the helper only reads these document fields.
  const elements = new Map<string, Element>([
    ['frame', { id: 'frame', type: 'frame', parent: 'scene' } as Element],
    ['other', { id: 'other', type: 'frame', parent: 'scene' } as Element],
    ['scene', { id: 'scene', type: 'scene', number: '4', location: ' Station ' } as Element],
    [
      'location',
      {
        id: 'location',
        type: 'location',
        name: 'station',
        address: 'Platform 12',
        mapUrl: 'https://example.com/map',
      } as Element,
    ],
    [
      'todo',
      {
        id: 'todo',
        type: 'todo',
        sceneId: 'scene',
        list: 'props',
        items: [{ id: 'item', text: 'Ticket', done: false }],
      } as Element,
    ],
  ]);
  const planned = {
    ...day,
    blocks: [
      { ...day.blocks[0]!, start: null },
      { ...day.blocks[0]!, id: 'second', shotId: 'other', start: null },
    ],
  };
  expect(locationsOfDay(planned, elements)).toEqual([
    { name: 'Station', address: 'Platform 12', mapUrl: 'https://example.com/map' },
  ]);
  expect(hasSceneNumbers(planned, elements)).toBe(true);
  expect([...serveLines(planned, elements)]).toEqual([['a', 'Ticket']]);
  elements.set('scene', { ...elements.get('scene')!, number: '', location: 'Bar' } as Element);
  expect(hasSceneNumbers(planned, elements)).toBe(false);
  expect([...serveLines(planned, elements)]).toEqual([['a', 'Ticket']]);
  expect(locationsOfDay({ ...day, location: 'Studio\nMain street', blocks: [] }, elements)).toEqual(
    [{ name: 'Studio', address: 'Main street', mapUrl: undefined }],
  );
});

it('prints each row frame, cast contact and location; omits the scene column on unnumbered days', async () => {
  const doc = new Y.Doc();
  const scene = createElement(
    doc,
    'scene',
    { x: 0, y: 0 },
    { title: 'Studio', number: '', location: 'Studio' },
    { userId: null },
  );
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, { parent: scene.id }, { userId: null });
  createElement(
    doc,
    'character',
    { x: 0, y: 0 },
    { name: 'Bob', actor: 'John', contact: 'Agency phone' },
    { userId: null },
  );
  createElement(
    doc,
    'location',
    { x: 0, y: 0 },
    { name: 'studio', address: 'Main street', mapUrl: 'https://example.com/map' },
    { userId: null },
  );
  const store = new BoardStore(doc);
  const host = await mount([{ ...day, blocks: [{ ...day.blocks[0]!, shotId: frame.id }] }], {
    store,
  });
  expect(host.querySelector('.sheet__thumbnail .frame-pic')).not.toBeNull();
  expect(host.querySelector('.sheet__table--schedule thead')?.textContent).not.toContain(
    'callSheet.scene',
  );
  expect(host.querySelector('article')?.textContent).toContain('Agency phone');
  expect(host.querySelector('article')?.textContent).toContain('John');
  expect(host.querySelector('article')?.textContent).toContain('Main street');
  expect(host.querySelector<HTMLAnchorElement>('article a')?.href).toBe('https://example.com/map');
  expect(host.querySelector('.call-sheet__controls')?.textContent).not.toContain(
    'callSheet.frames',
  );
  store.destroy();
});

describe("the day's Location when the scenes name their own", () => {
  const osm = 'https://www.openstreetmap.org/#map=17/40.1060/18.5180';
  const scenes = () => {
    const doc = new Y.Doc();
    const scene = createElement(
      doc,
      'scene',
      { x: 0, y: 0 },
      { title: 'Scogliera', number: '1', location: 'Scogliera' },
      { userId: null },
    );
    const frame = createElement(
      doc,
      'frame',
      { x: 0, y: 0 },
      { parent: scene.id },
      { userId: null },
    );
    return { doc, frame: frame.id };
  };
  const at = (frame: string, location: string): ShootingDay => ({
    ...day,
    location,
    blocks: [{ ...day.blocks[0]!, shotId: frame }],
  });

  it('keeps the numbered scene locations and adds the address with its map', () => {
    const { doc, frame } = scenes();
    const store = new BoardStore(doc);
    const elements = store.getSnapshot().byId;
    const d = at(frame, `Faro di Punta Palascìa\nVia del Faro, Otranto\n${osm}`);
    expect(locationsOfDay(d, elements)).toEqual([
      { name: 'Scogliera', address: undefined, mapUrl: undefined },
    ]);
    const address = dayAddress(d, elements);
    expect(address).toEqual({
      name: 'Faro di Punta Palascìa',
      address: 'Via del Faro, Otranto',
      mapUrl: osm,
    });
    // Sunrise and sunset come from that address and say so, not "Loc. 1".
    expect(sunOfDay(d, locationsOfDay(d, elements), undefined, address)).toMatchObject({
      location: 0,
    });
    // The Location naming a scene's own place gives that line its address instead.
    const same = at(frame, 'scogliera\nVia del Faro');
    expect(dayAddress(same, elements)).toBeNull();
    expect(locationsOfDay(same, elements)).toEqual([
      { name: 'Scogliera', address: 'Via del Faro', mapUrl: undefined },
    ]);
    store.destroy();
  });

  it('keeps the address written in the day when the location card of that name has none', () => {
    const { doc, frame } = scenes();
    createElement(doc, 'location', { x: 0, y: 0 }, { name: 'Faro' }, { userId: null });
    const store = new BoardStore(doc);
    const elements = store.getSnapshot().byId;
    expect(dayAddress(at(frame, `Faro\nVia Roma 10 ${osm}`), elements)).toEqual({
      name: 'Faro',
      address: 'Via Roma 10',
      mapUrl: osm,
    });
    // Without scene locations it is Loc. 1, with the same address.
    expect(locationsOfDay({ ...day, location: 'Faro\nVia Roma 10', blocks: [] }, elements)).toEqual(
      [{ name: 'Faro', address: 'Via Roma 10', mapUrl: undefined }],
    );
    store.destroy();
  });

  it('prints the address and the map link on the sheet', async () => {
    const { doc, frame } = scenes();
    const store = new BoardStore(doc);
    const host = await mount([at(frame, `Faro di Punta Palascìa\nVia del Faro, Otranto ${osm}`)], {
      store,
    });
    const place = host.querySelector('article')?.textContent ?? '';
    expect(place).toContain('callSheet.address');
    expect(place).toContain('Faro di Punta Palascìa');
    expect(place).toContain('Via del Faro, Otranto');
    expect(place).toContain('callSheet.locationNumber');
    expect(place).toContain('callSheet.sunAddress');
    expect(host.querySelector<HTMLAnchorElement>(`article a[href="${osm}"]`)).not.toBeNull();
    store.destroy();
  });
});

it('keeps the semantic break colour when a break also references a frame', async () => {
  const host = await mount([{ ...day, blocks: [{ ...day.blocks[0]!, type: 'break' }] }]);
  expect(host.querySelector('.sheet__table--schedule .sheet__row--break')?.textContent).toContain(
    '4A',
  );
});

it.each([' ', '\n'])('extracts a free-text map URL separated by %j', (separator) => {
  const mapUrl = 'https://www.openstreetmap.org/#map=17/45.0624/7.6787';
  expect(
    locationsOfDay(
      { ...day, blocks: [], location: `Via Garibaldi 18, Torino${separator}${mapUrl}` },
      new Map(),
    ),
  ).toEqual([{ name: 'Via Garibaldi 18, Torino', address: '', mapUrl }]);
});

it('extracts short map links without requiring coordinates', () => {
  const mapUrl = 'https://maps.app.goo.gl/AbCdEf';
  expect(locationsOfDay({ ...day, blocks: [], location: `Studio ${mapUrl}` }, new Map())).toEqual([
    { name: 'Studio', address: '', mapUrl },
  ]);
});
