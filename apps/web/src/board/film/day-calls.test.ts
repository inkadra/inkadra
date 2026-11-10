// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { CrewMember, ShootingDayInput } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  castCard,
  castRows,
  dayCrew,
  dialNumber,
  onSetContacts,
  personalDayCall,
  sunOfDay,
  troupeRows,
  withDayCall,
} from './day-calls.ts';
import { sunTimes } from './sun.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (n: number, extra: Partial<CrewMember> = {}): CrewMember => ({
  id: id(n),
  projectId: id(999),
  name: `Person ${n}`,
  role: '',
  department: '',
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
const block = (n: number, cast: string[], duration = 60) => ({
  id: `b${n}`,
  type: 'shot' as const,
  title: '',
  start: null,
  duration,
  shotId: null,
  cast,
  departments: [],
});
const day = (extra: Partial<ShootingDayInput> = {}): ShootingDayInput => ({
  date: '2026-11-19',
  callTime: '07:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [block(1, ['Mara']), block(2, ['luca '])],
  ...extra,
});

const dop = member(1, { name: 'Ada', role: 'DOP', department: 'Camera', pickup: 'Hotel 06:30' });
const mara = member(2, { name: 'Mara', department: 'Cast' });
const anna = member(3, { name: 'Anna', role: 'Cast' });
const giulia = member(4, {
  name: 'Giulia',
  department: 'Cast',
  character: { boardId: id(998), elementId: 'char0001' },
});
const elements = new Map<string, Element>([
  ['char0001', { id: 'char0001', type: 'character', name: 'Luca' } as unknown as Element],
]);

describe('character cards on another board of the project', () => {
  const characters = [
    { boardId: id(998), elementId: 'char0001', name: 'Luca', actor: 'Giulia B.', contact: '+39 1' },
  ];
  it('matches the row through the card wherever it is, not only by its own name', () => {
    expect(dayCrew(day(), [giulia]).map((e) => e.called)).toEqual([false]);
    const [entry] = dayCrew(day(), [giulia], new Map(), characters);
    expect(entry).toMatchObject({ called: true, names: ['luca '] });
    expect(castCard('luca ', entry, new Map(), characters)).toMatchObject({
      actor: 'Giulia B.',
      contact: '+39 1',
    });
  });
  it('prefers the live card of this board and never lends a card to another name', () => {
    const [entry] = dayCrew(day(), [giulia], elements, characters);
    expect(castCard('Luca', entry, elements, characters)).toEqual({
      name: 'Luca',
      actor: '',
      contact: '',
    });
    expect(castCard('Giulia', entry, new Map(), characters)).toBeUndefined();
  });
});

describe('who is called on a day (decision 0092)', () => {
  it('calls the crew, and the cast only when they are in the day’s blocks', () => {
    const entries = dayCrew(day(), [dop, mara, anna, giulia], elements);
    expect(entries.map((e) => [e.member.name, e.cast, e.called])).toEqual([
      ['Ada', false, true],
      ['Mara', true, true],
      ['Anna', true, false],
      // Matched through the character card she plays.
      ['Giulia', true, true],
    ]);
    expect(entries[1]?.scene).toEqual({ start: 420, blockId: 'b1' });
    expect(entries[3]?.scene).toEqual({ start: 480, blockId: 'b2' });
    expect(entries[3]?.names).toEqual(['luca ']);
    // Everybody follows the day: its call, their usual pick-up.
    expect(entries[0]).toMatchObject({ call: 420, pickup: 'Hotel 06:30', ownCall: null });
  });

  it('applies the exceptions stored on the day', () => {
    const entries = dayCrew(
      day({
        calls: [
          { crewMemberId: dop.id, call: '06:15', pickup: 'Station', absent: true },
          { crewMemberId: anna.id, call: null, pickup: null, absent: false },
        ],
      }),
      [dop, anna],
    );
    expect(entries[0]).toMatchObject({ called: false, call: 375, pickup: 'Station' });
    expect(entries[1]).toMatchObject({ called: true, usual: false, call: 420 });
  });

  it('stores only what differs from the default', () => {
    const [ada, , annaEntry] = dayCrew(day(), [dop, mara, anna]);
    if (!ada || !annaEntry) throw new Error('missing');
    const late = withDayCall(undefined, ada, { call: '08:00' }, [dop, mara, anna]);
    expect(
      withDayCall([{ crewMemberId: id(99), call: null, pickup: null }], ada, { call: '08:00' }, [
        dop,
      ]),
    ).toEqual(late);
    expect(withDayCall(late, ada, { call: '08:00' }, [])).toEqual([]);
    expect(late).toEqual([{ crewMemberId: dop.id, call: '08:00', pickup: null }]);
    const off = withDayCall(late, { ...ada, ownCall: '08:00' }, { called: false }, [
      dop,
      mara,
      anna,
    ]);
    expect(off).toEqual([{ crewMemberId: dop.id, call: '08:00', pickup: null, absent: true }]);
    // Back to the default: the entry goes, and the person follows the day again.
    expect(
      withDayCall(late, { ...ada, ownCall: '08:00' }, { call: null }, [dop, mara, anna]),
    ).toEqual([]);
    expect(withDayCall([], annaEntry, { called: true }, [dop, mara, anna])).toEqual([
      { crewMemberId: anna.id, call: null, pickup: null, absent: false },
    ]);
    // An emptied pick-up follows the usual one.
    expect(withDayCall([], ada, { pickup: '' }, [dop, mara, anna])).toEqual([]);
  });
});

