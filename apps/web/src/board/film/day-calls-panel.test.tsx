// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import type { CrewMember, ShootingDay, ShootingDayInput } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DayCallsPanel } from './DayCallsPanel.tsx';
import type { CrewState } from './day-calls.ts';

vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}${JSON.stringify(vars)}` : key;
  return { useTranslation: () => ({ t }) };
});

const dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose.splice(0).reverse()) fn();
});

const person = (n: number, extra: Partial<CrewMember>): CrewMember => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  projectId: '00000000-0000-4000-8000-000000000999',
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
const ada = person(1, { name: 'Ada', role: 'DOP', department: 'Camera', pickup: 'Hotel' });
const mara = person(2, { name: 'Mara', department: 'Cast' });
const nino = person(3, { name: 'Nino', department: 'Cast' });
const draft: ShootingDayInput = {
  date: '2026-11-19',
  callTime: '07:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [
    {
      id: 'b1',
      type: 'shot',
      title: 'Vetrina',
      start: '09:00',
      duration: 30,
      shotId: null,
      cast: ['Mara'],
      departments: [],
    },
  ],
};

function mount(crew: CrewState, readOnly = false) {
  const onChange = vi.fn<(next: ShootingDayInput, key?: string) => void>();
  const onOpenTroupe = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  dispose.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() =>
    root.render(
      <DayCallsPanel
        entry={{
          day: { ...draft, id: 'd1', boardId: 'b', projectId: 'p', revision: 1 } as ShootingDay,
          index: 0,
          draft,
          dirty: false,
          stale: false,
        }}
        crew={crew}
        elements={new Map()}
        readOnly={readOnly}
        blockLabel={() => '12A'}
        onChange={onChange}
        onOpenTroupe={onOpenTroupe}
      />,
    ),
  );
  return { host, onChange, onOpenTroupe };
}
const check = (host: ParentNode, name: string) =>
  host.querySelector<HTMLInputElement>(
    `input[type="checkbox"][aria-label='dayCalls.calledToday{"name":"${name}"}']`,
  );

it('groups the called crew, hints when the cast is on set and folds the others', () => {
  const { host } = mount({ items: [ada, mara, nino], failed: false });
  const groups = [...host.querySelectorAll('.day-calls__group')].map((el) => el.textContent);
  expect(groups).toEqual(['Camera', 'Cast · dayCalls.castOnlyScheduled']);
  expect(host.textContent).toContain('dayCalls.inScene{"time":"09:00","block":"12A"}');
  const folded = host.querySelector('details.day-calls__more');
  expect(folded?.querySelector('summary')?.textContent).toBe(
    'dayCalls.notCalled{"count":1,"names":"Nino"}',
  );
  expect(check(host, 'Nino')?.checked).toBe(false);
  // The day's call shows until a time is typed; the usual pick-up is the placeholder.
  expect(host.querySelector('.auto-time')?.textContent).toContain('07:00');
  expect(
    host.querySelector<HTMLInputElement>(`input[aria-label='dayCalls.pickupOf{"name":"Ada"}']`)
      ?.placeholder,
  ).toBe('Hotel');
});

it('stores a change as an exception of the day', () => {
  const { host, onChange } = mount({ items: [ada, mara, nino], failed: false });
  act(() => check(host, 'Nino')?.click());
  expect(onChange).toHaveBeenLastCalledWith(
    { ...draft, calls: [{ crewMemberId: nino.id, call: null, pickup: null, absent: false }] },
    undefined,
  );
  const pickup = host.querySelector<HTMLInputElement>(
    `input[aria-label='dayCalls.pickupOf{"name":"Ada"}']`,
  );
  if (!pickup) throw new Error('missing');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(pickup, 'Bar');
    pickup.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(
    { ...draft, calls: [{ crewMemberId: ada.id, call: null, pickup: 'Bar' }] },
    `pickup:${ada.id}`,
  );
});

it('is read-only for viewers', () => {
  const { host } = mount({ items: [ada], failed: false }, true);
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('.auto-time')?.disabled).toBe(true);
});

it('links an empty crew to the Troupe view, and says why the roster cannot be read', () => {
  const empty = mount({ items: [], failed: false });
  const open = [...empty.host.querySelectorAll('button')].find(
    (b) => b.textContent === 'dayCalls.openTroupe',
  );
  act(() => open?.click());
  expect(empty.onOpenTroupe).toHaveBeenCalled();
  const grant = mount({ items: null, failed: true });
  expect(grant.host.textContent).toBe('dayCalls.unavailable');
  expect(grant.host.querySelector('input')).toBeNull();
});
