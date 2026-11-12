// @vitest-environment happy-dom
import type { ScheduleBlock, ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { localDate } from './calendar.ts';
import { ScheduleView } from './ScheduleView.tsx';

/** Phases 2 and 3 of decision 0089: drawing a block on empty time and moving a whole day. */

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const disposals: Array<() => void> = [];
// These tests pick dates in the month: the column stays open although the queue is empty.
beforeEach(() => localStorage.setItem('inkadra.schedule.side', 'open'));
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
function store() {
  const doc = new Y.Doc();
  const value = new BoardStore(doc);
  disposals.push(() => {
    value.destroy();
    doc.destroy();
  });
  return value;
}
const block = (id: string): ScheduleBlock => ({
  id,
  type: 'setup',
  title: id,
  duration: 60,
  start: null,
  shotId: null,
  cast: [],
  departments: [],
});
/** Block ids are UUIDs: a draft that fails the schema is never saved. */
const A = '00000000-0000-4000-8000-00000000000a';
const monday: ShootingDay = {
  id: 'day-1',
  boardId: 'board',
  projectId: 'project',
  revision: 1,
  date: '2026-11-02',
  callTime: '08:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [block(A)],
};
const tuesday: ShootingDay = { ...monday, id: 'day-2', date: '2026-11-03', blocks: [] };
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 700)));
const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
const undo = () => key(window, { key: 'z', ctrlKey: true, metaKey: true });
const pointer = (type: string, clientY: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY });
/** Every box at the top left: a client y is a minute of the grid. */
const flatLayout = () =>
  vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 200, 1440));