describe('the call sheet’s crew', () => {
  it('lists the cast with their row and the rest of the called crew apart', () => {
    const d = day();
    const entries = dayCrew(d, [dop, mara, anna, giulia], elements);
    expect(castRows(d, entries).map((r) => [r.name, r.entry?.member.name])).toEqual([
      ['Mara', 'Mara'],
      ['luca', 'Giulia'],
    ]);
    expect(troupeRows(d, entries).map((e) => e.member.name)).toEqual(['Ada']);
  });

  it('names the called on-set contacts, else any marked one', () => {
    const boss = member(5, { name: 'Bea', onSetContact: true });
    const away = member(6, { name: 'Ciro', onSetContact: true });
    const d = day({ calls: [{ crewMemberId: away.id, call: null, pickup: null, absent: true }] });
    expect(onSetContacts(dayCrew(d, [boss, away])).map((e) => e.member.name)).toEqual(['Bea']);
    expect(onSetContacts(dayCrew(d, [away])).map((e) => e.member.name)).toEqual(['Ciro']);
    expect(onSetContacts(dayCrew(d, [dop]))).toEqual([]);
  });

  it('dials only the number in a phone field', () => {
    expect(dialNumber('Agenzia Nord · +39 02 000-0001')).toBe('+39020000001');
    expect(dialNumber('333 1234567')).toBe('3331234567');
    expect(dialNumber('ask the office')).toBeNull();
    expect(dialNumber('')).toBeNull();
  });
});

describe('your call', () => {
  const me = id(50);
  it('comes from the crew row linked to the account, with its own call and pick-up', () => {
    const mine = member(7, { name: 'Ugo', role: 'Gaffer', userId: me, pickup: 'Home' });
    const d = day({ calls: [{ crewMemberId: mine.id, call: '06:00', pickup: null }] });
    expect(personalDayCall(d, dayCrew(d, [mine]), undefined, me)).toEqual({
      label: 'Gaffer',
      start: 360,
      pickup: 'Home',
      crew: true,
    });
  });

  it('looks at every row of the account and takes the earliest one called', () => {
    // Mara is not in the day's blocks (not called); Luca is, and a later Leo row too.
    const mara = member(9, { name: 'Mara', department: 'Cast', userId: me, position: 1 });
    const absent = member(10, { name: 'Luca', department: 'Cast', userId: me, position: 2 });
    const late = member(11, { name: 'Ugo', role: 'Gaffer', userId: me, position: 3 });
    const d = day({
      blocks: [block(1, ['Nina']), block(2, ['luca'])],
      calls: [{ crewMemberId: late.id, call: '09:00', pickup: null }],
    });
    expect(personalDayCall(d, dayCrew(d, [mara, absent, late]), undefined, me)).toMatchObject({
      label: 'Luca',
      start: 420,
    });
    const none = day({ blocks: [block(1, ['Nina'])] });
    expect(personalDayCall(none, dayCrew(none, [mara]), undefined, me)).toBeNull();
  });

  it('falls back to the board’s cast links, and is nothing when not called', () => {
    const mine = member(8, { name: 'Mara', department: 'Cast', userId: me });
    const d = day({ calls: [{ crewMemberId: mine.id, call: null, pickup: null, absent: true }] });
    const links = [{ castKey: 'mara', userId: me }];
    expect(personalDayCall(d, dayCrew(d, [mine]), links, me)).toBeNull();
    expect(personalDayCall(d, [], links, me)).toEqual({
      label: 'Mara',
      start: 420,
      crew: false,
    });
    expect(personalDayCall(d, [], undefined, me)).toBeNull();
    expect(personalDayCall(d, [], links, id(51))).toBeNull();
  });
});