const blocksOf = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('[data-block]')].map((el) => el.dataset.block);
const headDate = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-day-head="${id}"]`)?.dataset.dayDrop;

it('draws a block on empty time, takes its type from a key and undoes it in one step', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  vi.spyOn(api, 'put').mockImplementation(async (_path, body) => ({
    ...monday,
    ...(body as object),
    revision: 2,
  }));
  flatLayout();
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  const column = host.querySelector<HTMLElement>('.schedule__day');
  if (!column) throw new Error('no day column');
  // a runs 08:00–09:00: 10:02 to 10:33 is free time after the end of the day.
  await act(async () => column.dispatchEvent(pointer('pointerdown', 602)));
  await act(async () => column.dispatchEvent(pointer('pointermove', 633)));
  expect(host.querySelector('.schedule__placeholder.is-new')).not.toBeNull();
  // Its time beside it while the pointer is down.
  const label = host.querySelector('.schedule__floating-note, .schedule__annotation-cell > span');
  expect(label?.textContent).toBe('10:00 – 10:35');
  await act(async () => column.dispatchEvent(pointer('pointerup', 633)));
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.textContent).toContain('schedule.newBlock');
  expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(5);
  await key(window, { key: '3' });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(host.querySelector('.schedule__placeholder.is-new')).toBeNull();
  const created = host.querySelectorAll<HTMLElement>('[data-block]')[1];
  // A break, kept at the time it was drawn because nothing is planned there.
  expect(created?.getAttribute('aria-label')).toContain('schedule.types.break');
  expect(created?.getAttribute('aria-label')).toContain('schedule.fixed');
  expect(created?.textContent).toContain('10:00');
  await undo();
  expect(blocksOf(host)).toEqual([A]);
});

it('opens the same menu with N after a block, and Escape leaves everything as it was', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  const first = host.querySelector<HTMLElement>(`[data-block="${A}"]`);
  if (!first) throw new Error('block not drawn');
  first.focus();
  await key(first, { key: 'n' });
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  expect(menu?.textContent).toContain('schedule.newBlock');
  await key(menu ?? window, { key: 'Escape' });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(first);
  expect(blocksOf(host)).toEqual([A]);
  // Picked from the menu, it queues right after the block.
  await key(first, { key: 'n' });
  await act(async () =>
    document
      .querySelector<HTMLElement>('[role="menuitem"][aria-label="schedule.types.note"]')
      ?.click(),
  );
  expect(blocksOf(host)).toEqual([A, expect.any(String)]);
  const created = host.querySelectorAll<HTMLElement>('[data-block]')[1];
  expect(created?.getAttribute('aria-label')).not.toContain('schedule.fixed');
});

it('swaps a day onto a taken date with Alt+→, saves both in one request and undoes both', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday, tuesday], nextCursor: null });
  const put = vi.spyOn(api, 'put');
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({
    items: (body as { changes: Array<{ id: string; input: object }> }).changes.map((change) => ({
      ...(change.id === monday.id ? monday : tuesday),
      ...change.input,
      revision: 2,
    })),
    deleted: [],
  }));
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  const head = host.querySelector<HTMLElement>('[data-day-head="day-1"]');
  if (!head) throw new Error('no heading');
  await key(head, { key: 'ArrowRight', altKey: true });
  expect(headDate(host, 'day-1')).toBe('2026-11-03');
  expect(headDate(host, 'day-2')).toBe('2026-11-02');
  await settle();
  expect(put).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledOnce();
  expect(post.mock.calls[0]?.[0]).toBe('/boards/board/schedule/edit');
  const body = post.mock.calls[0]?.[1] as { changes: Array<{ id: string }> } | undefined;
  const changes = body?.changes ?? [];
  expect(changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'day-1',
        input: expect.objectContaining({ date: '2026-11-03', blocks: monday.blocks }),
      }),
      expect.objectContaining({
        id: 'day-2',
        input: expect.objectContaining({ date: '2026-11-02' }),
      }),
    ]),
  );
  await undo();
  expect(headDate(host, 'day-1')).toBe('2026-11-02');
  expect(headDate(host, 'day-2')).toBe('2026-11-03');
});

it('moves nothing and draws nothing when the schedule is read-only', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  flatLayout();
  const host = await mount(<ScheduleView store={store()} boardId="board" readOnly />);
  const head = host.querySelector<HTMLElement>('[data-day-head="day-1"]');
  await key(head ?? window, { key: 'ArrowRight', altKey: true });
  expect(headDate(host, 'day-1')).toBe('2026-11-02');
  const column = host.querySelector<HTMLElement>('.schedule__day');
  await act(async () => column?.dispatchEvent(pointer('pointerdown', 602)));
  await act(async () => column?.dispatchEvent(pointer('pointermove', 633)));
  await act(async () => column?.dispatchEvent(pointer('pointerup', 633)));
  expect(host.querySelector('.schedule__placeholder.is-new')).toBeNull();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await key(head ?? window, { key: 'n' });
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);
const monthDay = (host: HTMLElement, date: string) =>
  host.querySelector<HTMLElement>(`.schedule__month-day[data-day-drop="${date}"]`);
const heads = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.schedule__heads [data-day-drop]')].map(
    (el) => el.dataset.dayDrop,
  );

it('puts the first shooting day on the project start, or on the date picked in the month', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
  const post = vi
    .spyOn(api, 'post')
    .mockImplementation(async (_path, body) => ({ ...monday, id: 'new', ...(body as object) }));
  const host = await mount(
    <ScheduleView store={store()} boardId="board" shootingStart="2026-11-21" />,
  );
  // A new project's calendar opens on its shooting dates, not on this week.
  expect(host.querySelector('.schedule__month-day[aria-pressed="true"]')?.textContent).toBe('21');
  await act(async () => monthDay(host, '2026-11-24')?.click());
  await act(async () => button(host, 'schedule.addDayShort')?.click());
  expect(post.mock.calls[0]?.[1]).toMatchObject({ date: '2026-11-24' });
});

it('puts the first shooting day on the project start when no date is picked', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
  const post = vi
    .spyOn(api, 'post')
    .mockImplementation(async (_path, body) => ({ ...monday, id: 'new', ...(body as object) }));
  const host = await mount(
    <ScheduleView store={store()} boardId="board" shootingStart="2026-11-21" />,
  );
  await act(async () => button(host, 'schedule.addDayShort')?.click());
  expect(post.mock.calls[0]?.[1]).toMatchObject({ date: '2026-11-21' });
});

it('shows a Saturday picked in the month in the week view', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  expect(heads(host)).not.toContain('2026-11-07');
  await act(async () => monthDay(host, '2026-11-07')?.click());
  expect(heads(host)).toContain('2026-11-07');
  expect(heads(host)).not.toContain('2026-11-08');
});

it('adds a block with N from anywhere in the schedule, not only from the grid', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await key(document.body, { key: 'n' });
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('schedule.newBlock');
  await key(window, { key: '3' });
  expect(blocksOf(host)).toEqual([A, expect.any(String)]);
});

it('offers Block next to Shooting day in the desktop Day view', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  expect(button(host, 'schedule.addBlockShort')).toBeUndefined();
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="radio"][value="day"]')?.click(),
  );
  await act(async () => button(host, 'schedule.addBlockShort')?.click());
  expect(blocksOf(host)).toEqual([A, expect.any(String)]);
});

it('waits for the project dates before it opens an empty calendar on today', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
  const post = vi
    .spyOn(api, 'post')
    .mockImplementation(async (_path, body) => ({ ...monday, id: 'new', ...(body as object) }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const board = store();
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  // The days answer first; the project and its dates arrive after.
  await act(async () =>
    root.render(<ScheduleView store={board} boardId="board" datesStatus="loading" />),
  );
  await act(async () =>
    root.render(
      <ScheduleView store={board} boardId="board" datesStatus="ready" shootingStart="2026-11-21" />,
    ),
  );
  expect(host.querySelector('.schedule__month-day[aria-pressed="true"]')?.textContent).toBe('21');
  await act(async () => button(host, 'schedule.addDayShort')?.click());
  expect(post.mock.calls[0]?.[1]).toMatchObject({ date: '2026-11-21' });
});

it.each(['error', 'unavailable'] as const)(
  'opens on today when the project dates are %s, and stays there when days arrive later',
  async (datesStatus) => {
    // No days yet; a minute later a collaborator's day comes with the refresh.
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValue({ items: [monday], nextCursor: null });
    const host = await mount(
      <ScheduleView store={store()} boardId="board" datesStatus={datesStatus} />,
    );
    const pressed = () =>
      host.querySelector<HTMLElement>('.schedule__month-day[aria-pressed="true"]')?.dataset.dayDrop;
    expect(pressed()).toBe(localDate(new Date()));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    // The calendar does not move under someone reading it.
    expect(pressed()).toBe(localDate(new Date()));
  },
);