describe('sunrise and sunset', () => {
  it('uses the first location with coordinates, numbered as on the sheet', () => {
    const d = day();
    const at = 'https://www.openstreetmap.org/#map=17/45.0703/7.5210';
    expect(sunOfDay(d, [{ name: 'Bar' }, { name: 'Park', mapUrl: at }])).toEqual({
      ...sunTimes(d.date, 45.0703, 7.521),
      location: 2,
    });
    // The day's own location, when its text holds a map link.
    expect(sunOfDay({ ...d, location: `Station ${at}` }, [{ name: 'Bar' }])).toMatchObject({
      location: 1,
    });
  });

  it('reads the times on the project clock', () => {
    const d = day({ location: 'openstreetmap.org/#map=17/40.71/-74.0' });
    expect(sunOfDay(d, [], 'America/New_York')).toEqual({
      ...sunTimes(d.date, 40.71, -74.0, 'America/New_York'),
      location: 1,
    });
  });

  it('has no cell without coordinates', () => {
    expect(sunOfDay(day({ location: 'Via Roma 4' }), [{ name: 'Bar', address: 'Via Po' }])).toBe(
      null,
    );
  });
});

describe('a row in Cast whose role is the character', () => {
  const elena = member(5, {
    name: 'Anna Greco',
    role: 'Elena',
    department: 'Cast',
    phone: '+39 333 000 0005',
    userId: 'u5',
  });
  const shoot = day({ blocks: [block(1, ['Elena']), block(2, ['Pietro'])] });

  it('is called with the character, fills actor and contact and gets the personal call', () => {
    const entries = dayCrew(shoot, [elena]);
    expect(entries[0]).toMatchObject({ called: true, names: ['Elena'] });
    const [row] = castRows(shoot, entries);
    expect(row?.entry?.member.name).toBe('Anna Greco');
    expect(castCard('Elena', row?.entry, new Map())).toBeUndefined();
    expect(personalDayCall(shoot, entries, undefined, 'u5')).toMatchObject({
      label: 'Elena',
      start: 7 * 60,
      crew: true,
    });
  });

  it('stays home when the character is not in the day', () => {
    expect(dayCrew(day(), [elena])[0]).toMatchObject({ called: false, names: [] });
  });

  it('only counts in Cast: a crew role is a job, not a character', () => {
    const grip = member(6, { name: 'Bruno', role: 'Elena', department: 'Macchinisti' });
    expect(dayCrew(shoot, [grip])[0]).toMatchObject({ cast: false, names: [] });
  });

  it('leaves the actor and contact to a character card when there is one', () => {
    const cards = new Map<string, Element>([
      [
        'char0002',
        {
          id: 'char0002',
          type: 'character',
          name: 'Elena',
          actor: 'Anna G.',
          contact: '+39 1',
        } as unknown as Element,
      ],
    ]);
    const [row] = castRows(shoot, dayCrew(shoot, [elena], cards));
    expect(castCard('Elena', row?.entry, cards)).toMatchObject({
      actor: 'Anna G.',
      contact: '+39 1',
    });
  });
});
